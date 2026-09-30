"""Measure Krystal vault execution costs (read-only, sampled receipts).

A random sample (seed 7) of 2,000 of the 20,427 September transactions in
which Krystal vault NFTs changed liquidity. For every V4 Swap log in each
receipt, cost = value paid in minus value received, both at the pool's mid
price just BEFORE that swap (previous swap in the same pool from the panel
logs). This captures fee plus price impact. Swaps in pools outside the panel
are costed at fee only (a lower bound) and counted separately. Gas uses the
receipt (gasUsed x effectiveGasPrice).
"""

from __future__ import annotations

import gzip
import json
import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, SWAP_TOPIC, USDG, WETH

ROOT = Path(__file__).parent
POP = ROOT / "huntx_lp_population"
LOGDIRS = ["huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap"]
NATIVE = "0x" + "0" * 40


def s128(h):
    v = int(h[-32:], 16)
    return v - (1 << 128) if v >= 1 << 127 else v


def main():
    txs = json.load(open(POP / "krystal_txs.json"))
    sample = random.Random(7).sample(txs, 2000)
    metas, arrays = {}, {}
    for d in LOGDIRS:
        metas.update(json.load(open(ROOT / d / "meta.json"))["pools"])
    # ETH/USD reference from the ETH/USDG pool
    ref = next(p for p in metas if p.startswith("0x24107d152f"))

    def load(pid):
        if pid not in arrays:
            parts = [np.load(ROOT / d / f"{pid}.npy") for d in LOGDIRS if (ROOT / d / f"{pid}.npy").exists()]
            if not parts:
                arrays[pid] = None
            else:
                a = np.concatenate(parts)
                a = a[np.lexsort((a[:, 1], a[:, 0]))]
                arrays[pid] = (a[:, 0] * 100_000 + a[:, 1], a[:, 4])
        return arrays[pid]

    def pre_sqrt(pid, key):
        arr = load(pid)
        if arr is None:
            return None
        i = int(np.searchsorted(arr[0], key, side="left"))
        return None if i == 0 else float(arr[1][i - 1])

    receipts = {}

    def fetch(h):
        return h, rpc("eth_getTransactionReceipt", [h])
    with ThreadPoolExecutor(max_workers=4) as ex:
        for h, rc in ex.map(fetch, sample):
            receipts[h] = rc
    rows = []
    for h, rc in receipts.items():
        blk = int(rc["blockNumber"], 16)
        eth_s = pre_sqrt(ref, blk * 100_000)
        eth_usd = (1 / (eth_s * eth_s) if metas[ref]["currency1"] != USDG else eth_s * eth_s) * 1e12 \
            if eth_s else 2600.0
        gas_usd = int(rc["gasUsed"], 16) * int(rc["effectiveGasPrice"], 16) / 1e18 * eth_usd
        swap_cost, fee_only_cost, swaps, unpriced = 0.0, 0.0, 0, 0
        for lg in rc["logs"]:
            if lg["address"].lower() != MANAGER or lg["topics"][0] != SWAP_TOPIC:
                continue
            pid = lg["topics"][1].lower()
            d = lg["data"][2:]
            a0, a1 = s128(d[0:64]), s128(d[64:128])
            fee = int(d[320:384], 16)
            swaps += 1
            m = metas.get(pid)
            key = blk * 100_000 + int(lg["logIndex"], 16)
            sq = pre_sqrt(pid, key) if m else None
            if not m or sq is None:
                unpriced += 1
                continue
            q1 = m["currency1"] in (USDG, WETH, NATIVE) and m["currency0"] not in (USDG,)
            quote = USDG if USDG in (m["currency0"], m["currency1"]) else WETH if WETH in (
                m["currency0"], m["currency1"]) else NATIVE
            q1 = m["currency1"] == quote
            price = sq * sq                                   # token1 per token0 (raw)
            # value of the caller's net delta in token1 units at pre-swap mid (negative = cost)
            net_t1 = a1 + a0 * price
            net_q = net_t1 if q1 else net_t1 / price
            to_usd = (1 / 1e6) if quote == USDG else (eth_usd / 1e18)
            swap_cost += -net_q * to_usd
            gross_in = (-a0 * price if a0 < 0 else -a1) if q1 else ((-a0) if a0 < 0 else -a1 / price)
            fee_only_cost += gross_in * fee / 1e6 * to_usd
        rows.append({"tx": h, "gas_usd": gas_usd, "swap_cost_usd": swap_cost, "fee_part_usd": fee_only_cost,
                     "swaps": swaps, "unpriced_swaps": unpriced})
    out = {"method": __doc__.strip(), "population_txs": len(txs), "sampled": len(rows), "rows": rows}
    tot = lambda k: sum(r[k] for r in rows)
    out["summary"] = {"mean_gas_usd_per_tx": tot("gas_usd") / len(rows),
                      "mean_swap_cost_usd_per_tx": tot("swap_cost_usd") / len(rows),
                      "mean_fee_part_usd_per_tx": tot("fee_part_usd") / len(rows),
                      "swaps_per_tx": tot("swaps") / len(rows),
                      "unpriced_swap_share": tot("unpriced_swaps") / max(1, tot("swaps")),
                      "scaled_total_swap_cost_usd": tot("swap_cost_usd") / len(rows) * len(txs),
                      "scaled_total_gas_usd": tot("gas_usd") / len(rows) * len(txs)}
    json.dump(out, open(POP / "krystal_costs.json", "w"), indent=1)
    print(json.dumps(out["summary"], indent=1))


if __name__ == "__main__":
    main()
