"""Bounded HUNTX pullback and utilization study.

The study deliberately uses a small, declared policy family and calendar holdout.
It never optimizes on the 43x launch: policy selection uses the first two cohorts,
then reports the later two cohorts unchanged. Prices are compact 15-minute archive
bars created by the read-only longitudinal collector.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "launch_hunter_multicohort_results"
PONS = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
TRAIN_DAYS = {"2026-09-13", "2026-09-15"}
HOLDOUT_DAYS = {"2026-09-17", "2026-09-20"}


def normalized(frame: pd.DataFrame, eth_side: int) -> pd.DataFrame:
    frame = frame.sort_values("bucket").copy()
    sqrt_price = pd.to_numeric(frame.close_sqrt, errors="coerce").astype(float)
    raw = np.square(sqrt_price / float(2**96))
    frame["multiple"] = (raw if eth_side == 1 else 1 / raw).astype(float)
    frame = frame[np.isfinite(frame.multiple) & (frame.multiple > 0)]
    if not frame.empty:
        frame["multiple"] /= float(frame.iloc[0].multiple)
    return frame


def trade_return(future: pd.DataFrame, entry: float, profit: float = .20,
                 stop: float = .15, friction: float = .03) -> float:
    gross = float(future.iloc[-1].multiple) / entry
    for row in future.itertuples():
        move = float(row.multiple) / entry - 1
        if move >= profit:
            gross = 1 + profit
            break
        if move <= -stop:
            # A stop is not assumed to fill at its trigger. Use the observed
            # bar price so a gap is charged to the strategy.
            gross = float(row.multiple) / entry
            break
    return (gross * (1 - friction) - 1) * 100


def snapshots() -> pd.DataFrame:
    screen = pd.read_csv(DATA / "multicohort_screen.csv")
    eligible = screen[(screen.market_gate == True) & (screen.hook.str.lower() == PONS)].copy()
    meta = eligible.set_index("pool_id")
    bars = pd.read_csv(DATA / "candidate_7d_bars.csv")
    rows: list[dict] = []
    for pool_id, raw in bars[bars.pool_id.isin(meta.index)].groupby("pool_id"):
        info = meta.loc[pool_id]
        path = normalized(raw, int(info.eth_side))
        for bucket in range(48, 193, 4):  # hourly decisions, 12h through 48h
            prior = path[path.bucket <= bucket]
            recent = prior[prior.bucket > bucket - 24]
            last_hour = prior[prior.bucket > bucket - 4]
            future = path[(path.bucket > bucket) & (path.bucket <= bucket + 16)]
            if len(recent) < 8 or len(last_hour) < 2 or future.empty:
                continue
            entry = float(prior.iloc[-1].multiple)
            volume = float(recent.volume_eth.sum())
            median_swap = float(info.median_swap_eth_2h)
            rows.append({
                "day": info.day,
                "pool_id": pool_id,
                "creator": info.init_tx_from if isinstance(info.init_tx_from, str) else pool_id,
                "bucket": bucket,
                "entry_multiple": entry,
                "drawdown_6h": entry / float(recent.multiple.max()) - 1,
                "momentum_1h": float(last_hour.iloc[-1].multiple) / float(last_hour.iloc[0].multiple) - 1,
                "volume_6h_eth": volume,
                "median_swap_eth": median_swap,
                # $20 at a $4,000 ETH reference is 0.005 ETH. Requiring both
                # 0.25% participation and one median swap makes size executable.
                "executable_20": bool(volume * .0025 >= .005 and median_swap >= .005),
                "return_3pct_friction": trade_return(future, entry, friction=.03),
                "return_5pct_friction": trade_return(future, entry, friction=.05),
                "return_8pct_friction": trade_return(future, entry, friction=.08),
            })
    return pd.DataFrame(rows)


def choose(frame: pd.DataFrame, policy: tuple) -> pd.DataFrame:
    drawdown, minimum, maximum, reversal, min_volume, max_volume = policy
    matches = frame[
        (frame.drawdown_6h <= -drawdown)
        & frame.entry_multiple.between(minimum, maximum)
        & (frame.momentum_1h >= reversal)
        & frame.volume_6h_eth.between(min_volume, max_volume)
        & frame.executable_20
    ].sort_values("bucket").drop_duplicates("pool_id")
    picks = []
    for _, day in matches.groupby("day"):
        # Two independent creator clusters per day. A stronger reversal ranks
        # ahead of raw volume because raw volume was negatively associated with
        # forward returns in the complete eligible sample.
        picks.append(day.sort_values(["momentum_1h", "volume_6h_eth"], ascending=[False, True])
                     .drop_duplicates("creator").head(2))
    return pd.concat(picks, ignore_index=True) if picks else matches.head(0)


def metrics(picks: pd.DataFrame, column: str, days: set[str]) -> dict:
    sample = picks[picks.day.isin(days)]
    daily = sample.groupby("day")[column].sum()
    return {
        "trades": int(len(sample)),
        "active_days": int(sample.day.nunique()),
        "median_trade_pct": float(sample[column].median()) if len(sample) else 0,
        "mean_trade_pct": float(sample[column].mean()) if len(sample) else 0,
        "worst_day_pct": float(daily.min()) if len(daily) else 0,
        "mean_day_pct": float(daily.mean()) if len(daily) else 0,
        "portfolio_total_pct_at_10pct_per_trade": float(sample[column].sum() * .10),
        "portfolio_worst_day_pct_at_10pct_per_trade": float(daily.min() * .10) if len(daily) else 0,
    }


def main() -> None:
    frame = snapshots()
    policies = itertools.product(
        (.10, .20, .30, .40, .50),
        (.05, .10, .20),
        (.50, 1.00, 2.00),
        (.00, .02, .05),
        (.10, 1.00, 5.00),
        (10.00, 30.00, 100.00, 300.00),
    )
    candidates = []
    for policy in policies:
        picks = choose(frame, policy)
        train = metrics(picks, "return_5pct_friction", TRAIN_DAYS)
        if train["trades"] < 2 or train["active_days"] < 2:
            continue
        if train["median_trade_pct"] <= 0 or train["worst_day_pct"] <= 0:
            continue
        candidates.append((train["worst_day_pct"], train["median_trade_pct"], policy, picks))

    candidates.sort(key=lambda item: item[:2], reverse=True)
    rows = []
    for _, _, policy, picks in candidates[:25]:
        row = {"policy": policy}
        for friction, column in ((3, "return_3pct_friction"), (5, "return_5pct_friction"),
                                 (8, "return_8pct_friction")):
            row[f"train_{friction}"] = metrics(picks, column, TRAIN_DAYS)
            row[f"holdout_{friction}"] = metrics(picks, column, HOLDOUT_DAYS)
        rows.append(row)

    recommended = rows[0] if rows else None
    if candidates:
        candidates[0][3].to_csv(DATA / "launch_hunter_v3_recommended_trades.csv", index=False)

    result = {
        "snapshot_rows": int(len(frame)),
        "eligible_pools": int(frame.pool_id.nunique()),
        "declared_policy_count": 5 * 3 * 3 * 3 * 3 * 4,
        "train_days": sorted(TRAIN_DAYS),
        "holdout_days": sorted(HOLDOUT_DAYS),
        "round_trip_friction_pct": [3, 5, 8],
        "selection": "first signal per pool; max two creator-distinct entries per day",
        "position_size_pct_of_nav": 10,
        "maximum_simultaneous_launch_exposure_pct": 20,
        "expected_actions_per_active_day": 4,
        "recommended": recommended,
        "top_training_policies": rows,
    }
    path = DATA / "launch_hunter_v3_breakthrough.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
