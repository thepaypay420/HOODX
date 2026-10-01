"""V-N (descriptive, local data only): where does tokenized-stock swap flow go, and do new pools win flow?

For each stock, over September: per-pool USDG volume, fee tier, LP fee revenue (volume x fee), and for pools
initialized during the window, how fast they captured share. No RPC.
"""
import gzip, json
from collections import defaultdict
from pathlib import Path
import numpy as np
import huntx_stock_mgmt as M
import huntx_stock_vault as V

ROOT = Path(__file__).parent


def main():
    bounds, clock, proto, pools = M.setup()
    reg = {p["pool_id"]: p for p in json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz"))["pools"]}
    days = sorted(bounds)
    b0, b_mid = bounds[days[0]], bounds["2026-09-15"]
    by_sym = defaultdict(list)
    for pid, p in pools.items():
        vol = np.abs(p.qamt) / 1e6
        tot = float(vol.sum())
        if tot <= 0:
            continue
        fee = p.meta["fee"] / 1e6
        init = reg.get(pid, {}).get("init_block", 0)
        late = float(vol[p.blk >= b_mid].sum())
        by_sym[V.STOCKS[p.token]].append({"pool": pid[:12], "fee_bps": p.meta["fee"] / 100, "volume": tot,
                                          "volume_2nd_half": late, "lp_fees": tot * fee, "swaps": len(vol),
                                          "new_in_sept": init >= b0, "init_block": init})
    out, agg = {}, defaultdict(float)
    for sym, rows in sorted(by_sym.items()):
        V_ = sum(r["volume"] for r in rows)
        F_ = sum(r["lp_fees"] for r in rows)
        rows.sort(key=lambda r: -r["volume"])
        top = rows[0]
        cheapest_active = min((r for r in rows if r["volume"] > 0.01 * V_), key=lambda r: r["fee_bps"])
        new = [r for r in rows if r["new_in_sept"]]
        out[sym] = {"volume_usd": round(V_), "lp_fees_usd": round(F_, 2), "pools_with_flow": len(rows),
                    "top_pool_fee_bps": top["fee_bps"], "top_pool_share": round(top["volume"] / V_, 3),
                    "cheapest_active_fee_bps": cheapest_active["fee_bps"],
                    "cheapest_active_share": round(cheapest_active["volume"] / V_, 3),
                    "fee_share_by_tier": {}, "new_pools": len(new),
                    "new_pools_share_2nd_half": round(sum(r["volume_2nd_half"] for r in new) /
                                                      max(1e-9, sum(r["volume_2nd_half"] for r in rows)), 3)}
        tiers = defaultdict(float)
        for r in rows:
            tiers[r["fee_bps"]] += r["lp_fees"]
            agg[("vol", r["fee_bps"])] += r["volume"]
            agg[("fees", r["fee_bps"])] += r["lp_fees"]
            if r["new_in_sept"]:
                agg["new_vol_2nd"] += r["volume_2nd_half"]
            agg["vol_2nd"] += r["volume_2nd_half"]
        out[sym]["fee_share_by_tier"] = {str(k): round(v / F_, 3) for k, v in sorted(tiers.items(), key=lambda kv: -kv[1])[:4]}
    tot_v = sum(v for k, v in agg.items() if isinstance(k, tuple) and k[0] == "vol")
    tot_f = sum(v for k, v in agg.items() if isinstance(k, tuple) and k[0] == "fees")
    tiers = sorted({k[1] for k in agg if isinstance(k, tuple)})
    summary = {"total_volume_usd": round(tot_v), "total_lp_fees_usd": round(tot_f),
               "by_tier": {str(t): {"volume_share": round(agg[("vol", t)] / tot_v, 3),
                                    "fee_share": round(agg[("fees", t)] / tot_f, 3)} for t in tiers
                           if agg[("vol", t)] / tot_v > 0.005},
               "new_pools_share_of_2nd_half_volume": round(agg["new_vol_2nd"] / agg["vol_2nd"], 3)}
    (ROOT / "huntx_vn_venue_flow.json").write_text(json.dumps({"summary": summary, "symbols": out}, indent=1))
    print(json.dumps(summary, indent=1))
    for sym, r in sorted(out.items(), key=lambda kv: -kv[1]["volume_usd"])[:20]:
        print(f"{sym:6} vol ${r['volume_usd']:>12,} fees ${r['lp_fees_usd']:>9,.0f} pools {r['pools_with_flow']:>2} "
              f"top {r['top_pool_fee_bps']:>5}bp {r['top_pool_share']:.0%} | cheapest-active {r['cheapest_active_fee_bps']}bp "
              f"{r['cheapest_active_share']:.0%} | new pools {r['new_pools']} -> {r['new_pools_share_2nd_half']:.0%} of 2nd-half vol")


if __name__ == "__main__":
    main()
