"""LP population data (read-only): every V4 ModifyLiquidity event on the lean
pools plus every PositionManager NFT Transfer, 2026-09-01..09-29 UTC.

Purpose: reconstruct ALL LP positions (winners and losers) to find what
profitable LPs did at entry -- not to copy survivors. ~9.4k requests,
checkpointed per chunk; any failed chunk aborts.
"""

from __future__ import annotations

import gzip
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from web3 import Web3

from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, MODIFY_TOPIC, POSM

ROOT = Path(__file__).parent
OUT = ROOT / "huntx_lp_population"
PARTS = OUT / "parts"
TRANSFER = "0x" + Web3.keccak(text="Transfer(address,address,uint256)").hex().removeprefix("0x")
CHUNK = 8_000
FIRST, LAST_BOUND = os.environ.get("HUNTX_FIRST_DAY", "2026-09-01"), os.environ.get("HUNTX_END_BOUND", "2026-09-30")


def s(h, bits=256):
    v = int(h, 16)
    return v - (1 << bits) if v >= 1 << (bits - 1) else v


def main():
    lean = sorted(json.load(gzip.open(ROOT / "huntx_edge_state_panel.json.gz", "rt"))["pools"])
    bounds = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    start, stop = bounds[FIRST], bounds[LAST_BOUND] - 1
    chunks = [(a, min(a + CHUNK - 1, stop)) for a in range(start, stop + 1, CHUNK)]
    batches = [lean[i:i + 1000] for i in range(0, len(lean), 1000)]
    PARTS.mkdir(parents=True, exist_ok=True)
    jobs = [("m", a, b, bi) for a, b in chunks for bi in range(len(batches))] + [("t", a, b, 0) for a, b in chunks]
    jobs = [j for j in jobs if not (PARTS / f"{j[0]}_{j[1]}_{j[3]}.json.gz").exists()]
    print(json.dumps({"chunks": len(chunks), "remaining_requests": len(jobs)}), flush=True)

    def run(job):
        kind, a, b, bi = job
        if kind == "m":
            rows = rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(a), "toBlock": hex(b),
                                        "topics": [MODIFY_TOPIC, batches[bi]]}], timeout=90)
            recs = []
            for r in rows:
                d = r["data"][2:]
                recs.append([int(r["blockNumber"], 16), int(r["logIndex"], 16), r["topics"][1].lower(),
                             "0x" + r["topics"][2][-40:].lower(), s(d[0:64]), s(d[64:128]),
                             str(s(d[128:192])), "0x" + d[192:256], r["transactionHash"]])
        else:
            rows = rpc("eth_getLogs", [{"address": POSM, "fromBlock": hex(a), "toBlock": hex(b),
                                        "topics": [TRANSFER]}], timeout=90)
            recs = [[int(r["blockNumber"], 16), int(r["logIndex"], 16), "0x" + r["topics"][1][-40:].lower(),
                     "0x" + r["topics"][2][-40:].lower(), int(r["topics"][3], 16), r["transactionHash"]]
                    for r in rows]
        with gzip.open(PARTS / f"{kind}_{a}_{bi}.json.gz", "wt") as fh:
            json.dump(recs, fh)
        return len(recs)

    done = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for n in ex.map(run, jobs):
            done += 1
            if done % 250 == 0:
                print(f"{done}/{len(jobs)}", flush=True)
    mods, xfers = [], []
    for a, _ in chunks:
        for bi in range(len(batches)):
            mods += json.load(gzip.open(PARTS / f"m_{a}_{bi}.json.gz", "rt"))
        xfers += json.load(gzip.open(PARTS / f"t_{a}_0.json.gz", "rt"))
    mods.sort(key=lambda r: (r[0], r[1]))
    xfers.sort(key=lambda r: (r[0], r[1]))
    with gzip.open(OUT / "modify.json.gz", "wt") as fh:
        json.dump({"fields": ["block", "log_index", "pool_id", "sender", "tick_lower", "tick_upper",
                              "liquidity_delta", "salt", "tx"], "rows": mods}, fh)
    with gzip.open(OUT / "posm_transfers.json.gz", "wt") as fh:
        json.dump({"fields": ["block", "log_index", "from", "to", "token_id", "tx"], "rows": xfers}, fh)
    print(json.dumps({"modify_events": len(mods), "nft_transfers": len(xfers)}), flush=True)


if __name__ == "__main__":
    main()
