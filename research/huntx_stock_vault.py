"""V-series (Amendment A10): stock-token LP vault backtest. Read-only; exact quotes.

S0 always-on centered range with daily re-centering; S1 = S0 restricted to the
daily top 3 by trailing fee yield; S2 = session-timed (inactive 08:00-20:00 UTC
weekdays: withdraw, then re-mint at 20:00 centered with no swap, leftover idle).
$100 units, 5-day hold, decisions 2026-09-08..09-24, fees / 1.03, exact
V4Quoter entry, rebalancing and exit. Hold baseline = post-entry token mix
exited with its own quote.
"""

from __future__ import annotations

import gzip
import json
import math
import random
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import huntx_edge_slice_study as S
import huntx_harvester_clone as C
from huntx_edge_engine import amounts, load_cache, quote_exact_in, save_cache, snap_range, value_in_quote
from huntx_edge_oos_study import make_proto

ROOT = Path(__file__).parent
OUT = ROOT / "huntx_stock_vault_results.json"
STOCKS = {t["token"].lower(): t["symbol"] for t in json.loads((ROOT.parent / "public" / "rh_stocks.json").read_text())["tokens"]}
DECISIONS = [f"2026-09-{d:02d}" for d in range(8, 25)]
HORIZON = 5
HAIRCUT = 1.03
GAS = 0.27
SANE = 700_000


def price_q(p, s):
    return s * s if p.q1 else 1 / (s * s)


def usd(p, raw):
    return raw / 1e6                      # USDG-quoted pools only


class Clock:
    def __init__(self, bounds):
        ds = sorted(d for d in bounds if d >= "2026-09-01")
        self.b = np.array([bounds[d] for d in ds], dtype=float)
        self.t = np.array([datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp() for d in ds])

    def ts(self, blk):
        return float(np.interp(blk, self.b, self.t))

    def blk(self, ts):
        return int(np.interp(ts, self.t, self.b))


def active_intervals(clock, A, B, session_mode):
    """Block intervals within [A, B) where our liquidity is live."""
    if not session_mode:
        return [(A, B)]
    out, t, tB = [], clock.ts(A), clock.ts(B)
    cur = None
    step = 600                                   # 10-minute grid
    while t < tB:
        dt = datetime.fromtimestamp(t, timezone.utc)
        on = dt.weekday() >= 5 or not (8 * 60 <= dt.hour * 60 + dt.minute < 20 * 60)
        if on and cur is None:
            cur = t
        if not on and cur is not None:
            out.append((clock.blk(cur), clock.blk(t)))
            cur = None
        t += step
    if cur is not None:
        out.append((clock.blk(cur), B))
    return [(a, b) for a, b in out if b > a]


def centered(p, s, lo_hi):
    sa, sb, _, _ = snap_range(s, 1 / lo_hi, lo_hi, p.spacing, p.q1)
    u0, u1 = amounts(1.0, s, sa, sb)
    uval = value_in_quote(u0, u1, s, p.q1)
    tok_u, q_u = (u0, u1) if p.q1 else (u1, u0)
    return sa, sb, tok_u, q_u, (uval - q_u) / uval


def mint(tok, q, tok_u, q_u):
    L = min(tok / tok_u if tok_u > 0 else math.inf, q / q_u if q_u > 0 else math.inf)
    if not math.isfinite(L):
        L = 0.0
    return L, tok - L * tok_u, q - L * q_u


