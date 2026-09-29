"""Seven-day path study for independently selected Robinhood Chain launches.

Read-only. Candidate selection is frozen from the first two hours. Archive logs
are compacted into 15-minute bars immediately so RPC credentials and raw
provider responses never enter the research artifacts.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from launch_hunter_multicohort_study import (
    BLOCKS_PER_HOUR, CACHE, COHORT_DATES, MANAGER, OUT, SWAP_TOPIC,
    decode_swap, load_cohort, rpc_batch,
)

BAR_BLOCKS = max(1, BLOCKS_PER_HOUR // 4)
CHUNK = 10_000
BATCH = 4
HORIZON_HOURS = 24 * 7


def collect_bars(candidates: pd.DataFrame) -> pd.DataFrame:
    path = CACHE / "candidate_7d_bars.json"
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"done": {}, "bars": {}}
    for day in COHORT_DATES:
        cohort = load_cohort(day)
        day_rows = candidates[candidates.day == day]
        pool_ids = day_rows.pool_id.tolist()
        if not pool_ids:
            continue
        pool_meta = {row.pool_id: row for row in day_rows.itertuples()}
        # The two-hour selection window is already cached by the cohort study;
        # longitudinal policy evaluation begins only after that decision point.
        start = int(day_rows.init_block.min() + 2 * BLOCKS_PER_HOUR)
        final = int(day_rows.init_block.max() + HORIZON_HOURS * BLOCKS_PER_HOUR)
        ranges = [(lo, min(lo + CHUNK - 1, final)) for lo in range(start, final + 1, CHUNK)]
        day_done = set(state["done"].get(day, []))
        for offset in range(0, len(ranges), BATCH):
            pending = [(lo, hi) for lo, hi in ranges[offset:offset + BATCH] if str(lo) not in day_done]
            if not pending:
                continue
            calls = [("eth_getLogs", [{
                "address": MANAGER, "fromBlock": hex(lo), "toBlock": hex(hi),
                "topics": [SWAP_TOPIC, pool_ids],
            }]) for lo, hi in pending]
            results = rpc_batch(calls, timeout=180)
            for (lo, _), logs in zip(pending, results):
                if logs is None:
                    raise RuntimeError("archive batch returned no result; refusing to mark the range complete")
                for log in logs:
                    pool_id = log["topics"][1].lower()
                    meta = pool_meta.get(pool_id)
                    if meta is None:
                        continue
                    row = decode_swap(log, int(meta.eth_side))
                    bucket = max(0, (row["block"] - int(meta.init_block)) // BAR_BLOCKS)
                    if bucket > HORIZON_HOURS * 4:
                        continue
                    key = f"{pool_id}:{bucket}"
                    bar = state["bars"].get(key)
                    if bar is None:
                        bar = {
                            "day": day, "pool_id": pool_id, "bucket": int(bucket),
                            "open_sqrt": row["sqrt"], "high_sqrt": row["sqrt"],
                            "low_sqrt": row["sqrt"], "close_sqrt": row["sqrt"],
                            "last_block": row["block"], "swaps": 0, "volume_eth": 0.0,
                            "fee_eth": 0.0, "close_liquidity": row["liquidity"],
                        }
                    bar["high_sqrt"] = max(bar["high_sqrt"], row["sqrt"])
                    bar["low_sqrt"] = min(bar["low_sqrt"], row["sqrt"])
                    if row["block"] >= bar["last_block"]:
                        bar["close_sqrt"] = row["sqrt"]
                        bar["close_liquidity"] = row["liquidity"]
                        bar["last_block"] = row["block"]
                    bar["swaps"] += 1
                    bar["volume_eth"] += abs(row["eth"])
                    bar["fee_eth"] += abs(row["eth"]) * row["fee"] / 1_000_000
                    state["bars"][key] = bar
                day_done.add(str(lo))
            state["done"][day] = sorted(day_done, key=int)
            path.write_text(json.dumps(state), encoding="utf-8")
            current_starts = {str(lo) for lo, _ in ranges}
            completed_current = len(day_done & current_starts)
            if completed_current % 24 == 0:
                print(f"{day}: compacted {completed_current}/{len(ranges)} archive ranges", flush=True)
    return pd.DataFrame(state["bars"].values()).sort_values(["day", "pool_id", "bucket"])


def relative_price(frame: pd.DataFrame, eth_side: int) -> pd.DataFrame:
    result = frame.copy()
    raw = (result.close_sqrt.astype(float) / 2**96) ** 2
    result["price_raw"] = raw if eth_side == 1 else 1 / raw
    first = result.iloc[(result.bucket - 8).abs().argsort()[:1]].price_raw.iloc[0]
    result["multiple"] = result.price_raw / first
    return result


def path_metrics(frame: pd.DataFrame, eth_side: int) -> dict:
    f = relative_price(frame, eth_side)
    after = f[f.bucket >= 8]
    if after.empty:
        return {"history_hours": 0}
    entry = after.iloc[0]
    final = after.iloc[-1]
    multiples = pd.to_numeric(after.multiple, errors="coerce")
    multiples = multiples[np.isfinite(multiples)]
    # Persistence is more robust than a single wick: require four bars (one hour)
    # at or above the stated multiple.
    def persistent(level: float) -> bool:
        return bool((multiples >= level).rolling(4).sum().ge(4).any())
    return {
        "history_hours": float((after.bucket.max() - 8) / 4),
        "entry_multiple": float(entry.multiple), "final_multiple": float(final.multiple),
        "max_multiple": float(multiples.max()), "min_multiple": float(multiples.min()),
        "persistent_2x": persistent(2), "persistent_3x": persistent(3),
        "persistent_5x": persistent(5), "persistent_10x": persistent(10),
        "swaps_7d": int(after.swaps.sum()), "volume_eth_7d": float(after.volume_eth.sum()),
        "active_hours_7d": int(after.groupby(after.bucket // 4).swaps.sum().gt(0).sum()),
    }


def runner_replay(frame: pd.DataFrame, eth_side: int, trigger: float, trail: float, max_hold_hours: int) -> dict:
    """Price-only breakout runner; returns are net of a 2% round-trip impact budget."""
    f = relative_price(frame, eth_side)
    f = f[f.bucket >= 8]
    if f.empty:
        return {"runner_return_pct": np.nan, "runner_entered": False}
    rolling_high = f.multiple.cummax()
    # Entry requires a breakout plus two hours of continuous post-screen activity.
    active = f.swaps.rolling(8, min_periods=8).sum() >= 16
    eligible = f[(f.multiple >= trigger) & active]
    if eligible.empty:
        return {"runner_return_pct": 0.0, "runner_entered": False}
    entry_idx = eligible.index[0]
    entry = float(f.loc[entry_idx, "multiple"])
    after = f.loc[entry_idx:].copy()
    peak = after.multiple.cummax()
    deadline = int(after.iloc[0].bucket + max_hold_hours * 4)
    exits = after[(after.multiple <= peak * (1 - trail)) | (after.bucket >= deadline)]
    exit_price = float(exits.iloc[0].multiple if not exits.empty else after.iloc[-1].multiple)
    gross = exit_price / entry - 1
    return {
        "runner_return_pct": (gross - 0.02) * 100, "runner_entered": True,
        "runner_entry_multiple": entry, "runner_exit_multiple": exit_price,
    }


def staged_runner_replay(
    frame: pd.DataFrame, eth_side: int, initial_volume: float, trigger: float,
    stop: float, recovery: float, trail: float, time_stop_hours: int,
) -> dict:
    """Tiny breakout probe, principal recovery, then a house-money runner.

    Prices use only completed 15-minute bars. Entry needs two consecutive bars
    above the trigger and continued two-hour volume. Each trade pays 1% impact.
    """
    f = relative_price(frame, eth_side)
    f = f[f.bucket >= 8].copy()
    if len(f) < 10:
        return {"staged_return_pct": 0.0, "staged_entered": False, "staged_recovered": False}
    f["volume_2h"] = f.volume_eth.rolling(8, min_periods=8).sum()
    f["trigger_confirmed"] = (f.multiple >= trigger).rolling(2, min_periods=2).sum() == 2
    eligible = f[f.trigger_confirmed & (f.volume_2h >= max(0.25, initial_volume * 0.10))]
    if eligible.empty:
        return {"staged_return_pct": 0.0, "staged_entered": False, "staged_recovered": False}
    entry_row = eligible.iloc[0]
    entry_price = float(entry_row.multiple)
    tokens = 0.99 / entry_price
    cash, recovered = 0.0, False
    peak = entry_price
    deadline = int(entry_row.bucket + time_stop_hours * 4)
    exit_price = entry_price
    after = f[f.bucket > entry_row.bucket]
    for row in after.itertuples():
        price = float(row.multiple)
        if not math.isfinite(price) or price <= 0:
            continue
        exit_price = price
        peak = max(peak, price)
        if not recovered:
            if price <= entry_price * (1 - stop) or row.bucket >= deadline:
                cash += tokens * price * 0.99
                tokens = 0.0
                break
            if price >= entry_price * recovery:
                # Sell only enough to recover the original unit after impact.
                sold = min(tokens, 1.0 / (price * 0.99))
                cash += sold * price * 0.99
                tokens -= sold
                recovered = True
                peak = price
        elif price <= peak * (1 - trail):
            cash += tokens * price * 0.99
            tokens = 0.0
            break
    if tokens:
        cash += tokens * exit_price * 0.99
    return {
        "staged_return_pct": (cash - 1) * 100, "staged_entered": True,
        "staged_recovered": recovered, "staged_entry_multiple": entry_price,
        "staged_exit_multiple": exit_price,
    }


def main() -> None:
    screen = pd.read_csv(OUT / "multicohort_screen.csv")
    candidates = screen[screen.market_gate == True].copy()
    bars = collect_bars(candidates)
    bars.to_csv(OUT / "candidate_7d_bars.csv", index=False)
    bars_by_pool = {pool_id: frame for pool_id, frame in bars.groupby("pool_id", sort=False)}
    paths = []
    for row in candidates.itertuples():
        f = bars_by_pool.get(row.pool_id, pd.DataFrame())
        metrics = path_metrics(f, int(row.eth_side)) if not f.empty else {"history_hours": 0}
        paths.append({**row._asdict(), **metrics})
    path_frame = pd.DataFrame(paths)
    path_frame.to_csv(OUT / "candidate_7d_paths.csv", index=False)

    policies = []
    for trigger in (1.25, 1.5, 2.0):
        for trail in (0.25, 0.35, 0.50):
            for hold in (12, 24, 48):
                for row in candidates.itertuples():
                    f = bars_by_pool.get(row.pool_id, pd.DataFrame())
                    replay = runner_replay(f, int(row.eth_side), trigger, trail, hold) if not f.empty else {
                        "runner_return_pct": np.nan, "runner_entered": False,
                    }
                    split = "test" if int(row.pool_id[-2:], 16) % 4 == 0 else "train"
                    policies.append({"pool_id": row.pool_id, "day": row.day, "split": split,
                                     "flow_gate": row.flow_gate, "trigger": trigger, "trail": trail,
                                     "max_hold_hours": hold, **replay})
    policy = pd.DataFrame(policies)
    policy.to_csv(OUT / "runner_policy_outcomes.csv", index=False)
    summary = policy.groupby(["trigger", "trail", "max_hold_hours", "split", "flow_gate"]).agg(
        pools=("pool_id", "size"), entered_pct=("runner_entered", "mean"),
        mean_return_pct=("runner_return_pct", "mean"), median_return_pct=("runner_return_pct", "median"),
        p10_return_pct=("runner_return_pct", lambda s: s.quantile(.1)),
        positive_pct=("runner_return_pct", lambda s: (s > 0).mean()),
    ).reset_index()
    summary[["entered_pct", "positive_pct"]] *= 100
    summary.to_csv(OUT / "runner_policy_summary.csv", index=False)

    staged = []
    for trigger in (1.25, 1.5, 2.0):
        for stop in (0.20, 0.30, 0.40):
            for recovery in (1.5, 2.0, 3.0):
                for trail in (0.40, 0.55, 0.70):
                    for time_stop in (6, 12, 24):
                        for row in candidates.itertuples():
                            f = bars_by_pool.get(row.pool_id, pd.DataFrame())
                            replay = staged_runner_replay(
                                f, int(row.eth_side), float(row.volume_eth_2h), trigger,
                                stop, recovery, trail, time_stop,
                            ) if not f.empty else {
                                "staged_return_pct": 0.0, "staged_entered": False, "staged_recovered": False,
                            }
                            split = "test" if int(row.pool_id[-2:], 16) % 4 == 0 else "train"
                            staged.append({
                                "pool_id": row.pool_id, "day": row.day, "split": split,
                                "hook": row.hook, "trigger": trigger, "stop": stop,
                                "recovery": recovery, "trail": trail, "time_stop_hours": time_stop,
                                **replay,
                            })
    staged_frame = pd.DataFrame(staged)
    staged_frame.to_csv(OUT / "staged_runner_outcomes.csv", index=False)
    staged_summary = staged_frame.groupby([
        "trigger", "stop", "recovery", "trail", "time_stop_hours", "split", "hook",
    ]).agg(
        pools=("pool_id", "size"), entered_pct=("staged_entered", "mean"),
        recovered_pct=("staged_recovered", "mean"), mean_return_pct=("staged_return_pct", "mean"),
        median_return_pct=("staged_return_pct", "median"),
        p10_return_pct=("staged_return_pct", lambda s: s.quantile(.1)),
        positive_pct=("staged_return_pct", lambda s: (s > 0).mean()),
    ).reset_index()
    staged_summary[["entered_pct", "recovered_pct", "positive_pct"]] *= 100
    staged_summary.to_csv(OUT / "staged_runner_summary.csv", index=False)
    manifest = {
        "candidate_pools": int(len(candidates)), "bar_minutes": 15,
        "complete_160h_histories": int((path_frame.history_hours >= 160).sum()),
        "read_only": True, "rpc": "private archive endpoint (credential omitted)",
    }
    (OUT / "longitudinal_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print(path_frame[["day", "flow_gate", "final_multiple", "max_multiple", "persistent_2x", "volume_eth_7d"]].groupby("day").agg(
        pools=("final_multiple", "size"), median_final=("final_multiple", "median"),
        median_peak=("max_multiple", "median"), two_x=("persistent_2x", "sum"),
        median_volume=("volume_eth_7d", "median"),
    ).to_string())


if __name__ == "__main__":
    main()
