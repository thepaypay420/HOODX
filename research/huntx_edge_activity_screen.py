"""Sampled activity screen over ALL V4 pools (read-only).

Purpose: find which of the ~932k registered pools carry USDG/WETH/native-ETH-quoted flow,
without downloading ~70 GB of full Swap logs. Six evenly spaced 8,000-block
windows (~13 min each) per UTC day, 2026-08-18 .. 2026-09-29. This screen only
nominates pools for the COMPLETE filtered scan (huntx_edge_panel_scan.py); it is
never used to measure outcomes. Its selection threshold is deliberately loose
and fixed before any outcome is computed.
"""

from __future__ import annotations

import collections
import gzip
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from feex_next_day_check import rpc
NATIVE = "0x" + "0" * 40
from huntx_edge_chain import MANAGER, SWAP_TOPIC, USDG, WETH, block_at, decode_swap

ROOT = Path(__file__).parent
REG = ROOT / "huntx_edge_registry.json.gz"
BOUNDS = ROOT / "huntx_edge_day_bounds.json"
OUT = ROOT / "huntx_edge_activity_screen.json"
FIRST_DAY = datetime(2026, 8, 18, tzinfo=timezone.utc)
LAST_DAY = datetime(2026, 9, 29, tzinfo=timezone.utc)
WINDOW = 8_000
PER_DAY = 6


def day_bounds():
    if BOUNDS.exists():
        return json.loads(BOUNDS.read_text())
    days, d = [], FIRST_DAY
    while d <= LAST_DAY + timedelta(days=1):
        days.append(d)
        d += timedelta(days=1)
    latest = int(rpc("eth_blockNumber", []), 16)
    bounds = {day.date().isoformat(): block_at(int(day.timestamp()), latest, low=9_070) for day in days}
    BOUNDS.write_text(json.dumps(bounds, indent=2))
    return bounds


def main():
    reg = json.load(gzip.open(REG, "rt", encoding="utf-8"))
    meta = {p["pool_id"]: p for p in reg["pools"]}
    bounds = day_bounds()
    keys = sorted(bounds)
    windows = []
    for i in range(len(keys) - 1):
        a, b = bounds[keys[i]], bounds[keys[i + 1]]
        step = (b - a) // PER_DAY
        windows += [(keys[i], a + k * step, a + k * step + WINDOW - 1) for k in range(PER_DAY)]

    def scan(w):
        day, a, b = w
        agg = collections.defaultdict(lambda: [0, 0.0, 0])
        for row in rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(a), "toBlock": hex(b),
                                        "topics": [SWAP_TOPIC]}], timeout=90):
            s = decode_swap(row)
            p = meta.get(s["pool_id"])
            if p is None:
                continue
            if USDG in (p["currency0"], p["currency1"]):
                q, amt = "USDG", s["amount0"] if p["currency0"] == USDG else s["amount1"]
            elif WETH in (p["currency0"], p["currency1"]):
                q, amt = "WETH", s["amount0"] if p["currency0"] == WETH else s["amount1"]
            elif p["currency0"] == NATIVE:  # native ETH always sorts first
                q, amt = "ETH", s["amount0"]
            else:
                continue
            rec = agg[s["pool_id"]]
            rec[0] += 1
            rec[1] += abs(amt) / (1e6 if q == "USDG" else 1e18)
            rec[2] = q
        return day, dict(agg)

    per_pool = collections.defaultdict(lambda: {"swaps": 0, "quote_volume": 0.0, "days": set(), "quote": None})
    with ThreadPoolExecutor(max_workers=6) as ex:
        for day, agg in ex.map(scan, windows):
            for pid, (n, v, q) in agg.items():
                r = per_pool[pid]
                r["swaps"] += n
                r["quote_volume"] += v
                r["days"].add(day)
                r["quote"] = q
    rows = []
    for pid, r in per_pool.items():
        p = meta[pid]
        rows.append({"pool_id": pid, "quote": r["quote"], "sampled_swaps": r["swaps"],
                     "sampled_quote_volume": round(r["quote_volume"], 6), "active_days": len(r["days"]),
                     "first_sample_day": min(r["days"]), "last_sample_day": max(r["days"]),
                     "currency0": p["currency0"], "currency1": p["currency1"], "fee": p["fee"],
                     "tick_spacing": p["tick_spacing"], "hooks": p["hooks"], "init_block": p["init_block"]})
    rows.sort(key=lambda r: -r["sampled_swaps"])
    OUT.write_text(json.dumps({"method": __doc__.strip(), "windows": len(windows), "window_blocks": WINDOW,
                               "day_bounds": bounds, "pools": rows}, indent=1))
    print(json.dumps({"windows": len(windows), "pools_with_quote_swaps": len(rows),
                      "usdg": sum(r["quote"] == "USDG" for r in rows),
                      "weth": sum(r["quote"] == "WETH" for r in rows),
                      "eth": sum(r["quote"] == "ETH" for r in rows)}))


if __name__ == "__main__":
    main()