def unit(p, d, bounds, clock, proto, width, session_mode, dollars=100.0):
    days = sorted(bounds)
    di = days.index(d)
    A, B = bounds[d], bounds[days[di + HORIZON]]
    s = p.sqrt_before(A)
    V = dollars * 1e6
    sa, sb, tok_u, q_u, phi = centered(p, s, width)
    swap_in = int(V * phi)
    got = quote_exact_in(p.meta, not p.q1, swap_in, A - 1) if swap_in > 0 else 0
    if got is None:
        return {"status": "failed_entry"}
    tok0, q0 = float(got), V - swap_in
    tok, q = tok0, q0
    fees_q, gas, reranges, cycles, rebal_cost = 0.0, 2 * GAS, 0, 0, 0.0
    L = 0.0
    live = active_intervals(clock, A, B, session_mode)
    p0, p1 = proto(None, p.pid, d)
    for k, (x, y) in enumerate(live):
        sx = p.sqrt_before(x) or s
        if k > 0 or session_mode:
            sa, sb, tok_u, q_u, _ = centered(p, sx, width)
            cycles += 1 if k > 0 else 0
        if k > 0:
            gas += 2 * GAS
        L, tok, q = mint(tok, q, tok_u, q_u)
        # within the live interval: daily re-centering check (always-on mode only)
        seg_start = x
        cuts = [bounds[dd] for dd in days if x < bounds[dd] < y] if not session_mode else []
        for cut in cuts + [y]:
            f0, f1, _, _ = p.fees(seg_start, cut, sa, sb, L, p0, p1, p.sqrt_before(seg_start) or sx)
            sc = p.sqrt_before(cut) or sx
            tf, qf = (f0, f1) if p.q1 else (f1, f0)
            fees_q += (qf + tf * price_q(p, sc) * (1 - p.meta["fee"] / 1e6)) / HAIRCUT
            if cut != y:
                i0, i1 = p.idx(seg_start), p.idx(cut)
                path = p.sq[i0:i1]
                if len(path) and (np.all(path < sa) or np.all(path > sb)) and abs(p.tick[i1 - 1]) < SANE:
                    ax, ay = amounts(L, sc, sa, sb)
                    t_have, q_have = ((ax, ay) if p.q1 else (ay, ax))
                    t_have += tok
                    q_have += q
                    nsa, nsb, ntu, nqu, nphi = centered(p, sc, width)
                    total = q_have + t_have * price_q(p, sc)
                    target_tok = total * nphi
                    if t_have * price_q(p, sc) > target_tok:
                        sell = int(min(t_have, t_have - target_tok / price_q(p, sc)))
                        out = quote_exact_in(p.meta, p.q1, sell, cut - 1) if sell > 0 else 0
                        if out is not None:
                            rebal_cost += sell * price_q(p, sc) - out
                            t_have -= sell
                            q_have += out
                    else:
                        spend = int(min(q_have, q_have - (total - target_tok)))
                        out = quote_exact_in(p.meta, not p.q1, spend, cut - 1) if spend > 0 else 0
                        if out is not None:
                            rebal_cost += spend - out * price_q(p, sc)
                            q_have -= spend
                            t_have += out
                    sa, sb, tok_u, q_u = nsa, nsb, ntu, nqu
                    L, tok, q = mint(t_have, q_have, tok_u, q_u)
                    reranges += 1
                    gas += 2 * GAS
            seg_start = cut
        # withdraw at the end of the live interval
        sy = p.sqrt_before(y) or sx
        ax, ay = amounts(L, sy, sa, sb)
        t_w, q_w = ((ax, ay) if p.q1 else (ay, ax))
        tok += t_w
        q += q_w
        L = 0.0
    se = p.sqrt_before(B) or s
    t_sell = int(min(tok, 2**128 - 1))
    out = quote_exact_in(p.meta, p.q1, t_sell, B - 1) if t_sell >= 1 else 0
    hold_out = quote_exact_in(p.meta, p.q1, int(tok0), B - 1) if tok0 >= 1 else 0
    gas += 2 * GAS
    exec_val = usd(p, q + (out or 0) + fees_q)
    hold_val = usd(p, q0 + (hold_out or 0)) - 2 * GAS
    return {"status": "failed_exit" if out is None else "ok",
            "net_usd": exec_val - gas - dollars, "vs_hold_usd": exec_val - gas - hold_val,
            "hold_net_usd": hold_val - dollars, "fees_usd": usd(p, fees_q), "gas_usd": gas,
            "reranges": reranges, "cycles": cycles, "rebal_cost_usd": usd(p, rebal_cost),
            "token_ret": price_q(p, se) / price_q(p, s) - 1}


def eligible(pools, bounds, d):
    days = sorted(bounds)
    di = days.index(d)
    out = []
    for pid, p in pools.items():
        i = p.idx(bounds[d])
        if i == 0 or abs(p.tick[i - 1]) >= SANE or p.meta["init_block"] >= bounds[days[di - 3]]:
            continue
        counts = [p.idx(bounds[days[di - k + 1]]) - p.idx(bounds[days[di - k]]) for k in (3, 2, 1)]
        if min(counts) < 100:
            continue
        out.append(pid)
    return out


def trailing_fee_yield(p, bounds, d, proto):
    days = sorted(bounds)
    di = days.index(d)
    ys = []
    for k in (3, 2, 1):
        a, b = bounds[days[di - k]], bounds[days[di - k + 1]]
        s = p.sqrt_before(a)
        if s is None:
            return None
        sa, sb, tok_u, q_u, _ = centered(p, s, 1.05)
        u0, u1 = amounts(1.0, s, sa, sb)
        L = 100e6 / value_in_quote(u0, u1, s, p.q1)
        p0, p1 = proto(None, p.pid, days[di - k])
        f0, f1, _, _ = p.fees(a, b, sa, sb, L, p0, p1, s)
        ys.append(value_in_quote(f0, f1, p.sqrt_before(b) or s, p.q1) / 100e6)
    return statistics.mean(ys)


