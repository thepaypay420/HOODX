"""Independent-cohort launch research using a private archive RPC.

Read-only. No transaction is signed or broadcast. Raw responses are cached under
an ignored directory; compact derived evidence is written as CSV/JSON.
"""

from __future__ import annotations

import bisect
import hashlib
import json
import math
import os
import statistics
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from eth_abi import decode
from web3 import Web3

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "launch_hunter_multicohort_results"
CACHE = OUT / "cache"
OUT.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

RPC = os.environ.get("LAUNCH_HUNTER_RPC_URL")
if not RPC:
    raise SystemExit("LAUNCH_HUNTER_RPC_URL is required; use the private RPC runner.")

MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
ZERO = "0x0000000000000000000000000000000000000000"
INIT_TOPIC = "0x" + Web3.keccak(text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex()
SWAP_TOPIC = "0x" + Web3.keccak(text="Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)").hex()
BLOCKS_PER_HOUR = 35_609
COHORT_DATES = ["2026-09-13", "2026-09-15", "2026-09-17", "2026-09-20"]
PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
UNISWAP_INITIALIZER_HOOKS = {
    "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544",  # canonical DopplerHookInitializer
    "0x5fb5229fba341dfe5a7e6a14d4809d6cf887a000",  # v3.3.0
    "0xd462a559337859369ef271814851a18f496ba000",  # v3.1.1
}
UNISWAP_INSTANT_STRATEGIES = {
    "0x7c48dde3b447381f4d986334679b3afc7f2d35c2",  # v3.3 creator fees
    "0xc9566675b1ea42861546f3c5b74ace2c79c49572",  # v3.3 no creator fees
    "0x23f8209572b4a1c2ad88a42749e830791fb027f1",  # v3.2 creator fees
    "0xad44d55e7f8337c3ce113fbb591486e85be104b2",  # v3.2 no creator fees
}

session = requests.Session()
session.verify = False


def rpc(method: str, params: list, timeout: int = 90):
    for attempt in range(6):
        try:
            response = session.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=timeout)
            if response.status_code == 429:
                raise RuntimeError("rate limited")
            response.raise_for_status()
            payload = response.json()
            if "error" in payload:
                raise RuntimeError(payload["error"])
            return payload["result"]
        except Exception:
            if attempt == 5:
                raise RuntimeError(f"private RPC failed after bounded retries for {method}")
            time.sleep(min(20, 2**attempt))


def rpc_batch(calls: list[tuple[str, list]], timeout: int = 120) -> list:
    body = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
    for attempt in range(6):
        try:
            response = session.post(RPC, json=body, timeout=timeout)
            if response.status_code == 429:
                raise RuntimeError("rate limited")
            response.raise_for_status()
            payload = response.json()
            by_id = {row["id"]: row for row in payload}
            time.sleep(0.15)
            return [by_id.get(i, {}).get("result") for i in range(len(calls))]
        except Exception:
            if attempt == 5:
                raise RuntimeError("private RPC batch failed after bounded retries")
            time.sleep(min(30, 2**attempt))


def block_at(timestamp: int) -> int:
    latest = int(rpc("eth_blockNumber", []), 16)
    low, high = 1, latest
    while low < high:
        mid = (low + high) // 2
        block = rpc("eth_getBlockByNumber", [hex(mid), False])
        if int(block["timestamp"], 16) < timestamp:
            low = mid + 1
        else:
            high = mid
    return low


def get_logs_resilient(query: dict, min_span: int = 500) -> tuple[list[dict], bool]:
    try:
        rows = rpc("eth_getLogs", [query], timeout=90)
        return rows, True
    except Exception:
        lo, hi = int(query["fromBlock"], 16), int(query["toBlock"], 16)
        if hi - lo <= min_span:
            return [], False
        mid = (lo + hi) // 2
        left = {**query, "toBlock": hex(mid)}
        right = {**query, "fromBlock": hex(mid + 1)}
        a, a_ok = get_logs_resilient(left, min_span)
        b, b_ok = get_logs_resilient(right, min_span)
        return a + b, a_ok and b_ok


def address_topic(topic: str) -> str:
    return ("0x" + topic[-40:]).lower()


def load_cohort(day: str) -> dict:
    path = CACHE / f"cohort_{day}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    start_ts = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
    start, end = block_at(start_ts), block_at(start_ts + 6 * 3600)
    logs, complete = get_logs_resilient({"address": MANAGER, "fromBlock": hex(start), "toBlock": hex(end), "topics": [INIT_TOPIC]})
    pools = []
    for log in logs:
        c0, c1 = address_topic(log["topics"][2]), address_topic(log["topics"][3])
        if (c0 in {ZERO, WETH}) == (c1 in {ZERO, WETH}):
            continue
        fee, spacing, hook, _, _ = decode(["uint24", "int24", "address", "uint160", "int24"], bytes.fromhex(log["data"][2:]))
        pools.append({
            "day": day, "pool_id": log["topics"][1].lower(), "token": c1 if c0 in {ZERO, WETH} else c0,
            "eth_side": 0 if c0 in {ZERO, WETH} else 1, "init_block": int(log["blockNumber"], 16),
            "init_tx": log["transactionHash"], "fee": int(fee), "tick_spacing": int(spacing), "hook": hook.lower(),
        })
    result = {"day": day, "start": start, "end": end, "complete": complete, "pools": pools}
    path.write_text(json.dumps(result), encoding="utf-8")
    return result


