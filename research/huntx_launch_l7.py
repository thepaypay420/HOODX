"""Loop L7 (Amendment A9): survivor launches, decision at pool age 24 h.

Universe: the 1,289 launches (09-15..25) still trading at hour 3. Fetch their
Swap logs for hours 3.2..48 with time-local OR-lists, then apply the frozen
rule with exact V4Quoter exits. Read-only. Usage: python huntx_launch_l7.py [dry|fetch|eval]
"""

from __future__ import annotations

import bisect
import json
import random
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

import huntx_edge_slice_study as S
import huntx_launch_l3 as L3
from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, SWAP_TOPIC, USDG
from huntx_edge_engine import amounts, load_cache, quote_exact_in, save_cache, slot0, value_in_quote
from huntx_edge_log_stage import parse

ROOT = Path(__file__).parent
OUTD = ROOT / "huntx_launch_l7"
PARTS = OUTD / "parts"
H = 35_700
WIN_LO, WIN_HI = int(3.2 * H) - 8_000, 48 * H + 8_000
DEC_AGE, HOLD = 24 * H, 24 * H
BID = (0.90, 0.99)


def universe():
    L, bounds, _ = L3.plan()
    alive = set(json.loads((ROOT / "huntx_launch_l3" / "alive_at_3h.json").read_text()))
    return sorted((p for p in L if p["pool_id"] in alive), key=lambda p: p["init_block"]), bounds


def plan():
    U, bounds = universe()
    inits = [p["init_block"] for p in U]
    a = bounds["2026-09-15"] + WIN_LO
    b = bounds["2026-09-25"] + WIN_HI
    jobs = []
    for s in range(a, b, 8_000):
        e = s + 7_999
        lo, hi = bisect.bisect_left(inits, s - WIN_HI), bisect.bisect_right(inits, e - WIN_LO)
        ids = [U[i]["pool_id"] for i in range(lo, hi)]
        for k in range(0, len(ids), 1000):
            jobs.append((s, e, k // 1000, ids[k:k + 1000]))
    return U, bounds, jobs


def fetch():
    U, _, jobs = plan()
    PARTS.mkdir(parents=True, exist_ok=True)
    todo = [j for j in jobs if not (PARTS / f"{j[0]}_{j[2]}.npz").exists()]
    print(json.dumps({"pools": len(U), "requests": len(jobs), "remaining": len(todo)}), flush=True)

    def run(j):
        s, e, bi, ids = j
        rows = rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(s), "toBlock": hex(e),
                                    "topics": [SWAP_TOPIC, ids]}], timeout=120)
        index = {pid: i for i, pid in enumerate(ids)}
        np.savez_compressed(PARTS / f"{s}_{bi}.npz", **{ids[pi]: np.array(r, dtype=np.float64)
                                                       for pi, r in parse(rows, index).items()})
        return len(rows)
    with ThreadPoolExecutor(max_workers=5) as ex:
        n = sum(ex.map(run, todo))
    print("swaps", n, flush=True)


def load(U):
    per = {}
    for d in (PARTS, L3.PARTS):
        for f in d.glob("*.npz"):
            with np.load(f) as z:
                for pid in z.files:
                    if pid in {p["pool_id"] for p in U[:0]} or True:
                        per.setdefault(pid, []).append(z[pid])
    meta = {p["pool_id"]: p for p in U}
    pools = {}
    for pid, parts in per.items():
        if pid not in meta:
            continue
        a = np.concatenate(parts)
        _, first = np.unique(a[:, 0] * 1e6 + a[:, 1], return_index=True)
        a = a[np.sort(first)]
        a = a[np.lexsort((a[:, 1], a[:, 0]))]
        pools[pid] = S.Pool(pid, meta[pid], a)
    return pools


def decide(pool, eth_fn):
    t = pool.meta["init_block"] + DEC_AGE
    i, j = pool.idx(t - 12 * H), pool.idx(t)
    if j - i < 40:
        return None, "swaps12h < 40"
    q = pool.qamt[i:j]
    vol = L3.to_usd(pool, float(np.abs(q).sum()), eth_fn(t))
    if vol < 2_000:
        return None, "vol12h < $2k"
    if np.abs(q).max() / np.abs(q).sum() > 0.25:
        return None, "one swap > 25%"
    buy = float(-q[q < 0].sum())
    tot = float(np.abs(q).sum())
    if abs(2 * buy - tot) / tot > 0.20:
        return None, "imbalance > 0.20"
    s24, s6 = pool.sqrt_before(t), pool.sqrt_before(pool.meta["init_block"] + 6 * H)
    if s6 is None or L3.price_q(pool, s24) < L3.price_q(pool, s6):
        return None, "drift since 6h < 0"
    if abs(pool.tick[j - 1]) >= L3.SANE:
        return None, "degenerate price"
    return {"t": t, "vol12": vol}, None