def summarize(rows):
    ok = [r for r in rows if r.get("status") in ("ok", "failed_exit")]
    if not ok:
        return {"n": 0}
    byd = {}
    for r in ok:
        byd.setdefault(r["day"], []).append(r["net_usd"])
    ks = sorted(byd)
    rng = random.Random(10)
    m = sorted(statistics.mean([v for k in [rng.choice(ks) for _ in ks] for v in byd[k]]) for _ in range(4000))
    sym = {}
    for r in ok:
        sym.setdefault(r["symbol"], []).append(r["net_usd"])
    return {"n": len(ok), "symbols": len(sym), "profitable_symbols": sum(statistics.mean(v) > 0 for v in sym.values()),
            "mean_net": round(statistics.mean(r["net_usd"] for r in ok), 3),
            "median_net": round(statistics.median(r["net_usd"] for r in ok), 3),
            "mean_vs_hold": round(statistics.mean(r["vs_hold_usd"] for r in ok), 3),
            "mean_hold_net": round(statistics.mean(r["hold_net_usd"] for r in ok), 3),
            "mean_fees": round(statistics.mean(r["fees_usd"] for r in ok), 3),
            "mean_gas": round(statistics.mean(r["gas_usd"] for r in ok), 3),
            "mean_rebal_cost": round(statistics.mean(r["rebal_cost_usd"] for r in ok), 3),
            "win_rate": round(sum(r["net_usd"] > 0 for r in ok) / len(ok), 3),
            "boot90": [round(m[200], 3), round(m[3800], 3)],
            "half1": round(statistics.mean([r["net_usd"] for r in ok if r["day"] <= "2026-09-15"] or [0]), 3),
            "half2": round(statistics.mean([r["net_usd"] for r in ok if r["day"] >= "2026-09-16"] or [0]), 3),
            "failed_exits": sum(r["status"] == "failed_exit" for r in ok),
            "by_symbol": {k: round(statistics.mean(v), 3) for k, v in sorted(sym.items(), key=lambda x: -len(x[1]))}}


def main():
    load_cache()
    state = json.load(gzip.open(S.STATE, "rt", encoding="utf-8"))
    S.seed_cache_from_state(state)
    screen = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())
    bounds = {d: b for d, b in screen["day_bounds"].items() if "2026-09-01" <= d <= "2026-09-30"}
    clock = Clock(bounds)
    proto = make_proto(state, bounds)
    allp = C.load_pools()
    pools = {pid: p for pid, p in allp.items() if p.quote == S.USDG and p.token in STOCKS}
    print("stock USDG pools", len(pools), flush=True)
    widths = {"w5": 1.05, "w2.5": 1.025, "w10": 1.10}
    only = sys.argv[1:] or ["S0_w5", "S2_w5", "S1_w5", "S0_w2.5", "S0_w10"]
    results, rows_all = {}, {}
    for spec in only:
        strat, wkey = spec.split("_")
        width = widths[wkey]
        jobs = []
        for d in DECISIONS:
            el = eligible(pools, bounds, d)
            if strat == "S1":
                sc = [(trailing_fee_yield(pools[pid], bounds, d, proto), pid) for pid in el]
                el = [pid for y, pid in sorted((x for x in sc if x[0] is not None), reverse=True)[:3]]
            jobs += [(pid, d) for pid in el]
        print(spec, "units", len(jobs), flush=True)
        res = S.pmap(lambda j: unit(pools[j[0]], j[1], bounds, clock, proto, width, strat == "S2"), jobs, workers=6)
        save_cache()
        rows = [{"pool_id": pid, "symbol": STOCKS[pools[pid].token], "day": d, **r} for (pid, d), r in zip(jobs, res)]
        rows_all[spec] = rows
        results[spec] = summarize(rows)
        print(spec, json.dumps({k: v for k, v in results[spec].items() if k != "by_symbol"}), flush=True)
    # $200 portfolio: K=3 concurrent S1-style picks (top by trailing fee yield), 5-day units, one per symbol
    if "S1_w5" in only:
        held, nav, taken = [], 0.0, []
        days = sorted(bounds)
        for d in DECISIONS:
            di = days.index(d)
            for h in [h for h in held if h["exit"] <= di]:
                nav += h["net"]
            held = [h for h in held if h["exit"] > di]
            el = eligible(pools, bounds, d)
            sc = sorted(((trailing_fee_yield(pools[pid], bounds, d, proto) or -1, pid) for pid in el), reverse=True)
            for y, pid in sc:
                if len(held) >= 3:
                    break
                sym = STOCKS[pools[pid].token]
                if any(h["sym"] == sym for h in held):
                    continue
                r = unit(pools[pid], d, bounds, clock, proto, 1.05, False, 200 / 3)
                if r.get("status") == "failed_entry":
                    continue
                held.append({"sym": sym, "exit": di + HORIZON, "net": r["net_usd"]})
                taken.append(r["net_usd"])
        nav += sum(h["net"] for h in held)
        results["portfolio_K3_S1_w5"] = {"net_usd_on_200": round(nav, 3), "positions": len(taken),
                                         "profitable": sum(x > 0 for x in taken)}
        save_cache()
    OUT.write_text(json.dumps({"method": __doc__.strip(), "results": results}, indent=1, default=str))
    with gzip.open(ROOT / "huntx_stock_vault_units.json.gz", "wt") as fh:
        json.dump(rows_all, fh, default=str)
    print(json.dumps(results, indent=1, default=str))


if __name__ == "__main__":
    main()
