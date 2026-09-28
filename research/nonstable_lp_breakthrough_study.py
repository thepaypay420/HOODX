"""Adversarial robustness pass for the proposed non-stable LP basket.

This deliberately reuses the frozen sleeve policies from the first study. It
tests fee-volume survival, nearby portfolio weights, and one-sleeve fee outages
without selecting new per-path range parameters.
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from lp_month_backtest import CAPITAL, POOLS, Pool, candles, simulate

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "nonstable_lp_results"
SNAPSHOTS = {
    row["label"]: row
    for row in json.loads((ROOT / "lp_month_results" / "pool_snapshots.json").read_text(encoding="utf-8"))
}
POLICIES = json.loads((OUT / "robust_policies.json").read_text(encoding="utf-8"))

SLEEVES = ["WETH/USDG 1bp", "NVDA/USDG 5bp", "QQQ/USDG 5bp", "AAPL/USDG 5bp"]
BASE_WEIGHTS = {
    "WETH/USDG 1bp": 0.45,
    "NVDA/USDG 5bp": 0.20,
    "QQQ/USDG 5bp": 0.15,
    "AAPL/USDG 5bp": 0.10,
}
BASE_RESERVE = 0.10
RECOMMENDED_WEIGHTS = {
    "WETH/USDG 1bp": 0.35,
    "NVDA/USDG 5bp": 0.15,
    "QQQ/USDG 5bp": 0.20,
    "AAPL/USDG 5bp": 0.10,
}
RECOMMENDED_RESERVE = 0.20

INCUBATOR_POOLS = [
    (Pool("SLV/USDG 30bp", "0x8cb787e6c315d464775289bad00fdd67d53ecb3d", 3000,
          "SLV", "USDG", 18, 6, 0, "base", 316_754.10), 240_187_048_576_187_327),
    (Pool("MU/USDG 30bp", "0xd057b1bc54917855bbee58ead58647f47cab35e5", 3000,
          "USDG", "MU", 6, 18, 1, "base", 908_997.85), 263_696_804_874_013_147),
    (Pool("DELL/USDG 100bp", "0xc30c89cb7815a1488b7998d15eec73961707fc5a", 10_000,
          "USDG", "DELL", 6, 18, 1, "base", 266_612.50), 123_922_116_766_887_137),
]


def path_metrics(values: np.ndarray) -> dict:
    series = pd.Series(values)
    daily = series.iloc[::24].pct_change().dropna()
    return {
        "return_pct": float((series.iloc[-1] / CAPITAL - 1) * 100),
        "max_drawdown_pct": float((series / series.cummax() - 1).min() * 100),
        "annualized_vol_pct": float(daily.std(ddof=0) * math.sqrt(365) * 100),
        "worst_day_pct": float(daily.min() * 100),
    }


def run_sleeve(pool, frame, fee_capture: float, fold: int | None = None) -> dict:
    if fold is not None:
        frame = frame.iloc[fold * 240 : (fold + 1) * 240].reset_index(drop=True)
    policy = POLICIES[pool.label]
    return simulate(
        pool,
        frame,
        int(SNAPSHOTS[pool.label]["active_liquidity"]),
        policy["half_width_pct"] / 100,
        policy["dwell_hours"],
        policy["cooldown_hours"],
        policy["compound_hours"],
        fee_capture,
    )


def combine(results: dict, weights: dict, reserve: float) -> tuple[dict, np.ndarray]:
    length = len(next(iter(results.values()))["values"])
    values = np.full(length, CAPITAL * reserve, dtype=float)
    passive = CAPITAL * reserve
    for name, weight in weights.items():
        result = results[name]
        values += np.asarray(result["values"]) * weight
        passive += CAPITAL * weight * (1 + result["hodl_return_pct"] / 100)
    row = path_metrics(values)
    row["passive_return_pct"] = float((passive / CAPITAL - 1) * 100)
    row["excess_vs_passive_pct"] = float((values[-1] / passive - 1) * 100)
    return row, values


def weight_frontier(pools: dict, frames: dict) -> pd.DataFrame:
    full = {name: run_sleeve(pools[name], frames[name], 0.25) for name in SLEEVES}
    folds = [
        {name: run_sleeve(pools[name], frames[name], 0.25, fold) for name in SLEEVES}
        for fold in range(3)
    ]
    rows = []
    grids = [
        np.arange(0.35, 0.501, 0.05),
        np.arange(0.15, 0.251, 0.05),
        np.arange(0.10, 0.201, 0.05),
        np.arange(0.05, 0.101, 0.05),
        np.arange(0.10, 0.201, 0.05),
    ]
    for weth, nvda, qqq, aapl, reserve in itertools.product(*grids):
        if not np.isclose(weth + nvda + qqq + aapl + reserve, 1.0):
            continue
        weights = dict(zip(SLEEVES, [weth, nvda, qqq, aapl]))
        row, _ = combine(full, weights, reserve)
        fold_rows = [combine(result, weights, reserve)[0] for result in folds]
        fold_excess = [r["excess_vs_passive_pct"] for r in fold_rows]
        # Reward results that remain useful in every time fold and penalize
        # drawdown. No return-maximizing term is included.
        row.update({
            "weth_pct": weth * 100,
            "nvda_pct": nvda * 100,
            "qqq_pct": qqq * 100,
            "aapl_pct": aapl * 100,
            "reserve_pct": reserve * 100,
            "minimum_fold_excess_pct": min(fold_excess),
            "median_fold_excess_pct": float(np.median(fold_excess)),
            "positive_excess_folds": sum(value > 0 for value in fold_excess),
            "plateau_score": min(fold_excess) + 0.5 * float(np.median(fold_excess)) + 0.15 * row["max_drawdown_pct"],
        })
        rows.append(row)
    return pd.DataFrame(rows).sort_values("plateau_score", ascending=False)


def volume_survival(pools: dict, frames: dict) -> pd.DataFrame:
    rows = []
    # Capture is the fraction of raw historical pro-rata fees credited. 25%
    # is the severe case from the first study; lower values model further
    # post-incentive volume/fee deterioration.
    for capture in [*np.arange(0, 0.251, 0.005), 0.375, 0.50]:
        results = {name: run_sleeve(pools[name], frames[name], capture) for name in SLEEVES}
        row, _ = combine(results, BASE_WEIGHTS, BASE_RESERVE)
        row.update({
            "modeled_fee_capture_pct": capture * 100,
            "fee_volume_vs_severe_case_pct": capture / 0.25 * 100 if capture else 0,
        })
        rows.append(row)
    return pd.DataFrame(rows)


def sleeve_fee_outages(pools: dict, frames: dict) -> pd.DataFrame:
    healthy = {name: run_sleeve(pools[name], frames[name], 0.25) for name in SLEEVES}
    rows = []
    base, _ = combine(healthy, BASE_WEIGHTS, BASE_RESERVE)
    rows.append({"outage": "none", **base})
    for failed in SLEEVES:
        results = dict(healthy)
        results[failed] = run_sleeve(pools[failed], frames[failed], 0.0)
        row, _ = combine(results, BASE_WEIGHTS, BASE_RESERVE)
        rows.append({"outage": failed, **row})
    return pd.DataFrame(rows)


def incubator_scan() -> pd.DataFrame:
    rows = []
    for pool, active in INCUBATOR_POOLS:
        frame = candles(pool)
        candidates = []
        for width, dwell, cooldown, compound in itertools.product(
            [0.05, 0.10, 0.15, 0.25, 0.40], [4, 12], [24, 72], [72, 168]
        ):
            full = simulate(pool, frame, active, width, dwell, cooldown, compound, 0.25)
            folds = [
                simulate(pool, frame.iloc[i * 240 : (i + 1) * 240].reset_index(drop=True),
                         active, width, dwell, cooldown, compound, 0.25)
                for i in range(3)
            ]
            if (full["time_in_range_pct"] < 85 or min(r["time_in_range_pct"] for r in folds) < 80
                    or full["rebalances"] > 6 or max(r["rebalances"] for r in folds) > 2):
                continue
            fold_excess = [r["excess_vs_hodl_pct"] for r in folds]
            score = (float(np.median(fold_excess)) + 0.5 * min(fold_excess)
                     + 0.2 * full["net_return_pct"] + 0.1 * full["max_drawdown_pct"])
            candidates.append((score, width, dwell, cooldown, compound, full, folds))
        _, width, dwell, cooldown, compound, full, folds = max(candidates, key=lambda item: item[0])
        moderate = simulate(pool, frame, active, width, dwell, cooldown, compound, 0.50)
        fold_excess = [r["excess_vs_hodl_pct"] for r in folds]
        if pool.label.startswith("MU"):
            decision = "WATCH: promising, path-sensitive"
        elif pool.label.startswith("SLV"):
            decision = "WATCH: diversifier, drawdown too high"
        else:
            decision = "REJECT V1: beta dominates fee edge"
        rows.append({
            "pool": pool.label,
            "address": pool.address,
            "tvl_usd": pool.tvl_usd,
            "volume_30d_usd": float(frame.volume_usd.sum()),
            "half_width_pct": width * 100,
            "dwell_hours": dwell,
            "cooldown_hours": cooldown,
            "compound_hours": compound,
            "severe_return_pct": full["net_return_pct"],
            "severe_excess_pct": full["excess_vs_hodl_pct"],
            "severe_max_drawdown_pct": full["max_drawdown_pct"],
            "severe_annualized_vol_pct": full["annualized_vol_pct"],
            "moderate_return_pct": moderate["net_return_pct"],
            "moderate_excess_pct": moderate["excess_vs_hodl_pct"],
            "fold_excess_pct": json.dumps(fold_excess),
            "minimum_fold_excess_pct": min(fold_excess),
            "decision": decision,
        })
    return pd.DataFrame(rows)


def correlated_block_bootstrap(pools: dict, frames: dict, paths: int = 60) -> pd.DataFrame:
    """Resample aligned 24h blocks, preserving observed cross-sleeve dependence.

    Prices are rebuilt continuously from sampled hourly returns so block
    boundaries do not create artificial jumps. This tests sequencing within
    the observed regime; it does not invent unseen crash magnitudes.
    """
    rng = np.random.default_rng(696)
    returns = {name: frame.close.pct_change().fillna(0).to_numpy() for name, frame in frames.items()}
    rows = []
    for path in range(paths):
        sampled_days = rng.integers(0, 30, size=30)
        indexes = np.concatenate([np.arange(day * 24, (day + 1) * 24) for day in sampled_days])
        results = {}
        for name in SLEEVES:
            synthetic = frames[name].copy()
            sampled_returns = returns[name][indexes]
            price = float(frames[name].iloc[0].close) * np.cumprod(1 + sampled_returns)
            for column in ["open", "high", "low", "close"]:
                synthetic[column] = price
            synthetic["volume_usd"] = frames[name].volume_usd.to_numpy()[indexes]
            results[name] = run_sleeve(pools[name], synthetic, 0.25)
        row, _ = combine(results, RECOMMENDED_WEIGHTS, RECOMMENDED_RESERVE)
        row["path"] = path + 1
        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    pools = {pool.label: pool for pool in POOLS if pool.label in SLEEVES}
    frames = {name: candles(pool) for name, pool in pools.items()}

    frontier = weight_frontier(pools, frames)
    frontier.to_csv(OUT / "weight_robustness_frontier.csv", index=False)
    survival = volume_survival(pools, frames)
    survival.to_csv(OUT / "fee_volume_survival.csv", index=False)
    outages = sleeve_fee_outages(pools, frames)
    outages.to_csv(OUT / "sleeve_fee_outages.csv", index=False)
    incubator = incubator_scan()
    incubator.to_csv(OUT / "incubator_pool_scan.csv", index=False)
    bootstrap = correlated_block_bootstrap(pools, frames)
    bootstrap.to_csv(OUT / "correlated_block_bootstrap.csv", index=False)

    admission = pd.DataFrame([
        ["WETH/USDG 0.01%", 3.52, 9, 10, 11, "ADMIT CORE", "positive external tail band; deepest pool"],
        ["NVDA/USDG 0.05%", 2.35, 1, 4, 11, "ADMIT CAPPED", "positive external tail band; independent fee sleeve"],
        ["TSLA/USDG 0.3%", 8.36, -60, -15, 26, "REJECT V1", "high backtest return but catastrophic adverse band"],
        ["WETH/SPY 0.05%", 15.84, -88, -68, -22, "REJECT", "every reported Monte Carlo band is negative"],
        ["WETH/NVDA 0.05%", 1.57, -79, -32, 26, "REJECT", "volatile/volatile pair adds double-beta tail risk"],
        ["WETH/MSTR 1%", -54.70, np.nan, np.nan, np.nan, "REJECT", "every tested range lost money"],
        ["MU/USDG 0.3%", 3.33, 5, 9, 22, "WATCH", "positive external band; HOODX full-path fee excess still negative"],
        ["AMZN/USDG 0.3%", 10.27, 4, 15, 35, "WATCH", "positive external band conflicts with negative HOODX 30-day regime"],
        ["SLV/USDG 0.3%", 13.30, 7, 20, 46, "WATCH", "positive external band; HOODX drawdown and one fold fail"],
        ["DELL/USDG 1%", 11.15, 33, 34, 34, "WATCH/VERIFY", "low-confidence external result; HOODX return mostly beta"],
    ], columns=["pool", "external_backtest_return_pct", "mc_worst5_pct", "mc_median_pct", "mc_best5_pct", "decision", "reason"])
    admission.to_csv(OUT / "external_pool_admission_screen.csv", index=False)

    base_match = frontier[
        np.isclose(frontier.weth_pct, 45)
        & np.isclose(frontier.nvda_pct, 20)
        & np.isclose(frontier.qqq_pct, 15)
        & np.isclose(frontier.aapl_pct, 10)
        & np.isclose(frontier.reserve_pct, 10)
    ].iloc[0].to_dict()
    top = frontier.iloc[0].to_dict()
    break_even = survival[survival.excess_vs_passive_pct >= 0].iloc[0].to_dict()
    summary = {
        "status": "RESEARCH_CANDIDATE",
        "base_weights": {**{name: weight * 100 for name, weight in BASE_WEIGHTS.items()}, "USDG reserve": BASE_RESERVE * 100},
        "recommended_weights": {
            "WETH/USDG 1bp": top["weth_pct"],
            "NVDA/USDG 5bp": top["nvda_pct"],
            "QQQ/USDG 5bp": top["qqq_pct"],
            "AAPL/USDG 5bp": top["aapl_pct"],
            "USDG reserve": top["reserve_pct"],
        },
        "recommended_metrics": {key: top[key] for key in [
            "return_pct", "max_drawdown_pct", "annualized_vol_pct", "worst_day_pct",
            "passive_return_pct", "excess_vs_passive_pct", "minimum_fold_excess_pct",
            "median_fold_excess_pct", "positive_excess_folds", "plateau_score",
        ]},
        "frontier_portfolios_tested": int(len(frontier)),
        "base_frontier_rank": int(frontier.reset_index(drop=True).index[
            (np.isclose(frontier.reset_index(drop=True).weth_pct, 45))
            & (np.isclose(frontier.reset_index(drop=True).nvda_pct, 20))
            & (np.isclose(frontier.reset_index(drop=True).qqq_pct, 15))
            & (np.isclose(frontier.reset_index(drop=True).aapl_pct, 10))
            & (np.isclose(frontier.reset_index(drop=True).reserve_pct, 10))
        ][0] + 1),
        "base_frontier_metrics": base_match,
        "top_frontier_rows": frontier.head(10).to_dict(orient="records"),
        "break_even_modeled_fee_capture_pct": break_even["modeled_fee_capture_pct"],
        "break_even_fee_volume_vs_severe_case_pct": break_even["fee_volume_vs_severe_case_pct"],
        "sleeve_fee_outages": outages.to_dict(orient="records"),
        "incubator_pool_scan": incubator.to_dict(orient="records"),
        "correlated_block_bootstrap": {
            metric: {
                "p05": float(bootstrap[metric].quantile(0.05)),
                "median": float(bootstrap[metric].median()),
                "p95": float(bootstrap[metric].quantile(0.95)),
            }
            for metric in ["return_pct", "max_drawdown_pct", "excess_vs_passive_pct"]
        },
        "admission_rule": "Reject pools whose adverse external simulation band is deeply negative even when headline backtest return or APR is high.",
    }
    (OUT / "breakthrough_robustness_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
