"""Complete read-only registry of Robinhood Chain Uniswap V4 pools.

Scans every PoolManager Initialize log from deployment (block 9,070) to a fixed
head block in 10,000-block chunks (the RPC limit). Any failed chunk aborts the
run, so the registry is complete or absent -- no survivorship filtering.
"""

from __future__ import annotations

import gzip
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from feex_next_day_check import rpc
from huntx_edge_chain import INIT_TOPIC, MANAGER, block_timestamp, signed

OUT = Path(__file__).with_name("huntx_edge_registry.json.gz")
START = 9_070
CHUNK = 10_000


def read(a: int, b: int):
    return rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(a), "toBlock": hex(b),
                                "topics": [INIT_TOPIC]}], timeout=60)


def main():
    head = int(sys.argv[1]) if len(sys.argv) > 1 else int(rpc("eth_blockNumber", []), 16)
    chunks = [(a, min(a + CHUNK - 1, head)) for a in range(START, head + 1, CHUNK)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda c: read(*c), chunks))
    pools = []
    for logs in results:
        for row in logs:
            data = bytes.fromhex(row["data"][2:])
            pools.append({
                "pool_id": row["topics"][1].lower(),
                "currency0": "0x" + row["topics"][2][-40:].lower(),
                "currency1": "0x" + row["topics"][3][-40:].lower(),
                "fee": int.from_bytes(data[0:32], "big"),
                "tick_spacing": signed(data[32:64], 24),
                "hooks": "0x" + data[64:96].hex()[-40:],
                "init_sqrt": int.from_bytes(data[96:128], "big"),
                "init_block": int(row["blockNumber"], 16),
                "init_tx": row["transactionHash"],
            })
    pools.sort(key=lambda p: p["init_block"])
    payload = {"method": __doc__.strip(), "manager": MANAGER, "from_block": START, "head_block": head,
               "head_timestamp": block_timestamp(head), "chunks": len(chunks), "pools": pools}
    with gzip.open(OUT, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(json.dumps({"head": head, "chunks": len(chunks), "pools": len(pools)}))


if __name__ == "__main__":
    main()
