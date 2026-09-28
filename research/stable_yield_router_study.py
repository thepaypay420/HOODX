"""Stable-only yield router and tight-band activation study.

This extends the 30-day stable LP work with two questions:

1. Does a tighter active U/USDG range beat simply holding the starting tokens?
2. What stable-only portfolio is attractive when organic yield and incentives
   are shown separately?

The live-rate inputs are a dated research snapshot, not promises.  The LP
simulation uses the same transparent small-position model as the prior study.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

from lp_month_backtest import CAPITAL, centered, simulate, value_per_liquidity
from stable_lp_month_backtest import PANCAKE_MODEL_POOL, POOLS, observed_hourly


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "stable_lp_month_results"
OUT = ROOT / "stable_yield_router_results"
OUT.mkdir(exist_ok=True)

# Research snapshot captured 2026-09-28.  Robinhood's 7% estimate includes
# variable Morpho rewards; the Morpho 30-day number isolates the vault return.
MORPHO_REWARD_INCLUSIVE_APY = 7.00
MORPHO_30D_ORGANIC_APY = 3.79
SPARK_SAVINGS_APY = 3.50


def annualize(total_return_pct: float, days: float) -> float:
    base = 1 + total_return_pct / 100
    if base <= 0:
        return -100.0
    return (base ** (365 / days) - 1) * 100


def infer_active_liquidity(frame: pd.DataFrame) -> float:
    """Recover the saved active-liquidity snapshot without another RPC call."""
    prior = pd.read_csv(SOURCE / "u_usdg_pancake_strategy_grid.csv")
    row = prior.iloc[0]
    width = float(row.half_width_pct) / 100
    start = float(row.start_price)
    lower, upper = centered(start, width)
    position_liquidity = CAPITAL / value_per_liquidity(PANCAKE_MODEL_POOL, start, lower, upper)
    share = float(row.initial_liquidity_share_pct) / 100
    return position_liquidity * (1 / share - 1)


def run_tight_band_grid(frame: pd.DataFrame, active_liquidity: float) -> pd.DataFrame:
    rows: list[dict] = []
    for width_bps in [5, 10, 15, 25, 35, 50, 75, 100, 150, 300]:
        for dwell in [3, 6, 12, 24]:
            for cooldown in [24, 72, 168]:
                for fee_capture in [1.0, 0.25]:
                    result = simulate(
                        PANCAKE_MODEL_POOL,
                        frame,
                        active_liquidity,
                        width_bps / 10_000,
                        dwell,
                        cooldown,
                        720,
                        fee_capture,
                    )
                    excess_apy = annualize(result["excess_vs_hodl_pct"], len(frame) / 24)
                    rows.append(
                        {
                            "half_width_bps": width_bps,
                            "dwell_hours": dwell,
                            "cooldown_hours": cooldown,
                            "fee_capture_pct": fee_capture * 100,
                            "excess_apy_pct": excess_apy,
                            **{k: v for k, v in result.items() if k not in {"values", "series"}},
                        }
                    )
    return pd.DataFrame(rows)


def run_activation_curve(frame: pd.DataFrame, active_liquidity: float) -> pd.DataFrame:
    rows: list[dict] = []
    policies = [
        {"name": "tight", "half_width_bps": 25, "dwell_hours": 12, "cooldown_hours": 168},
        {"name": "high_uptime", "half_width_bps": 50, "dwell_hours": 12, "cooldown_hours": 168},
    ]
    for policy in policies:
        for multiple in [0.5, 1, 2, 3, 4, 5, 6, 8, 10]:
            stressed = frame.copy()
            stressed["volume_usd"] *= multiple
            result = simulate(
                PANCAKE_MODEL_POOL,
                stressed,
                active_liquidity,
                policy["half_width_bps"] / 10_000,
                policy["dwell_hours"],
                policy["cooldown_hours"],
                720,
                1.0,
            )
            rows.append(
                {
                    **policy,
                    "observed_volume_multiple": multiple,
                    "excess_apy_pct": annualize(result["excess_vs_hodl_pct"], len(frame) / 24),
                    "time_in_range_pct": result["time_in_range_pct"],
                    "rebalances": result["rebalances"],
                    "compounds": result["compounds"],
                }
            )
    return pd.DataFrame(rows)


def first_multiple_over(curve: pd.DataFrame, policy: str, hurdle: float) -> float | None:
    rows = curve[(curve.name == policy) & (curve.excess_apy_pct >= hurdle)].sort_values("observed_volume_multiple")
    return None if rows.empty else float(rows.iloc[0].observed_volume_multiple)


def interpolated_multiple(curve: pd.DataFrame, policy: str, hurdle: float) -> float | None:
    rows = curve[curve.name == policy].sort_values("observed_volume_multiple")
    below = rows[rows.excess_apy_pct < hurdle]
    above = rows[rows.excess_apy_pct >= hurdle]
    if below.empty or above.empty:
        return None
    left = below.iloc[-1]
    right = above.iloc[0]
    span = right.excess_apy_pct - left.excess_apy_pct
    if span <= 0:
        return None
    fraction = (hurdle - left.excess_apy_pct) / span
    return round(float(left.observed_volume_multiple + fraction * (right.observed_volume_multiple - left.observed_volume_multiple)), 2)


def router_scenarios() -> pd.DataFrame:
    profiles = [
        ("conservative", 0.50, 0.30, 0.20),
        ("recommended", 0.60, 0.30, 0.10),
        ("maximum_headline", 0.75, 0.15, 0.10),
    ]
    rows = []
    for name, morpho, spark, reserve in profiles:
        rows.append(
            {
                "profile": name,
                "morpho_weight_pct": morpho * 100,
                "spark_weight_pct": spark * 100,
                "liquid_reserve_pct": reserve * 100,
                "reward_inclusive_apy_pct": morpho * MORPHO_REWARD_INCLUSIVE_APY + spark * SPARK_SAVINGS_APY,
                "organic_30d_apy_pct": morpho * MORPHO_30D_ORGANIC_APY + spark * SPARK_SAVINGS_APY,
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    frame = observed_hourly(next(pool for pool in POOLS if pool.label == PANCAKE_MODEL_POOL.label))
    active = infer_active_liquidity(frame)
    grid = run_tight_band_grid(frame, active)
    curve = run_activation_curve(frame, active)
    scenarios = router_scenarios()

    grid.to_csv(OUT / "tight_band_grid.csv", index=False)
    curve.to_csv(OUT / "lp_activation_curve.csv", index=False)
    scenarios.to_csv(OUT / "yield_router_scenarios.csv", index=False)

    best_by_width = (
        grid[grid.fee_capture_pct == 100]
        .sort_values(["half_width_bps", "excess_apy_pct"], ascending=[True, False])
        .groupby("half_width_bps", as_index=False)
        .head(1)
    )
    best_by_width.to_csv(OUT / "best_raw_policy_by_width.csv", index=False)

    decision = {
        "study_date": "2026-09-28",
        "best_available_user_headline_apy_pct": 7.0,
        "headline_source": "Robinhood Earn estimate; variable Morpho rewards included",
        "underlying_morpho_30d_apy_pct": MORPHO_30D_ORGANIC_APY,
        "recommended_router": {
            "Steakhouse USDG via Morpho": 0.60,
            "Spark Savings spUSDG": 0.30,
            "liquid USDG reserve": 0.10,
            "reward_inclusive_apy_pct": 5.25,
            "organic_30d_apy_pct": round(0.60 * MORPHO_30D_ORGANIC_APY + 0.30 * SPARK_SAVINGS_APY, 3),
        },
        "tight_lp_sleeve": {
            "current_weight": 0.0,
            "maximum_weight": 0.10,
            "candidate_policy": "U/USDG +/-25 bps; 12h persistence; 7d cooldown; monthly fee reinvestment",
            "activation_hurdle_excess_apy_pct": 12.0,
            "first_tested_volume_multiple_over_12pct": first_multiple_over(curve, "tight", 12.0),
            "interpolated_volume_multiple_over_12pct": interpolated_multiple(curve, "tight", 12.0),
            "reason": "Observed fees did not compensate for range loss and idle time at current volume.",
        },
    }
    (OUT / "stable_yield_decision.json").write_text(json.dumps(decision, indent=2), encoding="utf-8")

    print(scenarios.to_string(index=False))
    print("\nLP activation decision:\n" + json.dumps(decision["tight_lp_sleeve"], indent=2))


if __name__ == "__main__":
    main()
