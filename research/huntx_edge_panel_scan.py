"""Complete Swap-log scan for panel pools (read-only), 2026-08-18..2026-09-29.

Panel membership is fixed by the pre-registered rule applied to the sampled
screen (docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md section 1.3). Every
8,000-block chunk must succeed; a failed chunk aborts. Pool IDs are sent as a
server-side topic OR-list in batches of <= 1,000.
"""

from __future__ import annotations

import gzip
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, SWAP_TOPIC, decode_swap

ROOT = Path(__file__).parent
SCREEN = ROOT / "huntx_edge_activity_screen.json"
OUT = ROOT / "huntx_edge_panel_swaps.json.gz"
PREFILTER = ROOT / "huntx_edge_prefilter.json"
REGISTRY = ROOT / "huntx_edge_registry.json.gz"
EXTRA_POOLS: list[str] = []
CHUNK = 8_000
USD_MIN = 5_000.0
ETH_MIN = 1.5
MIN_ACTIVE_SAMPLE_DAYS = 3


def panel_pools(screen: dict) -> list[dict]:
    """Pre-registered panel rule; uses sampled activity only, no outcome."""
    frac = screen["window_blocks"] * 6 / (
        (screen["day_bounds"][max(screen["day_bounds"])] - screen["day_bounds"][min(screen["day_bounds"])])
        / (len(screen["day_bounds"]) - 1))
    chosen = []
    for p in screen["pools"]:
        per_day = p.get("max_sample_day_volume", p["sampled_quote_volume"])
        est = per_day / frac
        floor = USD_MIN if p["quote"] == "USDG" else ETH_MIN
        if p["active_days"] >= MIN_ACTIVE_SAMPLE_DAYS and est >= floor:
            chosen.append(p)
    return chosen


def main():
    screen = json.loads(SCREEN.read_text())
    bounds = screen["day_bounds"]
    if PREFILTER.exists():
        # Amendment A1/A2: complete logs only for prefilter-passing pools, pilot window.
        keep = set(json.loads(PREFILTER.read_text())["passed"]) | set(EXTRA_POOLS)
        reg = {p["pool_id"]: p for p in json.load(gzip.open(REGISTRY, "rt", encoding="utf-8"))["pools"]
               if p["pool_id"] in keep}
        pools = [dict(reg[pid], **{k: v for k, v in row.items() if k not in reg[pid]})
                 for row in screen["pools"] if (pid := row["pool_id"]) in keep]
        first = os.environ.get("HUNTX_FIRST_DAY", min(bounds))
        bounds = {d: b for d, b in bounds.items() if d >= first}
    else:
        pools = panel_pools(screen)
    ids = [p["pool_id"] for p in pools]
    start, stop = bounds[min(bounds)], bounds[max(bounds)] - 1
    chunks = [(a, min(a + CHUNK - 1, stop)) for a in range(start, stop + 1, CHUNK)]
    batches = [ids[i:i + 1000] for i in range(0, len(ids), 1000)]
    jobs = [(a, b, batch) for a, b in chunks for batch in batches]

    def read(job):
        a, b, batch = job
        rows = rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(a), "toBlock": hex(b),
                                    "topics": [SWAP_TOPIC, batch]}], timeout=90)
        return [decode_swap(r) for r in rows]

    swaps = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for part in ex.map(read, jobs):
            swaps.extend(part)
    swaps.sort(key=lambda s: (s["block"], s["log_index"]))
    by_pool: dict[str, list] = {pid: [] for pid in ids}
    for s in swaps:
        by_pool[s["pool_id"]].append([s["block"], s["log_index"], s["amount0"], s["amount1"],
                                      s["sqrt_price_x96"], s["liquidity"], s["tick"], s["fee_ppm"],
                                      s["sender"], s["tx"]])
    payload = {"method": __doc__.strip(), "fields": ["block", "log_index", "amount0", "amount1", "sqrt_price_x96",
                                                     "liquidity", "tick", "fee_ppm", "sender", "tx"],
               "from_block": start, "to_block": stop, "chunks": len(chunks), "jobs": len(jobs),
               "day_bounds": bounds, "pools": {p["pool_id"]: p for p in pools}, "swaps": by_pool}
    with gzip.open(OUT, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(json.dumps({"panel_pools": len(ids), "jobs": len(jobs), "swaps": len(swaps)}))


if __name__ == "__main__":
    main()
