"""Fee-bearing LP replay for canonical Doppler launches selected after two hours."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launch_hunter_multicohort_study import BLOCKS_PER_HOUR, CACHE, MANAGER, OUT, SWAP_TOPIC, decode_swap, rpc_batch
from launch_hunter_cohort_study import LaunchPool, range_value_per_raw_liquidity, token_metadata, token_price_eth

CHUNK, BATCH, HOURS = 10_000, 4, 24 * 7
CAPITAL_ETH = 20 / 2680
ACTION_COST_ETH = 0.10 / 2680


def collect(candidates: pd.DataFrame) -> pd.DataFrame:
    path = CACHE / "doppler_7d_bars.json"
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"done": {}, "bars": {}}
    for day, day_rows in candidates.groupby("day"):
        ids = day_rows.pool_id.tolist()
        meta = {row.pool_id: row for row in day_rows.itertuples()}
        start = int(day_rows.init_block.min() + 2 * BLOCKS_PER_HOUR)
        final = int(day_rows.init_block.max() + HOURS * BLOCKS_PER_HOUR)
        ranges = [(lo, min(lo + CHUNK - 1, final)) for lo in range(start, final + 1, CHUNK)]
        done = set(state["done"].get(day, []))
        for offset in range(0, len(ranges), BATCH):
            pending = [(lo, hi) for lo, hi in ranges[offset:offset + BATCH] if str(lo) not in done]
            if not pending:
                continue
            results = rpc_batch([("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(lo), "toBlock": hex(hi),
                                                    "topics": [SWAP_TOPIC, ids]}]) for lo, hi in pending], timeout=180)
            for (lo, _), logs in zip(pending, results):
                if logs is None:
                    raise RuntimeError("archive batch incomplete")
                for log in logs:
                    pid = log["topics"][1].lower()
                    row = decode_swap(log, int(meta[pid].eth_side))
                    bucket = (row["block"] - int(meta[pid].init_block)) // max(1, BLOCKS_PER_HOUR // 4)
                    if bucket < 8:
                        continue
                    key = f"{pid}:{bucket}"
                    bar = state["bars"].get(key, {"day": day, "pool_id": pid, "bucket": int(bucket),
                        "close_sqrt": row["sqrt"], "last_block": row["block"], "swaps": 0,
                        "volume_eth": 0.0, "fee_eth": 0.0, "close_liquidity": row["liquidity"]})
                    if row["block"] >= bar["last_block"]:
                        bar.update(close_sqrt=row["sqrt"], last_block=row["block"], close_liquidity=row["liquidity"])
                    bar["swaps"] += 1
                    bar["volume_eth"] += abs(row["eth"])
                    bar["fee_eth"] += abs(row["eth"]) * row["fee"] / 1_000_000
                    state["bars"][key] = bar
                done.add(str(lo))
            state["done"][day] = sorted(done, key=int)
            path.write_text(json.dumps(state), encoding="utf-8")
        print(f"{day}: {len(ids)} canonical candidates compacted", flush=True)
    return pd.DataFrame(state["bars"].values()).sort_values(["pool_id", "bucket"])


def bid_replay(pool: LaunchPool, bars: pd.DataFrame, inner: float, outer: float, stop: float, expiry: int) -> dict:
    if len(bars) < 2:
        return {"return_pct": np.nan, "touched": False, "completed": False, "stopped": False, "fees_pct": 0}
    reference = token_price_eth(pool, int(bars.iloc[0].close_sqrt))
    upper, lower = reference * (1 - inner), reference * (1 - outer)
    unit = range_value_per_raw_liquidity(pool, reference, lower, upper)
    if not math.isfinite(unit) or unit <= 0:
        return {"return_pct": np.nan, "touched": False, "completed": False, "stopped": False, "fees_pct": 0}
    liquidity = CAPITAL_ETH / unit
    fees, touched, final_price = 0.0, False, reference
    entry_bucket = int(bars.iloc[0].bucket)
    for row in bars[bars.bucket <= entry_bucket + expiry * 4].itertuples():
        price = token_price_eth(pool, int(row.close_sqrt))
        if not math.isfinite(price) or price <= 0:
            continue
        final_price = price
        active = lower <= price <= upper
        touched = touched or price <= upper
        if active and row.close_liquidity > 0:
            share = min(0.05, liquidity / (float(row.close_liquidity) + liquidity))
            fees += float(row.fee_eth) * share * 0.75
        value = liquidity * range_value_per_raw_liquidity(pool, price, lower, upper) + fees
        if touched and price >= upper:
            final = max(0, value - 2 * ACTION_COST_ETH)
            return {"return_pct": (final / CAPITAL_ETH - 1) * 100, "touched": True,
                    "completed": True, "stopped": False, "fees_pct": fees / CAPITAL_ETH * 100}
        if price <= lower * (1 - stop):
            final = max(0, value - 2 * ACTION_COST_ETH)
            return {"return_pct": (final / CAPITAL_ETH - 1) * 100, "touched": touched,
                    "completed": False, "stopped": True, "fees_pct": fees / CAPITAL_ETH * 100}
    final = liquidity * range_value_per_raw_liquidity(pool, final_price, lower, upper) + fees - 2 * ACTION_COST_ETH
    return {"return_pct": (max(0, final) / CAPITAL_ETH - 1) * 100, "touched": touched,
            "completed": False, "stopped": False, "fees_pct": fees / CAPITAL_ETH * 100}


def centered_replay(pool: LaunchPool, bars: pd.DataFrame, width: float, stop: float, expiry: int) -> dict:
    if len(bars) < 2:
        return {"return_pct": np.nan, "fees_pct": 0, "stopped": False}
    entry = token_price_eth(pool, int(bars.iloc[0].close_sqrt))
    lower, upper = entry / (1 + width), entry * (1 + width)
    unit = range_value_per_raw_liquidity(pool, entry, lower, upper)
    if not math.isfinite(unit) or unit <= 0:
        return {"return_pct": np.nan, "fees_pct": 0, "stopped": False}
    liquidity, fees, final_price, stopped = CAPITAL_ETH / unit, 0.0, entry, False
    value = CAPITAL_ETH
    entry_bucket = int(bars.iloc[0].bucket)
    for row in bars[bars.bucket <= entry_bucket + expiry * 4].itertuples():
        price = token_price_eth(pool, int(row.close_sqrt))
        if not math.isfinite(price) or price <= 0:
            continue
        final_price = price
        if lower <= price <= upper and row.close_liquidity > 0:
            share = min(0.05, liquidity / (float(row.close_liquidity) + liquidity))
            fees += float(row.fee_eth) * share * 0.75
        value = liquidity * range_value_per_raw_liquidity(pool, price, lower, upper) + fees
        if price <= entry * (1 - stop):
            stopped = True
            break
    final = max(0, value - 2 * ACTION_COST_ETH)
    return {"return_pct": (final / CAPITAL_ETH - 1) * 100,
            "fees_pct": fees / CAPITAL_ETH * 100, "stopped": stopped}


def main() -> None:
    screen = pd.read_csv(OUT / "multicohort_screen.csv")
    candidates = screen[screen.doppler_lp_gate == True].copy()
    bars = collect(candidates)
    bars.to_csv(OUT / "doppler_7d_bars.csv", index=False)
    pools = [LaunchPool(pool_id=r.pool_id, token=r.token, eth_side=int(r.eth_side), init_block=int(r.init_block),
                        fee=int(r.fee), tick_spacing=int(r.tick_spacing), hook=r.hook) for r in candidates.itertuples()]
    token_metadata(pools)
    by_id = {p.pool_id: p for p in pools}
    outcomes = []
    for inner in (.10, .20, .30):
        for outer in (.30, .50, .70):
            if outer <= inner:
                continue
            for stop in (.20, .35, .50):
                for expiry in (12, 24, 48, 96):
                    for row in candidates.itertuples():
                        result = bid_replay(by_id[row.pool_id], bars[bars.pool_id == row.pool_id], inner, outer, stop, expiry)
                        outcomes.append({"day": row.day, "pool_id": row.pool_id, "inner": inner, "outer": outer,
                                         "stop": stop, "expiry_hours": expiry, **result})
    frame = pd.DataFrame(outcomes)
    frame.to_csv(OUT / "doppler_bid_outcomes.csv", index=False)
    summary = frame.groupby(["inner", "outer", "stop", "expiry_hours"]).agg(
        pools=("pool_id", "size"), mean_return_pct=("return_pct", "mean"),
        median_return_pct=("return_pct", "median"), worst_return_pct=("return_pct", "min"),
        positive_pct=("return_pct", lambda s: (s > 0).mean()), touched_pct=("touched", "mean"),
        completed_pct=("completed", "mean"), stopped_pct=("stopped", "mean"), fees_pct=("fees_pct", "mean"),
    ).reset_index()
    summary[["positive_pct", "touched_pct", "completed_pct", "stopped_pct"]] *= 100
    summary.to_csv(OUT / "doppler_bid_summary.csv", index=False)
    print(summary.sort_values(["median_return_pct", "mean_return_pct"], ascending=False).head(15).to_string(index=False))

    centered = []
    for width in (.20, .40, .70, 1.00):
        for stop in (.10, .20, .30):
            for expiry in (1, 2, 4, 6, 12):
                for row in candidates.itertuples():
                    result = centered_replay(by_id[row.pool_id], bars[bars.pool_id == row.pool_id], width, stop, expiry)
                    centered.append({"day": row.day, "pool_id": row.pool_id, "width": width,
                                     "stop": stop, "expiry_hours": expiry, **result})
    centered_frame = pd.DataFrame(centered)
    centered_frame.to_csv(OUT / "doppler_centered_outcomes.csv", index=False)
    centered_summary = centered_frame.groupby(["width", "stop", "expiry_hours"]).agg(
        pools=("pool_id", "size"), mean_return_pct=("return_pct", "mean"),
        median_return_pct=("return_pct", "median"), worst_return_pct=("return_pct", "min"),
        positive_pct=("return_pct", lambda s: (s > 0).mean()), stopped_pct=("stopped", "mean"),
        fees_pct=("fees_pct", "mean"),
    ).reset_index()
    centered_summary[["positive_pct", "stopped_pct"]] *= 100
    centered_summary.to_csv(OUT / "doppler_centered_summary.csv", index=False)
    print("\nCentered volatility harvest")
    print(centered_summary.sort_values(["median_return_pct", "mean_return_pct"], ascending=False).head(15).to_string(index=False))


if __name__ == "__main__":
    main()
