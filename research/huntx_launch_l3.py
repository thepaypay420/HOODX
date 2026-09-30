"""Loop L3 (Amendment A8): causal launch-bid rule on the UNBIASED launch universe.

Universe: every unhooked USDG/WETH/ETH-quoted pool (fee > 0) initialized
2026-09-15..09-25 UTC, straight from the registry, with no volume screen.
Stage A fetches each pool's first 3.2 h of Swap logs using time-local OR-lists:
each 8,000-block chunk asks only for pools initialized in the preceding 3.2 h.
Stage B applies the frozen rule with exact V4Quoter exits. Read-only.
Usage: python huntx_launch_l3.py [fetch|dry|eval]
"""

from __future__ import annotations

import bisect
import gzip
import json
import math
import random
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

import huntx_edge_slice_study as S
from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, SWAP_TOPIC, USDG, WETH
from huntx_edge_engine import amounts, load_cache, quote_exact_in, save_cache, slot0, snap_range, value_in_quote
from huntx_edge_log_stage import parse

ROOT = Path(__file__).parent
OUTD = ROOT / "huntx_launch_l3"
PARTS = OUTD / "parts"
NATIVE = "0x" + "0" * 40
W = 114_240                 # 3.2 h of blocks
DEC = 17_850                # decision at init + 30 min
HOLD = 71_400               # 2 h
MIN_SWAPS, MIN_VOL_USD, MAX_SHARE = 20, 1_000.0, 0.50
BID = (0.70, 0.97)
STRADDLE = (1 / 1.40, 1.40)
HAIRCUT, HAIRCUT_WORST = 1.04, 1.16
GAS_TX_USD = 0.27
UNIT = 100.0
SANE = 700_000


def launches():
    bounds = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    a, b = bounds["2026-09-15"], bounds["2026-09-25"]
    out = []
    for p in json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz", "rt"))["pools"]:
        if not (a <= p["init_block"] < b) or p["hooks"] != NATIVE or p["fee"] == 0:
            continue
        c0, c1 = p["currency0"], p["currency1"]
        if USDG in (c0, c1) or WETH in (c0, c1) or c0 == NATIVE:
            if c0 in (USDG, WETH, NATIVE) and c1 in (USDG, WETH, NATIVE):
                continue            # major/major pairs are not launches
            out.append(p)
    out.sort(key=lambda p: p["init_block"])
    return out, bounds, a, b


def plan():
    L, bounds, a, b = launches()
    inits = [p["init_block"] for p in L]
    chunks = []
    for s in range(a, b + W, 8_000):
        e = s + 7_999
        lo, hi = bisect.bisect_left(inits, s - W), bisect.bisect_right(inits, e)
        ids = [L[i]["pool_id"] for i in range(lo, hi)]
        for k in range(0, len(ids), 1000):
            chunks.append((s, e, k // 1000, ids[k:k + 1000]))
    return L, bounds, chunks


def fetch():
    L, bounds, chunks = plan()
    PARTS.mkdir(parents=True, exist_ok=True)
    todo = [c for c in chunks if not (PARTS / f"{c[0]}_{c[2]}.npz").exists()]
    print(json.dumps({"launch_pools": len(L), "requests_total": len(chunks), "remaining": len(todo)}), flush=True)

    def run(c):
        s, e, bi, ids = c
        rows = rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(s), "toBlock": hex(e),
                                    "topics": [SWAP_TOPIC, ids]}], timeout=120)
        index = {pid: i for i, pid in enumerate(ids)}
        parsed = parse(rows, index)
        np.savez_compressed(PARTS / f"{s}_{bi}.npz", **{ids[pi]: np.array(r, dtype=np.float64)
                                                       for pi, r in parsed.items()})
        return len(rows)
    n = 0
    with ThreadPoolExecutor(max_workers=5) as ex:
        for k, got in enumerate(ex.map(run, todo)):
            n += got
            if k % 200 == 0:
                print(f"{k}/{len(todo)} swaps so far {n}", flush=True)
    print("fetched swaps", n, flush=True)


def load_launch_arrays(L):
    per = {}
    for f in PARTS.glob("*.npz"):
        with np.load(f) as z:
            for pid in z.files:
                per.setdefault(pid, []).append(z[pid])
    meta = {p["pool_id"]: p for p in L}
    pools = {}
    for pid, parts in per.items():
        a = np.concatenate(parts)
        _, first = np.unique(a[:, 0] * 1e6 + a[:, 1], return_index=True)
        a = a[np.sort(first)]
        a = a[np.lexsort((a[:, 1], a[:, 0]))]
        m = meta[pid]
        a = a[(a[:, 0] >= m["init_block"]) & (a[:, 0] <= m["init_block"] + W)]
        if len(a):
            pools[pid] = S.Pool(pid, m, a)
    return pools


