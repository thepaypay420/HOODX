"""Robust non-stable LP portfolio study for Robinhood Chain.

The study uses a deliberately small policy family, three independent ten-day
folds, severe fee haircuts, capacity filters, and fixed heuristic weights.  It
compares a diversified HOODX basket with a Krystal-style single LP position.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from lp_month_backtest import CAPITAL, POOLS, candles, simulate

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "nonstable_lp_results"
OUT.mkdir(exist_ok=True)

SNAPSHOTS = {
    row["label"]: row
    for row in json.loads((ROOT / "lp_month_results" / "pool_snapshots.json").read_text(encoding="utf-8"))
}

CANDIDATES = [
    "WETH/USDG 1bp",
    "WETH/USDG 5bp",
    "NVDA/USDG 5bp",
    "QQQ/USDG 5bp",
    "AAPL/USDG 5bp",
    "SPY/USDG 5bp",
    "AMZN/USDG 30bp",
]

# Fixed after the capacity/correlation screen, before evaluating the combined
# portfolio path.  AAPL is capped because the pool is materially smaller.
PORTFOLIO_WEIGHTS = {
    "WETH/USDG 1bp": 0.45,
    "NVDA/USDG 5bp": 0.20,
    "QQQ/USDG 5bp": 0.15,
    "AAPL/USDG 5bp": 0.10,
}
RESERVE_WEIGHT = 0.10

WIDTHS = [0.05, 0.10, 0.15, 0.25]
DWELLS = [4, 12]
COOLDOWNS = [24, 72]
COMPOUNDS = [72, 168]


def metrics(values: np.ndarray) -> dict:
    series = pd.Series(values)
    daily = series.iloc[::24].pct_change().dropna()
    return {
        "return_pct": float((series.iloc[-1] / CAPITAL - 1) * 100),
        "max_drawdown_pct": float((series / series.cummax() - 1).min() * 100),
        "annualized_vol_pct": float(daily.std(ddof=0) * math.sqrt(365) * 100),
        "worst_day_pct": float(daily.min() * 100),
    }


def compact(result: dict) -> dict:
    return {k: v for k, v in result.items() if k != "values"}


def select_robust_policy(pool, frame: pd.DataFrame) -> tuple[dict, list[dict]]:
    active = int(SNAPSHOTS[pool.label]["active_liquidity"])
    folds = [frame.iloc[i * 240 : (i + 1) * 240].reset_index(drop=True) for i in range(3)]
    rows = []
    for width in WIDTHS:
        for dwell in DWELLS:
            for cooldown in COOLDOWNS:
                for compound in COMPOUNDS:
                    full = simulate(pool, frame, active, width, dwell, cooldown, compound, 0.25)
                    fold_results = [simulate(pool, fold, active, width, dwell, cooldown, compound, 0.25) for fold in folds]
                    row = {
                        "pool": pool.label,
                        "half_width_pct": width * 100,
                        "dwell_hours": dwell,
                        "cooldown_hours": cooldown,
                        "compound_hours": compound,
                        "full_return_pct": full["net_return_pct"],
                        "full_excess_pct": full["excess_vs_hodl_pct"],
                        "full_max_drawdown_pct": full["max_drawdown_pct"],
                        "full_uptime_pct": full["time_in_range_pct"],
                        "full_rebalances": full["rebalances"],
                        "fold_returns_pct": [r["net_return_pct"] for r in fold_results],
                        "fold_excess_pct": [r["excess_vs_hodl_pct"] for r in fold_results],
                        "fold_uptime_pct": [r["time_in_range_pct"] for r in fold_results],
                        "fold_rebalances": [r["rebalances"] for r in fold_results],
                    }
                    minimum_excess = min(row["fold_excess_pct"])
                    median_excess = float(np.median(row["fold_excess_pct"]))
                    row["robust_score"] = (
                        median_excess
                        + 0.50 * minimum_excess
                        + 0.20 * row["full_return_pct"]
                        + 0.10 * row["full_max_drawdown_pct"]
                        - 0.10 * max(row["fold_rebalances"])
                    )
                    rows.append(row)
    qualified = [
        row for row in rows
        if row["full_uptime_pct"] >= 90
        and min(row["fold_uptime_pct"]) >= 85
        and max(row["fold_rebalances"]) <= 2
        and row["full_rebalances"] <= 5
    ]
    if not qualified:
        qualified = rows
    return max(qualified, key=lambda row: row["robust_score"]), rows


def evaluate_portfolio(pools: dict, frames: dict, policies: dict, fee_multiplier: float) -> tuple[dict, pd.DataFrame]:
    combined = np.full(720, CAPITAL * RESERVE_WEIGHT, dtype=float)
    passive_final = CAPITAL * RESERVE_WEIGHT
    sleeve_rows = []
    for name, weight in PORTFOLIO_WEIGHTS.items():
        pool = pools[name]
        policy = policies[name]
        active = int(SNAPSHOTS[name]["active_liquidity"])
        result = simulate(
            pool, frames[name], active,
            policy["half_width_pct"] / 100,
            policy["dwell_hours"], policy["cooldown_hours"], policy["compound_hours"],
            fee_multiplier,
        )
        combined += np.asarray(result["values"]) * weight
        passive_final += CAPITAL * weight * (1 + result["hodl_return_pct"] / 100)
        sleeve_rows.append({"pool": name, "weight_pct": weight * 100, **compact(result)})

    report = metrics(combined)
    report["passive_starting_mix_return_pct"] = float((passive_final / CAPITAL - 1) * 100)
    report["excess_vs_passive_pct"] = float((combined[-1] / passive_final - 1) * 100)
    report["sleeves"] = sleeve_rows

    fold_rows = []
    for fold_index in range(3):
        fold_combined = np.full(240, CAPITAL * RESERVE_WEIGHT, dtype=float)
        fold_passive = CAPITAL * RESERVE_WEIGHT
        for name, weight in PORTFOLIO_WEIGHTS.items():
            frame = frames[name].iloc[fold_index * 240 : (fold_index + 1) * 240].reset_index(drop=True)
            policy = policies[name]
            result = simulate(
                pools[name], frame, int(SNAPSHOTS[name]["active_liquidity"]),
                policy["half_width_pct"] / 100,
                policy["dwell_hours"], policy["cooldown_hours"], policy["compound_hours"],
                fee_multiplier,
            )
            fold_combined += np.asarray(result["values"]) * weight
            fold_passive += CAPITAL * weight * (1 + result["hodl_return_pct"] / 100)
        fold_metrics = metrics(fold_combined)
        fold_metrics.update({
            "fold": fold_index + 1,
            "from": frames[next(iter(PORTFOLIO_WEIGHTS))].iloc[fold_index * 240].time.isoformat(),
            "to": frames[next(iter(PORTFOLIO_WEIGHTS))].iloc[(fold_index + 1) * 240 - 1].time.isoformat(),
            "passive_return_pct": float((fold_passive / CAPITAL - 1) * 100),
            "excess_vs_passive_pct": float((fold_combined[-1] / fold_passive - 1) * 100),
        })
        fold_rows.append(fold_metrics)
    return report, pd.DataFrame(fold_rows)


def main() -> None:
    pools = {pool.label: pool for pool in POOLS if pool.label in CANDIDATES}
    frames = {name: candles(pool) for name, pool in pools.items()}

    policies = {}
    grid_rows = []
    for name, pool in pools.items():
        policy, rows = select_robust_policy(pool, frames[name])
        policies[name] = policy
        grid_rows.extend(rows)
    # The 24h and 72h WETH cooldowns produced the same observed full-period
    # path. Prefer 72h for the pilot because it bounds churn in an unseen shock.
    policies["WETH/USDG 1bp"]["cooldown_hours"] = 72
    pd.DataFrame(grid_rows).to_json(OUT / "walk_forward_policy_grid.json", orient="records", indent=2)
    (OUT / "robust_policies.json").write_text(json.dumps(policies, indent=2), encoding="utf-8")

    price_returns = pd.DataFrame({name: frame.set_index("time").close for name, frame in frames.items()})
    daily_returns = price_returns.iloc[::24].pct_change().dropna()
    daily_returns.corr().to_csv(OUT / "asset_daily_return_correlations.csv")

    report = {
        "status": "RESEARCH_CANDIDATE",
        "portfolio_weights_pct": {name: weight * 100 for name, weight in PORTFOLIO_WEIGHTS.items()},
        "reserve_weight_pct": RESERVE_WEIGHT * 100,
        "selection_method": "small policy family; severe 75% fee haircut; three ten-day folds; capacity and correlation screen; fixed heuristic weights",
        "cases": {},
    }
    portfolio_series = {}
    fold_frames = []
    for multiplier, label in [(0.50, "50pct_fee_haircut"), (0.25, "75pct_fee_haircut")]:
        case, fold_frame = evaluate_portfolio(pools, frames, policies, multiplier)
        report["cases"][label] = case
        fold_frame.insert(0, "case", label)
        fold_frames.append(fold_frame)

        combined = np.full(720, CAPITAL * RESERVE_WEIGHT, dtype=float)
        for name, weight in PORTFOLIO_WEIGHTS.items():
            policy = policies[name]
            result = simulate(
                pools[name], frames[name], int(SNAPSHOTS[name]["active_liquidity"]),
                policy["half_width_pct"] / 100,
                policy["dwell_hours"], policy["cooldown_hours"], policy["compound_hours"],
                multiplier,
            )
            combined += np.asarray(result["values"]) * weight
        portfolio_series[label] = combined

    # Single-position comparison uses the same robust WETH policy and fee case.
    weth_policy = policies["WETH/USDG 1bp"]
    single = simulate(
        pools["WETH/USDG 1bp"], frames["WETH/USDG 1bp"],
        int(SNAPSHOTS["WETH/USDG 1bp"]["active_liquidity"]),
        weth_policy["half_width_pct"] / 100,
        weth_policy["dwell_hours"], weth_policy["cooldown_hours"], weth_policy["compound_hours"],
        0.25,
    )
    single_comparison = compact(single)
    single_comparison.update(metrics(np.asarray(single["values"])))
    report["single_lp_comparison_75pct_fee_haircut"] = single_comparison

    nvda_policy = policies["NVDA/USDG 5bp"]
    nvda = simulate(
        pools["NVDA/USDG 5bp"], frames["NVDA/USDG 5bp"],
        int(SNAPSHOTS["NVDA/USDG 5bp"]["active_liquidity"]),
        nvda_policy["half_width_pct"] / 100,
        nvda_policy["dwell_hours"], nvda_policy["cooldown_hours"], nvda_policy["compound_hours"],
        0.25,
    )
    nvda_comparison = compact(nvda)
    nvda_comparison.update(metrics(np.asarray(nvda["values"])))
    report["single_stock_lp_comparison_75pct_fee_haircut"] = nvda_comparison

    (OUT / "recommended_nonstable_basket.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    pd.concat(fold_frames, ignore_index=True).to_csv(OUT / "portfolio_fold_results.csv", index=False)
    pd.DataFrame(portfolio_series).to_csv(OUT / "portfolio_value_series.csv", index=False)

    print(json.dumps({
        "weights": report["portfolio_weights_pct"],
        "reserve": report["reserve_weight_pct"],
        "50pct": report["cases"]["50pct_fee_haircut"],
        "75pct": report["cases"]["75pct_fee_haircut"],
        "single75": report["single_lp_comparison_75pct_fee_haircut"],
    }, indent=2))


if __name__ == "__main__":
    main()
