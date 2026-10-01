"""V-N2 (pre-registered, 0 RPC): do September-born stock pools win flow AND earn a positive realized spread?

Per swap: LP fee + 24 h markout (mid move against the LP in the taker's direction), as in huntx_stock_sessions.
"""
import gzip, json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import huntx_stock_sessions as SS

ROOT = Path(__file__).parent
HORIZON = 24 * SS.HOUR
WEEK = 7 * 24 * SS.HOUR


def per_swap(m, a):
    q1 = m["currency1"] == SS.USDG
    qamt = a[:, 3] if q1 else a[:, 2]
    tp = a[:, 4] ** 2 if q1 else 1 / a[:, 4] ** 2
    tick = a[:, 6]
    notional = np.abs(qamt) / 1e6
    pre = np.concatenate(([tp[0]], tp[:-1]))
    pavg = np.sqrt(pre * tp)
    j = np.clip(np.searchsorted(a[:, 0], a[:, 0] + HORIZON, side="left") - 1, 0, len(a) - 1)
    move = np.clip(tp[j] / pavg - 1, -0.5, 0.5)
    ok = (np.abs(tick) < 700_000) & (np.abs(tick[j]) < 700_000) & (a[:, 0] + HORIZON <= a[-1, 0])
    dirn = np.where(qamt < 0, 1.0, -1.0)
    mark = -dirn * notional * move
    fee = notional * a[:, 7] / 1e6
    return a[:, 0], notional, fee, mark, ok


def boot_lb(day_fee_mark, day_vol, draws=2000, seed=7):
    rng = np.random.default_rng(seed)
    days = list(day_vol)
    fm = np.array([day_fee_mark[d] for d in days])
    v = np.array([day_vol[d] for d in days])
    stats = []
    for _ in range(draws):
        k = rng.integers(0, len(days), len(days))
        stats.append(fm[k].sum() / v[k].sum())
    return float(np.percentile(stats, 5)), float(np.percentile(stats, 95))


def main():
    bounds = json.load(open(ROOT / "huntx_edge_activity_screen.json"))["day_bounds"]
    days = sorted(d for d in bounds if "2026-09-01" <= d <= "2026-09-30")
    bb = np.array([bounds[d] for d in days])
    sept0 = bounds["2026-09-01"]
    reg = {p["pool_id"]: p for p in json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz"))["pools"]}
    pools = {pid: v for pid, v in SS.load_stock_pools(min_swaps=1).items()
             if SS.USDG in (v[0]["currency0"], v[0]["currency1"])}
    data = {pid: (sym, *per_swap(m, a)) for pid, (m, sym, a) in pools.items()}
    new = [pid for pid in data if reg.get(pid, {}).get("init_block", 0) >= sept0]
    rows = []
    agg = {"new": defaultdict(lambda: [0.0, 0.0]), "inc": defaultdict(lambda: [0.0, 0.0])}
    for pid in new:
        sym, blk, vol, fee, mark, ok = data[pid]
        t0 = reg[pid]["init_block"]
        t1 = t0 + WEEK
        w = (blk >= t0) & (blk < t1)
        if w.sum() < 50:
            continue
        sym_vol = sum(float(d[2][(d[1] >= t0) & (d[1] < t1)].sum()) for p2, d in data.items() if d[0] == sym)
        capture = float(vol[w].sum()) / sym_vol if sym_vol else 0.0
        okw = w & ok
        sp = float((fee[okw] + mark[okw]).sum() / vol[okw].sum() * 1e4) if okw.any() else None
        rows.append({"pool": pid[:12], "symbol": sym, "fee_bps": pools[pid][0]["fee"] / 100, "swaps_wk1": int(w.sum()),
                     "volume_wk1": round(float(vol[w].sum())), "capture": round(capture, 3), "spread_bp": sp and round(sp, 1)})
        di = np.searchsorted(bb, blk[okw], side="right") - 1
        for k, v_, f_ in zip(di, vol[okw], (fee + mark)[okw]):
            agg["new"][k][0] += f_
            agg["new"][k][1] += v_
        # incumbents: same symbol, other pools, same week
        for p2, d in data.items():
            if d[0] != sym or p2 == pid or p2 in new:
                continue
            _, b2, v2, f2, m2, ok2 = d
            w2 = (b2 >= t0) & (b2 < t1) & ok2
            di2 = np.searchsorted(bb, b2[w2], side="right") - 1
            for k, v_, f_ in zip(di2, v2[w2], (f2 + m2)[w2]):
                agg["inc"][k][0] += f_
                agg["inc"][k][1] += v_
    res = {}
    for g in ("new", "inc"):
        fm = {d: x[0] for d, x in agg[g].items()}
        vv = {d: x[1] for d, x in agg[g].items()}
        tot = sum(vv.values())
        res[g] = {"volume": round(tot), "spread_bp": round(sum(fm.values()) / tot * 1e4, 2) if tot else None,
                  "ci90_bp": [round(x * 1e4, 2) for x in boot_lb(fm, vv)] if tot else None}
    share_ok = sum(r["capture"] >= 0.20 for r in rows)
    verdict = {"n_new_pools": len(rows), "captured_20pct": int(share_ok),
               "i": share_ok * 3 >= len(rows) and len(rows) > 0,
               "ii": res["new"]["ci90_bp"] is not None and res["new"]["ci90_bp"][0] > 0,
               "iii": res["new"]["spread_bp"] is not None and res["inc"]["spread_bp"] is not None
               and res["new"]["spread_bp"] >= res["inc"]["spread_bp"] - 5}
    verdict = {k: (bool(v) if isinstance(v, (bool, np.bool_)) else v) for k, v in verdict.items()}
    verdict["PASS"] = verdict["i"] and verdict["ii"] and verdict["iii"]
    (ROOT / "huntx_vn2_new_pools.json").write_text(json.dumps({"pools": rows, "groups": res, "verdict": verdict}, indent=1))
    for r in sorted(rows, key=lambda r: -r["volume_wk1"]):
        print(r)
    print("GROUPS", json.dumps(res))
    print("VERDICT", json.dumps(verdict))


if __name__ == "__main__":
    main()