def eth_price_fn():
    ref_id = next(f.stem for d in ("huntx_edge_logs", "huntx_edge_logs_early")
                  for f in (ROOT / d).glob("0x24107d152f*.npy"))
    parts = [np.load(ROOT / d / f"{ref_id}.npy") for d in ("huntx_edge_logs_early", "huntx_edge_logs")
             if (ROOT / d / f"{ref_id}.npy").exists()]
    a = np.concatenate(parts)
    a = a[np.lexsort((a[:, 1], a[:, 0]))]
    meta = json.loads((ROOT / "huntx_edge_logs" / "meta.json").read_text())["pools"][ref_id]
    q1 = meta["currency1"] == USDG

    def f(block):
        i = int(np.searchsorted(a[:, 0], block, side="left")) - 1
        s = a[max(i, 0), 4]
        return (s * s if q1 else 1 / (s * s)) * 1e12
    return f


def price_q(pool, s):
    return s * s if pool.q1 else 1 / (s * s)


def to_usd(pool, raw, eth):
    return raw / 1e6 if pool.quote == USDG else raw / 1e18 * eth


def raw_of(pool, usd, eth):
    return usd * 1e6 if pool.quote == USDG else usd / eth * 1e18


def screen(pool, eth_fn):
    t = pool.meta["init_block"] + DEC
    i = pool.idx(t)
    if i < MIN_SWAPS:
        return None, "swaps < 20"
    q = np.abs(pool.qamt[:i])
    eth = eth_fn(t)
    vol = to_usd(pool, float(q.sum()), eth)
    if vol < MIN_VOL_USD:
        return None, "volume < $1k"
    if q.max() / q.sum() > MAX_SHARE:
        return None, "one swap > 50%"
    if abs(pool.tick[i - 1]) >= SANE:
        return None, "degenerate price"
    return {"t": t, "vol30": vol, "swaps30": i, "eth": eth}, None


def unit(pool, d, kind, usd_size, eth_fn):
    t, tx = d["t"], d["t"] + HOLD
    s = pool.sqrt_before(t)
    eth_e, eth_x = eth_fn(t), eth_fn(tx)
    V = raw_of(pool, usd_size, eth_e)
    s0 = slot0(pool.pid, t - 1)
    p0, p1 = s0["proto0"], s0["proto1"]
    if kind == "bid":
        sa, sb, _, _ = S.bid_range(pool, s, *BID)
        u0, u1 = amounts(1.0, s, sa, sb)
        L = V / value_in_quote(u0, u1, s, pool.q1)
        tok_left, q_left = 0.0, V - L * (u1 if pool.q1 else u0)
        entry_cost = 0.0
    else:
        sa, sb, _, _ = snap_range(s, *STRADDLE, pool.spacing, pool.q1)
        u0, u1 = amounts(1.0, s, sa, sb)
        uval = value_in_quote(u0, u1, s, pool.q1)
        tok_u, q_u = (u0, u1) if pool.q1 else (u1, u0)
        swap_in = int(V * (uval - q_u) / uval)
        got = quote_exact_in(pool.meta, not pool.q1, swap_in, t - 1)
        if not got:
            return {"status": "failed_entry"}
        L = min(got / tok_u, (V - swap_in) / q_u)
        tok_left, q_left = got - L * tok_u, (V - swap_in) - L * q_u
        entry_cost = to_usd(pool, swap_in - got * price_q(pool, s), eth_e)
    f0, f1, _, _ = pool.fees(t, tx, sa, sb, L, p0, p1, s)
    se = pool.sqrt_before(tx) or s
    x, y = amounts(L, se, sa, sb)
    tok_lp, q_lp = (x, y) if pool.q1 else (y, x)
    tf, qf = (f0, f1) if pool.q1 else (f1, f0)
    res = {}
    tok = tok_lp + tok_left + tf / HAIRCUT
    tok_i = int(min(tok, 2**128 - 1))
    out = quote_exact_in(pool.meta, pool.q1, tok_i, tx - 1) if tok_i >= 1 else 0
    for label, h in (("", HAIRCUT), ("_worst", HAIRCUT_WORST)):
        tok_h = tok_lp + tok_left + tf / h
        out_h = (out or 0) * (tok_h / tok if tok > 0 else 0)
        proceeds = q_lp + q_left + qf / h + out_h
        res["net_usd" + label] = to_usd(pool, proceeds, eth_x) - usd_size - 3 * GAS_TX_USD
        res["failed_exit" + label] = out is None
    res.update(status="ok", kind=kind, filled=tok_lp + tok_left > 0 and kind == "bid" and tok_lp > 0,
               fees_usd=to_usd(pool, value_in_quote(f0, f1, se, pool.q1), eth_x) / HAIRCUT,
               token_ret=price_q(pool, se) / price_q(pool, s) - 1, exit_tick=int(pool.tick[pool.idx(tx) - 1]),
               entry_cost_usd=entry_cost)
    return res


def boot(rows, key):
    byd = {}
    for r in rows:
        byd.setdefault(r["day"], []).append(r[key])
    ks = sorted(byd)
    rng = random.Random(8)
    m = sorted(statistics.mean([v for k in [rng.choice(ks) for _ in ks] for v in byd[k]]) for _ in range(4000))
    return {"p05": round(m[200], 3), "p50": round(m[2000], 3), "p95": round(m[3800], 3)}


