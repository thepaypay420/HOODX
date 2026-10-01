"""V-N3 (pre-registered, 0 RPC): does a new pool capture more flow than its share of symbol depth?"""
import gzip, json
from pathlib import Path
import numpy as np
import huntx_stock_sessions as SS
import huntx_vn2_new_pools as N2

ROOT = Path(__file__).parent
K1 = np.sqrt(1.01) - 1  # sqrt-price step for a +1% price move


def depth_series(m, a):
    """Quote (USD) needed to move the price 1%, per swap, from logged active L and sqrtP (raw units)."""
    L, sq = a[:, 5], a[:, 4]
    q1 = m["currency1"] == SS.USDG
    raw = L * sq * K1 if q1 else L * (1 - 1 / np.sqrt(1.01)) / sq
    return raw / 1e6


def bucket(fee_bps):
    return "<=5" if fee_bps <= 5 else "5-25" if fee_bps <= 25 else "25-60" if fee_bps <= 60 else ">60"


def spearman(x, y):
    rx, ry = np.argsort(np.argsort(x)), np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def main():
    vn2 = json.loads((ROOT / "huntx_vn2_new_pools.json").read_text())
    reg = {p["pool_id"]: p for p in json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz"))["pools"]}
    pools = {pid: v for pid, v in SS.load_stock_pools(min_swaps=1).items()
             if SS.USDG in (v[0]["currency0"], v[0]["currency1"])}
    full = {pid[:12]: pid for pid in pools}
    sept0 = json.load(open(ROOT / "huntx_edge_activity_screen.json"))["day_bounds"]["2026-09-01"]
    new_ids = {pid for pid in pools if reg.get(pid, {}).get("init_block", 0) >= sept0}
    rows = []
    for r in vn2["pools"]:
        pid = full[r["pool"]]
        m, sym, a = pools[pid]
        t0 = reg[pid]["init_block"]
        t1 = t0 + N2.WEEK
        w = (a[:, 0] >= t0) & (a[:, 0] < t1)
        d_new = float(np.median(depth_series(m, a)[w]))
        d_other = 0.0
        for p2, (m2, s2, a2) in pools.items():
            if s2 != sym or p2 == pid:
                continue
            w2 = (a2[:, 0] >= t0) & (a2[:, 0] < t1)
            if w2.any():
                d_other += float(np.median(depth_series(m2, a2)[w2]))
        share = d_new / (d_new + d_other) if d_new + d_other > 0 else 0.0
        R = r["capture"] / share if share > 0 else None
        rows.append({**r, "depth_1pct_usd": round(d_new), "depth_share": round(share, 3), "R": R and round(R, 2),
                     "bucket": bucket(r["fee_bps"])})
    out = {"rows": rows, "buckets": {}}
    ok = [r for r in rows if r["R"] is not None]
    out["spearman_capture_depthshare"] = round(spearman([r["capture"] for r in ok], [r["depth_share"] for r in ok]), 3)
    advantage = False
    for b in ("<=5", "5-25", "25-60", ">60"):
        g = [r for r in ok if r["bucket"] == b]
        if not g:
            continue
        vol = sum(r["volume_wk1"] for r in g)
        sp = sum((r["spread_bp"] or 0) * r["volume_wk1"] for r in g) / vol if vol else None
        med = float(np.median([r["R"] for r in g]))
        out["buckets"][b] = {"n": len(g), "median_R": round(med, 2), "pooled_spread_bp": sp and round(sp, 1)}
        if len(g) >= 5 and med >= 1.5 and sp and sp > 0:
            advantage = True
    out["structural_advantage"] = advantage
    (ROOT / "huntx_vn3_capture_depth.json").write_text(json.dumps(out, indent=1))
    for r in sorted(ok, key=lambda r: -r["volume_wk1"])[:20]:
        print(f"{r['symbol']:5} fee {r['fee_bps']:>6}bp capture {r['capture']:.2f} depth_share {r['depth_share']:.2f} R {r['R']}")
    print("SPEARMAN", out["spearman_capture_depthshare"])
    print("BUCKETS", json.dumps(out["buckets"]))
    print("STRUCTURAL_ADVANTAGE", advantage)


if __name__ == "__main__":
    main()
