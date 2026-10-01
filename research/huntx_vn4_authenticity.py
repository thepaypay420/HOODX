"""V-N4 (pre-registered): are the >60 bp new pools' flows organic? Sender concentration + creator self-trading."""
import gzip, json, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
import requests
import feex_next_day_check as fx
import huntx_stock_sessions as SS
import huntx_vn2_new_pools as N2
from huntx_edge_chain import MANAGER, SWAP_TOPIC

ROOT = Path(__file__).parent
SAMPLE = 75
RPC_CAP = 1_000
_n = {"c": 0}


def call(method, params):
    _n["c"] += 1
    if _n["c"] > RPC_CAP:
        sys.exit("V-N4 RPC cap reached")
    return fx.rpc(method, params)


def main():
    v3 = json.loads((ROOT / "huntx_vn3_capture_depth.json").read_text())
    targets = [r for r in v3["rows"] if r["bucket"] == ">60"]
    reg = {p["pool_id"]: p for p in json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz"))["pools"]}
    pools = SS.load_stock_pools(min_swaps=1)
    full = {pid[:12]: pid for pid in pools}
    out = []
    for r in targets:
        pid = full[r["pool"]]
        m, sym, a = pools[pid]
        t0 = reg[pid]["init_block"]
        w = np.nonzero((a[:, 0] >= t0) & (a[:, 0] < t0 + N2.WEEK))[0]
        pick = w[np.linspace(0, len(w) - 1, min(SAMPLE, len(w))).astype(int)]
        creator = call("eth_getTransactionByHash", [reg[pid]["init_tx"]])["from"].lower()
        q1 = m["currency1"] == SS.USDG
        vol_by_from, routers = defaultdict(float), defaultdict(float)
        for k in pick:
            blk = hex(int(a[k, 0]))
            logs = call("eth_getLogs", [{"fromBlock": blk, "toBlock": blk, "address": MANAGER,
                                         "topics": [SWAP_TOPIC, pid]}])
            li = int(a[k, 1])
            lg = next((x for x in logs if int(x["logIndex"], 16) == li), logs[0] if logs else None)
            if lg is None:
                continue
            tx = call("eth_getTransactionByHash", [lg["transactionHash"]])
            notional = abs(a[k, 3] if q1 else a[k, 2]) / 1e6
            vol_by_from[tx["from"].lower()] += notional
            routers["0x" + lg["topics"][2][-40:]] += notional
        tot = sum(vol_by_from.values())
        top = sorted(vol_by_from.items(), key=lambda kv: -kv[1])
        top3 = sum(v for _, v in top[:3]) / tot if tot else 1.0
        creator_top3 = creator in [f for f, _ in top[:3]]
        organic = not (top3 > 0.80 or creator_top3)
        out.append({**{k: r[k] for k in ("symbol", "fee_bps", "pool", "capture", "depth_share", "R", "spread_bp", "volume_wk1")},
                    "sampled": len(pick), "unique_senders": len(vol_by_from), "top3_share": round(top3, 3),
                    "creator_in_top3": creator_top3, "creator_share": round(vol_by_from.get(creator, 0) / tot, 3) if tot else None,
                    "top_router_share": round(max(routers.values()) / tot, 3) if tot else None, "organic": organic})
        print(json.dumps(out[-1]), "rpc", _n["c"], flush=True)
    org = [x for x in out if x["organic"]]
    vol = sum(x["volume_wk1"] for x in org)
    verdict = {"n": len(out), "organic": len(org),
               "organic_median_R": round(float(np.median([x["R"] for x in org])), 2) if org else None,
               "organic_pooled_spread_bp": round(sum(x["spread_bp"] * x["volume_wk1"] for x in org) / vol, 1) if vol else None}
    verdict["ACTIONABLE"] = bool(len(org) >= 4 and verdict["organic_median_R"] >= 1.5 and verdict["organic_pooled_spread_bp"] > 0) if org else False
    (ROOT / "huntx_vn4_authenticity.json").write_text(json.dumps({"pools": out, "verdict": verdict, "rpc": _n["c"]}, indent=1))
    print("VERDICT", json.dumps(verdict), "rpc", _n["c"])


if __name__ == "__main__":
    main()