def unit(pool, d, usd_size, eth_fn):
    t, tx = d["t"], d["t"] + HOLD
    s = pool.sqrt_before(t)
    eth_x = eth_fn(tx)
    V = L3.raw_of(pool, usd_size, eth_fn(t))
    s0 = slot0(pool.pid, t - 1)
    sa, sb, _, _ = S.bid_range(pool, s, *BID)
    u0, u1 = amounts(1.0, s, sa, sb)
    Lq = V / value_in_quote(u0, u1, s, pool.q1)
    f0, f1, _, _ = pool.fees(t, tx, sa, sb, Lq, s0["proto0"], s0["proto1"], s)
    se = pool.sqrt_before(tx) or s
    x, y = amounts(Lq, se, sa, sb)
    tok, q = (x, y) if pool.q1 else (y, x)
    tf, qf = (f0, f1) if pool.q1 else (f1, f0)
    tok_total = int(min(tok + tf / L3.HAIRCUT, 2**128 - 1))
    out = quote_exact_in(pool.meta, pool.q1, tok_total, tx - 1) if tok_total >= 1 else 0
    net = L3.to_usd(pool, q + qf / L3.HAIRCUT + (out or 0), eth_x) - usd_size - 3 * L3.GAS_TX_USD
    return {"status": "ok", "net_usd": net, "filled": tok > 0, "failed_exit": out is None,
            "token_ret": L3.price_q(pool, se) / L3.price_q(pool, s) - 1,
            "exit_tick": int(pool.tick[pool.idx(tx) - 1])}


def evaluate():
    load_cache()
    U, bounds, _ = plan()
    pools = load(U)
    eth_fn = L3.eth_price_fn()
    days = sorted(d for d in bounds if "2026-09-15" <= d <= "2026-09-25")
    census, cands = {}, []
    for pid, pool in pools.items():
        d, why = decide(pool, eth_fn)
        census[why or "ELIGIBLE"] = census.get(why or "ELIGIBLE", 0) + 1
        if d:
            d["day"] = max(x for x in days if bounds[x] <= pool.meta["init_block"])
            cands.append((pid, d))
    print("universe", len(U), "loaded", len(pools), "census", census, flush=True)
    rows = []
    for (pid, d), r in zip(cands, S.pmap(lambda c: unit(pools[c[0]], c[1], 100.0, eth_fn), cands, workers=6)):
        rows.append({"pool_id": pid, "token": pools[pid].token, "day": d["day"], **r})
    save_cache()
    ok = [r for r in rows if r["status"] == "ok"]
    rep = {"n": len(ok)}
    if ok:
        byd = {}
        for r in ok:
            byd.setdefault(r["day"], []).append(r["net_usd"])
        rng = random.Random(9)
        ks = sorted(byd)
        m = sorted(statistics.mean([v for k in [rng.choice(ks) for _ in ks] for v in byd[k]]) for _ in range(4000))
        tok = {}
        for r in ok:
            tok.setdefault(r["token"], []).append(r["net_usd"])
        rep.update(mean_net=round(statistics.mean(r["net_usd"] for r in ok), 3),
                   median_net=round(statistics.median(r["net_usd"] for r in ok), 3),
                   win_rate=round(sum(r["net_usd"] > 0 for r in ok) / len(ok), 3),
                   fill_rate=round(sum(r["filled"] for r in ok) / len(ok), 3),
                   filled_mean=round(statistics.mean([r["net_usd"] for r in ok if r["filled"]] or [0]), 3),
                   boot_90=[round(m[200], 3), round(m[3800], 3)],
                   tokens=len(tok), profitable_tokens=sum(statistics.mean(v) > 0 for v in tok.values()),
                   half1=round(statistics.mean([r["net_usd"] for r in ok if r["day"] < "2026-09-20"] or [0]), 3),
                   half2=round(statistics.mean([r["net_usd"] for r in ok if r["day"] >= "2026-09-20"] or [0]), 3),
                   median_token_ret=round(statistics.median(r["token_ret"] for r in ok), 4),
                   day_means={k: round(statistics.mean(v), 3) for k, v in sorted(byd.items())})
        # $200 K=3 portfolio, chronological, 24 h holds
        order = sorted(cands, key=lambda c: c[1]["t"])
        open_until, nav, taken = [], 0.0, []
        for pid, d in order:
            open_until = [x for x in open_until if x > d["t"]]
            if len(open_until) >= 3:
                continue
            r = unit(pools[pid], d, 200 / 3, eth_fn)
            nav += r["net_usd"]
            taken.append(r["net_usd"])
            open_until.append(d["t"] + HOLD)
        save_cache()
        rep["portfolio_K3"] = {"net_usd": round(nav, 3), "positions": len(taken),
                               "profitable": sum(x > 0 for x in taken)}
    OUTD.mkdir(exist_ok=True)
    (OUTD / "results.json").write_text(json.dumps({"method": __doc__.strip(), "census": census, "report": rep,
                                                   "units": rows}, indent=1, default=str))
    print(json.dumps(rep, indent=1, default=str))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "dry"
    if mode == "dry":
        U, _, jobs = plan()
        print(json.dumps({"pools": len(U), "requests": len(jobs)}))
    elif mode == "fetch":
        fetch()
    else:
        evaluate()
