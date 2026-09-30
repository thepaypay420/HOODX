"""Complete-log stage (Amendments A1/A2): every Swap log for prefilter-passing
pools over the pilot window, streamed into compact per-pool numpy arrays.

~1,100 requests (pool IDs as one server-side OR-list per 8,000-block chunk).
Every chunk must succeed; completed chunks are checkpointed so an interrupted
run never re-downloads them. Output: research/huntx_edge_logs/<pool>.npz plus
meta.json (pool metadata, chunk coverage, day bounds).
"""

from __future__ import annotations

import gzip
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, SWAP_TOPIC

ROOT = Path(__file__).parent
SCREEN = ROOT / "huntx_edge_activity_screen.json"
PREFILTER = ROOT / "huntx_edge_prefilter.json"
REGISTRY = ROOT / "huntx_edge_registry.json.gz"
OUTDIR = ROOT / os.environ.get("HUNTX_LOG_DIR", "huntx_edge_logs")
STATE = ROOT / "huntx_edge_state_panel.json.gz"
POOLSET = os.environ.get("HUNTX_POOLSET", "prefilter")   # prefilter | lean | lean_minus_prefilter
LAST_DAY = os.environ.get("HUNTX_LAST_DAY", "")
PARTS = OUTDIR / "parts"
CHUNK = 8_000
FIRST_DAY = os.environ.get("HUNTX_FIRST_DAY", "2026-09-20")
FIELDS = ("block", "log_index", "amount0", "amount1", "sqrt", "liquidity", "tick", "fee")


def s128(h: str) -> int:
    v = int(h, 16)
    return v - (1 << 128) if v >= 1 << 127 else v


def parse(rows, index):
    """Rows -> dict pool -> list of 8-tuples of floats (amounts can exceed int64)."""
    out: dict[int, list] = {}
    for r in rows:
        d = r["data"][2:]
        tick = int(d[256:320], 16)
        tick = tick - (1 << 256) if tick >= 1 << 255 else tick
        out.setdefault(index[r["topics"][1].lower()], []).append((
            int(r["blockNumber"], 16), int(r["logIndex"], 16),
            float(s128(d[0:64][-32:])), float(s128(d[64:128][-32:])),
            int(d[128:192], 16) / 2**96, float(int(d[192:256], 16)),
            tick, int(d[320:384], 16)))
    return out


def main():
    screen = json.loads(SCREEN.read_text())
    # bounds include the boundary AFTER LAST_DAY so that day is complete
    all_days = sorted(screen["day_bounds"])
    end = all_days[all_days.index(LAST_DAY) + 1] if LAST_DAY else all_days[-1]
    bounds = {d: b for d, b in screen["day_bounds"].items() if FIRST_DAY <= d <= end}
    passed = json.loads(PREFILTER.read_text())["passed"]
    if POOLSET == "prefilter":
        keep = passed
    else:
        lean = list(json.load(gzip.open(STATE, "rt", encoding="utf-8"))["pools"])
        keep = lean if POOLSET == "lean" else sorted(set(lean) - set(passed))
    reg = {p["pool_id"]: p for p in json.load(gzip.open(REGISTRY, "rt", encoding="utf-8"))["pools"]
           if p["pool_id"] in set(keep)}
    ids = sorted(keep)
    index = {pid: i for i, pid in enumerate(ids)}
    start, stop = bounds[min(bounds)], bounds[max(bounds)] - 1
    chunks = [(a, min(a + CHUNK - 1, stop)) for a in range(start, stop + 1, CHUNK)]
    batches = [ids[i:i + 1000] for i in range(0, len(ids), 1000)]
    PARTS.mkdir(parents=True, exist_ok=True)
    jobs = [(a, b, bi) for a, b in chunks for bi in range(len(batches))
            if not (PARTS / f"{a}_{bi}.npz").exists()]
    print(json.dumps({"pools": len(ids), "chunks": len(chunks), "batches": len(batches),
                      "remaining_requests": len(jobs)}), flush=True)
    lock = threading.Lock()
    done = [0]

    def run(job):
        a, b, bi = job
        rows = rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(a), "toBlock": hex(b),
                                    "topics": [SWAP_TOPIC, batches[bi]]}], timeout=120)
        parsed = parse(rows, index)
        arrays = {}
        for pi, recs in parsed.items():
            arr = np.array(recs, dtype=np.float64)
            arrays[f"p{pi}"] = arr
        np.savez_compressed(PARTS / f"{a}_{bi}.npz", **arrays)
        with lock:
            done[0] += 1
            if done[0] % 50 == 0:
                print(f"{done[0]}/{len(jobs)}", flush=True)
        return len(rows)

    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = [ex.submit(run, j) for j in jobs]
        total = sum(f.result() for f in as_completed(futs))  # any failure raises -> abort
    # Assemble per-pool arrays in (block, log_index) order.
    per_pool: dict[int, list] = {}
    for a, b in chunks:
        for bi in range(len(batches)):
            with np.load(PARTS / f"{a}_{bi}.npz") as z:
                for k in z.files:
                    per_pool.setdefault(int(k[1:]), []).append(z[k])
    counts = {}
    for pi, parts in per_pool.items():
        arr = np.concatenate(parts)
        arr = arr[np.lexsort((arr[:, 1], arr[:, 0]))]
        np.save(OUTDIR / f"{ids[pi]}.npy", arr)
        counts[ids[pi]] = int(len(arr))
    meta = {"method": __doc__.strip(), "fields": FIELDS, "first_day": FIRST_DAY, "day_bounds": bounds,
            "from_block": start, "to_block": stop, "chunks": len(chunks), "requests": len(chunks) * len(batches),
            "pools": {pid: {**reg[pid], "swaps": counts.get(pid, 0)} for pid in ids}}
    (OUTDIR / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps({"swaps_this_run": total, "pools_with_swaps": len(counts),
                      "total_swaps": sum(counts.values())}), flush=True)


if __name__ == "__main__":
    main()