def evaluate():
    load_cache()
    L, bounds, _ = plan()
    pools = load_launch_arrays(L)
    eth_fn = eth_price_fn()
    days = sorted(d for d in bounds if "2026-09-15" <= d <= "2026-09-25")
    census, cands = {}, []
    for pid, pool in pools.items():
        d, why = screen(pool, eth_fn)
        census[why or "ELIGIBLE"] = census.get(why or "ELIGIBLE", 0) + 1
        if d:
            d["day"] = max(x for x in days if bounds[x] <= d["t"])
            cands.append((pid, d))
    census["no swaps in first 3.2h"] = len(L) - len(pools)
    print("launches", len(L), "with swaps", len(pools), "census", census, flush=True)
    print("eligible", len(cands), "-> quote calls ~", len(cands) * 5, flush=True)
    if "--go" not in sys.argv:
        return
    rows = {"bid": [], "straddle": []}
    rng = random.Random(20260930)
    by_day = {}
    for c in cands:
        by_day.setdefault(c[1]["day"], []).append(c)
    sample = []
    for day, cs in sorted(by_day.items()):
        k = round(2000 * len(cs) / len(cands))
        sample += rng.sample(cs, min(k, len(cs)))
    straddle_ids = {c[0] for c in rng.sample(sample, min(500, len(sample)))}
    print("sampled", len(sample), "straddle", len(straddle_ids), flush=True)
    all_cands, cands = cands, sample

    def job(c):
        pid, d = c
        out = {}
        for kind in (("bid", "straddle") if pid in straddle_ids else ("bid",)):
            try:
                out[kind] = unit(pools[pid], d, kind, UNIT, eth_fn)
            except Exception as e:
                out[kind] = {"status": "error", "err": str(e)[:120]}
        return pid, d, out
    for pid, d, out in S.pmap(job, cands, workers=6):
        for kind, r in out.items():
            rows[kind].append({"pool_id": pid, "token": pools[pid].token, "day": d["day"], "vol30": d["vol30"], **r})
    save_cache()
    report = {}
    first_half = [d for d in days if d < "2026-09-20"]
    for kind, rs in rows.items():
        ok = [r for r in rs if r.get("status") == "ok"]
        if not ok:
            report[kind] = {"n": 0}
            continue
        tok = {}
        for r in ok:
            tok.setdefault(r["token"], []).append(r["net_usd"])
        report[kind] = {
            "n": len(ok), "errors": sum(r.get("status") == "error" for r in rs),
            "failed_entry": sum(r.get("status") == "failed_entry" for r in rs),
            "mean_net": round(statistics.mean(r["net_usd"] for r in ok), 3),
            "median_net": round(statistics.median(r["net_usd"] for r in ok), 3),
            "mean_net_worst_haircut": round(statistics.mean(r["net_usd_worst"] for r in ok), 3),
            "win_rate": round(sum(r["net_usd"] > 0 for r in ok) / len(ok), 3),
            "profitable_tokens": sum(statistics.mean(v) > 0 for v in tok.values()), "tokens": len(tok),
            "boot": boot(ok, "net_usd"),
            "half1_mean": round(statistics.mean([r["net_usd"] for r in ok if r["day"] in first_half] or [0]), 3),
            "half2_mean": round(statistics.mean([r["net_usd"] for r in ok if r["day"] not in first_half] or [0]), 3),
            "rug_or_dead_exits": sum(abs(r["exit_tick"]) >= SANE for r in ok),
            "mean_fees": round(statistics.mean(r["fees_usd"] for r in ok), 3),
            "median_token_ret": round(statistics.median(r["token_ret"] for r in ok), 4),
            "day_means": {d: round(statistics.mean(r["net_usd"] for r in ok if r["day"] == d), 3)
                          for d in days if any(r["day"] == d for r in ok)},
        }
    # $200 portfolio, K=3 concurrent $66.67 bid units, chronological
    ordered = sorted(all_cands, key=lambda c: c[1]["t"])
    open_until, nav, taken = [], 0.0, []
    for pid, d in ordered:
        open_until = [x for x in open_until if x > d["t"]]
        if len(open_until) >= 3:
            continue
        r = unit(pools[pid], d, "bid", 200 / 3, eth_fn)
        if r.get("status") != "ok":
            continue
        nav += r["net_usd"]
        taken.append(r["net_usd"])
        open_until.append(d["t"] + HOLD)
    save_cache()
    report["portfolio_bid_K3"] = {"net_usd_on_200": round(nav, 3), "positions": len(taken),
                                  "profitable": sum(x > 0 for x in taken)}
    OUTD.mkdir(exist_ok=True)
    (OUTD / "results.json").write_text(json.dumps({"method": __doc__.strip(), "census": census, "report": report},
                                                  indent=1, default=str))
    with gzip.open(OUTD / "units.json.gz", "wt") as fh:
        json.dump(rows, fh, default=str)
    print(json.dumps(report, indent=1, default=str))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "dry"
    if mode == "dry":
        L, _, chunks = plan()
        print(json.dumps({"launch_pools": len(L), "log_requests": len(chunks)}))
    elif mode == "fetch":
        fetch()
    else:
        evaluate()
