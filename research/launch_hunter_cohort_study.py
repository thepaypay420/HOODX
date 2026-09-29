"""Historical on-chain cohort study for the HOODX Launch Hunter design.

The study samples every ETH/WETH Uniswap-v4 pool initialized during a fixed
six-hour window, including pools that never became visible in market-data
rankings. It uses PoolManager events only and never sends transactions.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
import time
import collections
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import urllib3
from eth_abi import decode
from web3 import Web3

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "launch_hunter_results"
CACHE = OUT / "cache"
OUT.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

RPC = os.environ.get("LAUNCH_HUNTER_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
ZERO = "0x0000000000000000000000000000000000000000"
INIT_FROM = 67_494_668  # 2026-09-20 00:00 UTC
INIT_TO = 67_708_325    # 2026-09-20 06:00 UTC
BLOCKS_PER_HOUR = (INIT_TO - INIT_FROM) / 6
ETH_USD = 2_680.0
POSITION_USD = 20.0
ACTION_COST_USD = 0.20
MAX_HISTORY_LOGS = 25_000
Q96 = 2**96

INIT_TOPIC = "0x" + Web3.keccak(text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex()
SWAP_TOPIC = "0x" + Web3.keccak(text="Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)").hex()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
SESSION = requests.Session()
SESSION.verify = False


def rpc(method: str, params: list, timeout: int = 90):
    response = SESSION.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return payload["result"]


def rpc_batch(calls: list[tuple[str, list]], timeout: int = 120) -> list:
    body = [{"jsonrpc": "2.0", "id": i, "method": method, "params": params} for i, (method, params) in enumerate(calls)]
    for attempt in range(2):
        try:
            response = SESSION.post(RPC, json=body, timeout=timeout)
            response.raise_for_status()
            by_id = {item["id"]: item for item in response.json()}
            return [by_id[i].get("result", []) for i in range(len(calls))]
        except requests.RequestException:
            time.sleep(2**attempt)
    raise RuntimeError("bounded RPC batch retries exhausted")


def address_topic(topic: str) -> str:
    return "0x" + topic[-40:]


def signed_word(word: bytes, bits: int) -> int:
    value = int.from_bytes(word, "big")
    if value >= 2 ** (bits - 1):
        value -= 2**bits
    return value


@dataclass
class LaunchPool:
    pool_id: str
    token: str
    eth_side: int
    init_block: int
    fee: int
    tick_spacing: int
    hook: str
    token_decimals: int = 18
    symbol: str = "?"


def load_cohort() -> list[LaunchPool]:
    path = CACHE / "cohort.json"
    if path.exists():
        return [LaunchPool(**row) for row in json.loads(path.read_text(encoding="utf-8"))]
    logs = rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(INIT_FROM), "toBlock": hex(INIT_TO), "topics": [INIT_TOPIC]}])
    pools = []
    for log in logs:
        c0, c1 = address_topic(log["topics"][2]), address_topic(log["topics"][3])
        c0, c1 = c0.lower(), c1.lower()
        if c0 not in {ZERO, WETH} and c1 not in {ZERO, WETH}:
            continue
        if c0 in {ZERO, WETH} and c1 in {ZERO, WETH}:
            continue
        fee, spacing, hook, _, _ = decode(["uint24", "int24", "address", "uint160", "int24"], bytes.fromhex(log["data"][2:]))
        pools.append(LaunchPool(
            pool_id=log["topics"][1].lower(), token=c1 if c0 in {ZERO, WETH} else c0,
            eth_side=0 if c0 in {ZERO, WETH} else 1, init_block=int(log["blockNumber"], 16),
            fee=int(fee), tick_spacing=int(spacing), hook=hook.lower(),
        ))
    path.write_text(json.dumps([p.__dict__ for p in pools]), encoding="utf-8")
    return pools


def _pool_logs(pool: LaunchPool, start: int, end: int, min_span: int | None = None) -> tuple[list[dict], bool]:
    """Read one pool with bounded recursive splitting; fail closed if still too large."""
    min_span = min_span or int(BLOCKS_PER_HOUR / 2)
    params = [{"address": MANAGER, "fromBlock": hex(start), "toBlock": hex(end), "topics": [SWAP_TOPIC, pool.pool_id]}]
    try:
        rows = rpc("eth_getLogs", params, timeout=45)
        if len(rows) > MAX_HISTORY_LOGS:
            return [], False
        return rows, True
    except Exception:
        if end - start <= min_span:
            return [], False
        midpoint = (start + end) // 2
        left, left_ok = _pool_logs(pool, start, midpoint, min_span)
        right, right_ok = _pool_logs(pool, midpoint + 1, end, min_span)
        if not left_ok or not right_ok or len(left) + len(right) > MAX_HISTORY_LOGS:
            return [], False
        return left + right, True


def swap_logs(pools: list[LaunchPool], hours: int, label: str) -> dict[str, dict]:
    path = CACHE / f"swaps_{label}.json"
    cached = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    # Upgrade the first cache format, which stored only the log array.
    result: dict[str, dict] = {
        key: value if isinstance(value, dict) and "logs" in value else {"logs": value, "complete": True}
        for key, value in cached.items()
    }
    remaining = [pool for pool in pools if pool.pool_id not in result]
    for pool in remaining:
        end = pool.init_block + int(BLOCKS_PER_HOUR * hours)
        logs, complete = _pool_logs(pool, pool.init_block, end)
        result[pool.pool_id] = {"logs": logs, "complete": complete}
        path.write_text(json.dumps(result), encoding="utf-8")
    return result


def cohort_observation_logs(pools: list[LaunchPool]) -> dict[str, list[dict]]:
    """Fetch the eight-hour cohort window once, then partition by pool id."""
    path = CACHE / "cohort_observation_logs.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    end = INIT_TO + int(2 * BLOCKS_PER_HOUR)
    ranges = [(start, min(start + 4_999, end)) for start in range(INIT_FROM, end + 1, 5_000)]
    all_logs = []
    for start in range(0, len(ranges), 5):
        batch = ranges[start:start + 5]
        calls = [("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(lo), "toBlock": hex(hi), "topics": [SWAP_TOPIC]}]) for lo, hi in batch]
        for logs in rpc_batch(calls):
            all_logs.extend(logs)
    pool_ids = {pool.pool_id for pool in pools}
    result = {pool_id: [] for pool_id in pool_ids}
    for log in all_logs:
        pool_id = log["topics"][1].lower()
        if pool_id in result:
            result[pool_id].append(log)
    path.write_text(json.dumps(result), encoding="utf-8")
    return result


def decode_swap(log: dict) -> dict:
    amount0, amount1, sqrt_price, liquidity, tick, fee = decode(
        ["int128", "int128", "uint160", "uint128", "int24", "uint24"], bytes.fromhex(log["data"][2:])
    )
    return {
        "block": int(log["blockNumber"], 16), "tx": log["transactionHash"],
        "amount0": int(amount0), "amount1": int(amount1), "sqrt": int(sqrt_price),
        "liquidity": int(liquidity), "tick": int(tick), "fee": int(fee),
    }


def initial_metrics(pool: LaunchPool, logs: list[dict]) -> dict:
    swaps = [decode_swap(log) for log in logs]
    cutoff = pool.init_block + int(2 * BLOCKS_PER_HOUR)
    observed = [row for row in swaps if row["block"] <= cutoff]
    eth_amount = "amount0" if pool.eth_side == 0 else "amount1"
    volumes = [abs(row[eth_amount]) / 1e18 for row in observed]
    positives = sum(row[eth_amount] > 0 for row in observed)
    negatives = sum(row[eth_amount] < 0 for row in observed)
    balance = min(positives, negatives) / max(positives, negatives) if max(positives, negatives) else 0
    bucket_span = max(1, int(BLOCKS_PER_HOUR / 4))
    active_buckets = len({min(7, (row["block"] - pool.init_block) // bucket_span) for row in observed})
    top_ten_share = sum(sorted(volumes, reverse=True)[:10]) / sum(volumes) if sum(volumes) else 1
    rounded = [round(value, 8) for value in volumes]
    repeated_share = max(collections.Counter(rounded).values()) / len(rounded) if rounded else 1
    return {
        "swaps_2h": len(observed), "volume_eth_2h": sum(volumes), "side_balance_2h": balance,
        "active_15m_buckets_2h": active_buckets, "top10_volume_share_2h": top_ten_share,
        "repeated_size_share_2h": repeated_share, "median_swap_eth_2h": statistics.median(volumes) if volumes else 0,
        "directions_2h": min(positives, negatives), "swaps_24h": len(swaps),
        "volume_eth_24h": sum(abs(row[eth_amount]) / 1e18 for row in swaps),
    }


def token_metadata(pools: list[LaunchPool]) -> None:
    cache_path = CACHE / "token_metadata.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    decimals_selector, symbol_selector = "0x313ce567", "0x95d89b41"
    for pool in pools:
        if pool.token in cache:
            pool.token_decimals = cache[pool.token]["decimals"]
            pool.symbol = cache[pool.token]["symbol"]
            continue
        values = []
        for selector in (decimals_selector, symbol_selector):
            try:
                values.append(rpc("eth_call", [{"to": pool.token, "data": selector}, "latest"], timeout=20))
            except Exception:
                values.append("0x")
        for offset, value in enumerate(values):
            if not isinstance(value, str) or value == "0x":
                continue
            try:
                if offset == 0:
                    pool.token_decimals = min(36, int(value, 16))
                else:
                    raw = bytes.fromhex(value[2:])
                    try:
                        pool.symbol = decode(["string"], raw)[0][:24]
                    except Exception:
                        pool.symbol = raw[:32].rstrip(b"\x00").decode("utf-8", "replace")[:24]
            except Exception:
                pass
        cache[pool.token] = {"decimals": pool.token_decimals, "symbol": pool.symbol}
        cache_path.write_text(json.dumps(cache), encoding="utf-8")


def token_price_eth(pool: LaunchPool, sqrt_x96: int) -> float:
    raw_token1_per_token0 = (sqrt_x96 / Q96) ** 2
    if pool.eth_side == 1:  # token0 / ETH token1
        return raw_token1_per_token0 * 10 ** (pool.token_decimals - 18)
    # ETH token0 / token token1
    token_per_eth = raw_token1_per_token0 * 10 ** (18 - pool.token_decimals)
    return 1 / token_per_eth if token_per_eth > 0 else 0


def raw_sqrt_from_token_price(pool: LaunchPool, price_eth: float) -> float:
    if pool.eth_side == 1:
        raw_ratio = price_eth * 10 ** (18 - pool.token_decimals)
    else:
        raw_ratio = (1 / price_eth) * 10 ** (pool.token_decimals - 18)
    return math.sqrt(raw_ratio)


def range_value_per_raw_liquidity(pool: LaunchPool, price: float, lower: float, upper: float) -> float:
    """ETH value produced by one raw v4 liquidity unit at a human token price."""
    s = raw_sqrt_from_token_price(pool, price)
    a = raw_sqrt_from_token_price(pool, lower)
    b = raw_sqrt_from_token_price(pool, upper)
    sl, su = min(a, b), max(a, b)
    if s <= sl:
        amount0_raw, amount1_raw = (su - sl) / (sl * su), 0
    elif s >= su:
        amount0_raw, amount1_raw = 0, su - sl
    else:
        amount0_raw, amount1_raw = (su - s) / (s * su), s - sl
    if pool.eth_side == 0:
        eth = amount0_raw / 1e18
        token = amount1_raw / 10**pool.token_decimals
    else:
        token = amount0_raw / 10**pool.token_decimals
        eth = amount1_raw / 1e18
    return token * price + eth


def simulate(pool: LaunchPool, logs: list[dict], width: float, downside_stop: float, runner: bool, observe_hours: int) -> dict:
    rows = logs if logs and "amount0" in logs[0] else [decode_swap(log) for log in logs]
    entry_block = pool.init_block + int(observe_hours * BLOCKS_PER_HOUR)
    rows = [row for row in rows if row["block"] >= entry_block]
    if len(rows) < 2:
        return {"return_pct": -100.0, "actions": 0, "winner": False, "stopped": True}
    entry = token_price_eth(pool, rows[0]["sqrt"])
    if not math.isfinite(entry) or entry <= 0:
        return {"return_pct": -100.0, "actions": 0, "winner": False, "stopped": True}
    capital_eth = POSITION_USD / ETH_USD
    lower, upper = entry / (1 + width), entry * (1 + width)
    liquidity = capital_eth / range_value_per_raw_liquidity(pool, entry, lower, upper)
    idle_eth, runner_tokens, fees_eth = 0.0, 0.0, 0.0
    actions, last_action = 0, entry_block - int(6 * BLOCKS_PER_HOUR)
    high, stopped, principal_recovered = entry, False, False
    for row in rows:
        price = token_price_eth(pool, row["sqrt"])
        if not math.isfinite(price) or price <= 0:
            continue
        high = max(high, price)
        active = lower <= price <= upper
        if active and row["liquidity"] > 0:
            share = min(0.05, liquidity / row["liquidity"])
            eth_amount = abs(row["amount0"] if pool.eth_side == 0 else row["amount1"]) / 1e18
            fees_eth += eth_amount * (row["fee"] / 1_000_000) * share * 0.50
        value = liquidity * range_value_per_raw_liquidity(pool, price, lower, upper) + fees_eth
        if runner_tokens:
            value += runner_tokens * price
        if price <= entry * (1 - downside_stop):
            idle_eth += max(0, value - ACTION_COST_USD / ETH_USD)
            liquidity = fees_eth = runner_tokens = 0
            actions += 1
            stopped = True
            break
        if runner and not principal_recovered and price >= 2 * entry:
            # Recover the initial capital. Retain a 5%-of-vault direct-token
            # runner only when the position can fund it from gains.
            runner_value = min(0.05 * (200 / ETH_USD), max(0, value - capital_eth))
            runner_tokens = runner_value / price
            idle_eth += min(capital_eth, max(0, value - runner_value - ACTION_COST_USD / ETH_USD))
            remaining = max(0, value - idle_eth - runner_value - ACTION_COST_USD / ETH_USD)
            lower, upper = price / (1 + width), price * (1 + width)
            liquidity = remaining / range_value_per_raw_liquidity(pool, price, lower, upper) if remaining else 0
            fees_eth = 0
            actions += 1
            principal_recovered = True
            last_action = row["block"]
        if price > upper and row["block"] - last_action >= int(1.5 * BLOCKS_PER_HOUR) and actions < 8:
            value = max(0, value - ACTION_COST_USD / ETH_USD - idle_eth - runner_tokens * price)
            lower, upper = price / (1 + width), price * (1 + width)
            liquidity = value / range_value_per_raw_liquidity(pool, price, lower, upper) if value else 0
            fees_eth = 0
            actions += 1
            last_action = row["block"]
        if runner_tokens and price <= high * 0.70:
            idle_eth += max(0, runner_tokens * price - ACTION_COST_USD / ETH_USD)
            runner_tokens = 0
            actions += 1
    final_price = token_price_eth(pool, rows[-1]["sqrt"])
    final = idle_eth + fees_eth + runner_tokens * final_price
    if liquidity:
        final += liquidity * range_value_per_raw_liquidity(pool, final_price, lower, upper)
    return {
        "return_pct": (final / capital_eth - 1) * 100, "actions": actions,
        "winner": high >= 2 * entry, "stopped": stopped, "principal_recovered": principal_recovered,
        "max_multiple": high / entry, "final_multiple": final_price / entry,
    }


def simulate_bid_range(
    pool: LaunchPool, logs: list[dict], observe_hours: int, inner_discount: float,
    outer_discount: float, stop_below_outer: float, max_hours: int,
) -> dict:
    """WETH-only range below spot: wait, buy a pullback, sell a rebound."""
    rows = logs if logs and "amount0" in logs[0] else [decode_swap(log) for log in logs]
    start_block = pool.init_block + int(observe_hours * BLOCKS_PER_HOUR)
    end_block = start_block + int(max_hours * BLOCKS_PER_HOUR)
    rows = [row for row in rows if start_block <= row["block"] <= end_block]
    if len(rows) < 2:
        return {"return_pct": np.nan, "actions": 0, "touched": False, "completed": False, "stopped": False}
    reference = token_price_eth(pool, rows[0]["sqrt"])
    upper, lower = reference * (1 - inner_discount), reference * (1 - outer_discount)
    if not (math.isfinite(reference) and 0 < lower < upper):
        return {"return_pct": np.nan, "actions": 0, "touched": False, "completed": False, "stopped": False}
    capital_eth = POSITION_USD / ETH_USD
    unit_value = range_value_per_raw_liquidity(pool, reference, lower, upper)
    liquidity = capital_eth / unit_value
    fees_eth, touched, completed, stopped = 0.0, False, False, False
    actions = 1  # mint the resting bid range
    final_price = reference
    for row in rows:
        price = token_price_eth(pool, row["sqrt"])
        if not math.isfinite(price) or price <= 0:
            continue
        final_price = price
        active = lower <= price <= upper
        touched = touched or price <= upper
        if active and row["liquidity"] > 0:
            share = min(0.05, liquidity / row["liquidity"])
            eth_amount = abs(row["amount0"] if pool.eth_side == 0 else row["amount1"]) / 1e18
            fees_eth += eth_amount * (row["fee"] / 1_000_000) * share * 0.50
        value = liquidity * range_value_per_raw_liquidity(pool, price, lower, upper) + fees_eth
        if touched and price >= upper:
            final = max(0, value - 2 * ACTION_COST_USD / ETH_USD)
            actions += 1
            completed = True
            return {"return_pct": (final / capital_eth - 1) * 100, "actions": actions, "touched": True, "completed": True, "stopped": False}
        if price <= lower * (1 - stop_below_outer):
            final = max(0, value - 2 * ACTION_COST_USD / ETH_USD)
            actions += 1
            stopped = True
            return {"return_pct": (final / capital_eth - 1) * 100, "actions": actions, "touched": touched, "completed": False, "stopped": True}
    final = liquidity * range_value_per_raw_liquidity(pool, final_price, lower, upper) + fees_eth
    final = max(0, final - 2 * ACTION_COST_USD / ETH_USD)
    actions += 1
    return {"return_pct": (final / capital_eth - 1) * 100, "actions": actions, "touched": touched, "completed": completed, "stopped": stopped}


def main() -> None:
    pools = load_cohort()
    day_logs = swap_logs(pools, 2, "2h")
    screen_rows = []
    selected = []
    for pool in pools:
        history = day_logs.get(pool.pool_id, {"logs": [], "complete": False})
        metrics = initial_metrics(pool, history["logs"])
        row = {**pool.__dict__, **metrics}
        # Selection uses only information available after two hours.
        row["market_gate"] = (
            history["complete"]
            and metrics["swaps_2h"] >= 40
            and metrics["volume_eth_2h"] >= 0.50
            and metrics["side_balance_2h"] >= 0.40
            and metrics["active_15m_buckets_2h"] >= 6
            and metrics["top10_volume_share_2h"] <= 0.70
            and metrics["repeated_size_share_2h"] <= 0.30
        )
        screen_rows.append(row)
        if row["market_gate"]:
            selected.append(pool)
    # Keep one pool per token: highest two-hour ETH volume.
    volume_by_id = {row["pool_id"]: row["volume_eth_2h"] for row in screen_rows}
    best: dict[str, LaunchPool] = {}
    for pool in selected:
        if pool.token not in best or volume_by_id[pool.pool_id] > volume_by_id[best[pool.token].pool_id]:
            best[pool.token] = pool
    selected = list(best.values())
    token_metadata(selected)
    week_logs = swap_logs(selected, 24 * 7, "7d_selected_v2")
    decoded_history = {
        pool.pool_id: [decode_swap(log) for log in week_logs.get(pool.pool_id, {"logs": []})["logs"]]
        for pool in selected
        if week_logs.get(pool.pool_id, {"complete": False})["complete"]
    }

    outcomes = []
    policies = [
        (observe, width, stop, runner)
        for observe in (2, 4, 6, 12)
        for width in (0.25, 0.40, 0.60)
        for stop in (0.15, 0.25, 0.35)
        for runner in (True, False)
    ]
    for pool in selected:
        base = next(row for row in screen_rows if row["pool_id"] == pool.pool_id)
        split = "test" if int(hashlib.sha256(pool.pool_id.encode()).hexdigest(), 16) % 5 == 0 else "train"
        for observe, width, stop, runner in policies:
            history = week_logs.get(pool.pool_id, {"logs": [], "complete": False})
            result = simulate(pool, decoded_history[pool.pool_id], width, stop, runner, observe) if history["complete"] else {
                "return_pct": np.nan, "actions": 0, "winner": False, "stopped": False,
                "principal_recovered": False, "max_multiple": np.nan, "final_multiple": np.nan,
            }
            outcomes.append({
                **base, "symbol": pool.symbol, "token_decimals": pool.token_decimals, "split": split,
                "history_complete": history["complete"], "observe_hours": observe, "width_pct": width * 100,
                "downside_stop_pct": stop * 100, "runner": runner, **result,
            })
    screen = pd.DataFrame(screen_rows)
    outcome = pd.DataFrame(outcomes)
    screen.to_csv(OUT / "full_cohort_screen.csv", index=False)
    outcome.to_csv(OUT / "selected_pool_outcomes.csv", index=False)

    summary_rows = []
    for keys, frame in outcome.groupby(["observe_hours", "width_pct", "downside_stop_pct", "runner", "split"]):
        returns = frame.return_pct.replace([np.inf, -np.inf], np.nan).dropna()
        summary_rows.append({
            "observe_hours": keys[0], "width_pct": keys[1], "downside_stop_pct": keys[2],
            "runner": keys[3], "split": keys[4],
            "pools": len(returns), "mean_return_pct": returns.mean(), "median_return_pct": returns.median(),
            "positive_pct": (returns > 0).mean() * 100, "loss_gt_50_pct": (returns < -50).mean() * 100,
            "p90_return_pct": returns.quantile(.90), "p10_return_pct": returns.quantile(.10),
            "winner_rate_pct": frame.winner.mean() * 100, "mean_actions": frame.actions.mean(),
        })
    summary = pd.DataFrame(summary_rows).sort_values(["split", "median_return_pct"], ascending=[True, False])
    summary.to_csv(OUT / "policy_summary.csv", index=False)
    manifest = {
        "cohort": "all ETH/WETH v4 pools initialized 2026-09-20 00:00–06:00 UTC",
        "initialized_pools": len(pools), "market_gate_passes": int(screen.market_gate.sum()),
        "complete_seven_day_histories": int(outcome.drop_duplicates("pool_id").history_complete.sum()),
        "unique_tokens_selected": len(selected),
        "selection_gate": "complete two-hour history; 40 swaps; 0.5 ETH; 0.40 side balance; active in 6/8 quarter-hours; top-10 trades <=70% volume; repeated exact sizes <=30%",
        "limitations": [
            "Market replay cannot prove token contract safety or future sellability.",
            "LP fee attribution uses emitted active liquidity, a 5% share cap and a 50% realization haircut.",
            "ETH/USD is fixed at $2,680 because results are evaluated in ETH terms.",
            "Transaction sender diversity requires archive transaction reads and is excluded from this first cohort replay.",
        ],
        "decision": "Shadow mode only. No tested policy established a repeatable positive held-out edge.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print(summary.to_string(index=False))


if __name__ == "__main__":
    main()