def observation_logs(cohort: dict) -> tuple[dict[str, list], bool]:
    day = cohort["day"]
    path = CACHE / f"observations_{day}.json"
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        return cached["logs"], cached["complete"]
    pools = cohort["pools"]
    result = {pool["pool_id"]: [] for pool in pools}
    complete = True
    # QuickNode caps eth_getLogs at 10,000 blocks. Large topic-OR groups keep
    # the exact-pool filter while reducing the number of archive requests.
    block_ranges = []
    cursor, final = cohort["start"], cohort["end"] + 2 * BLOCKS_PER_HOUR
    while cursor <= final:
        block_ranges.append((cursor, min(cursor + 9_999, final)))
        cursor += 10_000
    for start in range(0, len(pools), 1_000):
        ids = [pool["pool_id"] for pool in pools[start:start + 1_000]]
        for lo, hi in block_ranges:
            rows, ok = get_logs_resilient({
                "address": MANAGER, "fromBlock": hex(lo), "toBlock": hex(hi),
                "topics": [SWAP_TOPIC, ids],
            })
            complete = complete and ok
            for row in rows:
                pool_id = row["topics"][1].lower()
                if pool_id in result:
                    result[pool_id].append(row)
    path.write_text(json.dumps({"complete": complete, "logs": result}), encoding="utf-8")
    return result, complete


def decode_swap(log: dict, eth_side: int) -> dict:
    a0, a1, sqrt_price, liquidity, tick, fee = decode(
        ["int128", "int128", "uint160", "uint128", "int24", "uint24"], bytes.fromhex(log["data"][2:])
    )
    eth_raw = int(a0 if eth_side == 0 else a1)
    return {"block": int(log["blockNumber"], 16), "tx": log["transactionHash"], "eth": eth_raw / 1e18,
            "sqrt": int(sqrt_price), "liquidity": int(liquidity), "fee": int(fee), "tick": int(tick)}


def flow_metrics(pool: dict, logs: list[dict]) -> dict:
    cutoff = pool["init_block"] + 2 * BLOCKS_PER_HOUR
    rows = [decode_swap(log, pool["eth_side"]) for log in logs if int(log["blockNumber"], 16) <= cutoff]
    volumes = [abs(row["eth"]) for row in rows]
    positives, negatives = sum(row["eth"] > 0 for row in rows), sum(row["eth"] < 0 for row in rows)
    balance = min(positives, negatives) / max(positives, negatives) if max(positives, negatives) else 0
    bucket = max(1, BLOCKS_PER_HOUR // 4)
    buckets = len({min(7, (row["block"] - pool["init_block"]) // bucket) for row in rows})
    total = sum(volumes)
    repeated = max(Counter(round(v, 8) for v in volumes).values()) / len(volumes) if volumes else 1
    # Five-minute signed markout in token/ETH terms. Positive means the token
    # moved in the trader's direction after the swap and was toxic to the LP.
    markouts = []
    blocks = [row["block"] for row in rows]
    prices = [(row["sqrt"] / 2**96) ** 2 for row in rows]
    horizon = BLOCKS_PER_HOUR // 12
    for i, row in enumerate(rows):
        j = bisect.bisect_left(blocks, row["block"] + horizon)
        if j < len(rows) and prices[i] > 0 and prices[j] > 0:
            raw_move = math.log(prices[j] / prices[i])
            # In both PoolKey orientations, positive ETH delta means the pool
            # received ETH and the trader bought the launch token.
            token_buy = row["eth"] > 0
            token_price_move = raw_move if pool["eth_side"] == 1 else -raw_move
            markouts.append(token_price_move * (1 if token_buy else -1))
    gross_fee_bps = (
        sum(abs(row["eth"]) * row["fee"] / 1_000_000 for row in rows) / total * 10_000
        if total else np.nan
    )
    markout_bps = statistics.median(markouts) * 10_000 if markouts else np.nan
    return {
        "swaps_2h": len(rows), "volume_eth_2h": total, "side_balance_2h": balance,
        "active_15m_buckets_2h": buckets,
        "top10_volume_share_2h": sum(sorted(volumes, reverse=True)[:10]) / total if total else 1,
        "repeated_size_share_2h": repeated,
        "median_swap_eth_2h": statistics.median(volumes) if volumes else 0,
        "gross_fee_bps": gross_fee_bps,
        "markout_5m_bps": markout_bps,
        "fee_minus_markout_bps": gross_fee_bps - markout_bps,
    }


def sender_metrics(pool_id: str, logs: list[dict]) -> dict:
    path = CACHE / "sender_metrics.json"
    cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if pool_id in cache:
        return cache[pool_id]
    hashes = list(dict.fromkeys(log["transactionHash"] for log in logs))
    if len(hashes) > 256:
        indexes = np.linspace(0, len(hashes) - 1, 256).astype(int)
        hashes = [hashes[i] for i in indexes]
    senders = []
    for start in range(0, len(hashes), 32):
        calls = [("eth_getTransactionByHash", [tx]) for tx in hashes[start:start + 32]]
        for tx in rpc_batch(calls):
            if tx and tx.get("from"):
                senders.append(tx["from"].lower())
    counts = Counter(senders)
    result = {"sampled_txs": len(senders), "unique_senders": len(counts),
              "top_sender_share": max(counts.values()) / len(senders) if senders else 1}
    cache[pool_id] = result
    path.write_text(json.dumps(cache), encoding="utf-8")
    return result


def provenance_metrics(pool: dict) -> dict:
    path = CACHE / "provenance_metrics.json"
    cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if pool["pool_id"] in cache:
        return cache[pool["pool_id"]]
    init_tx = pool.get("init_tx") or ""
    tx = rpc("eth_getTransactionByHash", [init_tx]) if len(init_tx) == 66 else None
    tx_to = (tx.get("to") or "").lower() if tx else ""
    tx_from = (tx.get("from") or "").lower() if tx else ""
    hook = pool["hook"]
    if hook == PONS_HOOK:
        family = "pons_v2_hook_fee"
    elif hook in UNISWAP_INITIALIZER_HOOKS:
        family = "uniswap_launchpad_lbp"
    elif hook == ZERO and tx_to in UNISWAP_INSTANT_STRATEGIES:
        family = "uniswap_launchpad_instant"
    elif hook == ZERO:
        family = "hookless_unverified_origin"
    else:
        family = "unknown_hook"
    result = {"init_tx_to": tx_to, "init_tx_from": tx_from, "origin_family": family}
    cache[pool["pool_id"]] = result
    path.write_text(json.dumps(cache), encoding="utf-8")
    return result


def main() -> None:
    rows = []
    for day in COHORT_DATES:
        cohort = load_cohort(day)
        logs_by_pool, observation_complete = observation_logs(cohort)
        for pool in cohort["pools"]:
            logs = logs_by_pool.get(pool["pool_id"], [])
            metrics = flow_metrics(pool, logs)
            gate = (
                observation_complete and metrics["swaps_2h"] >= 40 and metrics["volume_eth_2h"] >= 0.5
                and metrics["side_balance_2h"] >= 0.40 and metrics["active_15m_buckets_2h"] >= 6
                and metrics["top10_volume_share_2h"] <= 0.70 and metrics["repeated_size_share_2h"] <= 0.30
            )
            row = {**pool, **metrics, "market_gate": gate}
            if gate:
                row.update(sender_metrics(pool["pool_id"], logs))
                row.update(provenance_metrics(pool))
            row["flow_gate"] = bool(
                gate
                and row.get("unique_senders", 0) >= 20
                and row.get("top_sender_share", 1) <= 0.10
                and row["fee_minus_markout_bps"] >= 0
            )
            row["doppler_lp_gate"] = bool(
                pool["hook"] == "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544"
                and metrics["swaps_2h"] >= 10
                and metrics["volume_eth_2h"] >= 0.10
                and metrics["active_15m_buckets_2h"] >= 4
                and metrics["side_balance_2h"] >= 0.40
            )
            rows.append(row)
        pd.DataFrame(rows).to_csv(OUT / "multicohort_screen.csv", index=False)
    frame = pd.DataFrame(rows)
    summary = frame.groupby("day").agg(
        initialized=("pool_id", "size"), market_gate=("market_gate", "sum"), flow_gate=("flow_gate", "sum"),
        doppler_lp_gate=("doppler_lp_gate", "sum"),
        median_gross_fee_bps=("gross_fee_bps", "median"),
        median_markout_bps=("markout_5m_bps", "median"),
        median_fee_minus_markout_bps=("fee_minus_markout_bps", "median"),
    ).reset_index()
    summary.to_csv(OUT / "cohort_summary.csv", index=False)
    manifest = {
        "cohorts": COHORT_DATES, "initialized": int(len(frame)), "market_gate": int(frame.market_gate.sum()),
        "flow_gate": int(frame.flow_gate.sum()),
        "doppler_lp_gate": int(frame.doppler_lp_gate.sum()),
        "selection_rate_pct": float(frame.market_gate.mean() * 100),
        "rpc": "private archive endpoint (credential omitted)",
        "decision": "Metrics are research evidence only; no transaction was sent.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print(summary.to_string(index=False))


if __name__ == "__main__":
    main()
