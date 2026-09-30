"""M-series (Amendment A11): LP management factorial on stock-token USDG pools.

Levers: width (±2.5/5/10%), rebanding after a whole day out of range (swap50 |
maker | static), session exposure (always | toxic_off | prime_only). Screening
on discovery decisions uses modeled costs (pool fee + impact measured from the
unit's exact entry quote); confirmation uses exact V4Quoter quotes for every
swap. Units are paired across configurations. Read-only.
Usage: python huntx_stock_mgmt.py screen | confirm <width> <reband> <session>
"""

from __future__ import annotations

import gzip
import itertools
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
import huntx_stock_vault as V
from huntx_edge_engine import amounts, load_cache, quote_exact_in, save_cache, snap_range, value_in_quote
from huntx_edge_oos_study import make_proto

ROOT = Path(__file__).parent
DISC = [f"2026-09-{d:02d}" for d in range(8, 16)]
TEST = [f"2026-09-{d:02d}" for d in range(16, 25)]
WIDTHS = {"2.5": 1.025, "5": 1.05, "10": 1.10}
REBANDS = ("swap50", "maker", "static")
SESSIONS = ("always", "toxic_off", "prime_only")
BASELINE = ("10", "swap50", "always")
LN = math.log(1.0001)


def price_q(p, s):
    return s * s if p.q1 else 1 / (s * s)


def is_live(clock, blk, mode):
    if mode == "always":
        return True
    dt = datetime.fromtimestamp(clock.ts(blk), timezone.utc)
    weekend = dt.weekday() >= 5
    m = dt.hour * 60 + dt.minute
    if mode == "toxic_off":
        return weekend or not (8 * 60 <= m < 20 * 60)
    return weekend or m >= 20 * 60                      # prime_only


def switch_points(clock, A, B, mode):
    if mode == "always":
        return []
    pts, t, prev = [], clock.ts(A), is_live(clock, A, mode)
    while t < clock.ts(B):
        t += 600
        b = clock.blk(t)
        cur = is_live(clock, b, mode)
        if cur != prev and A < b < B:
            pts.append(b)
        prev = cur
    return pts


def one_sided(p, s, side, width):
    """Quote-only 'bid' below price or token-only 'ask' above price, total width (1+w)^2."""
    M = width * width
    sp = p.spacing
    t_now = 2 * math.log(s) / LN
    if side == "bid":
        sa, sb, ta, tb = S.bid_range(p, s, 1 / M, 0.999)
        return sa, sb
    if p.q1:                        # token price = s^2: ask = higher ticks
        ta = math.ceil(2 * math.log(s * math.sqrt(1.001)) / LN / sp) * sp
        while ta <= t_now:
            ta += sp
        tb = max(ta + sp, math.ceil(2 * math.log(s * math.sqrt(M)) / LN / sp) * sp)
    else:                           # token price = 1/s^2: ask = lower ticks
        tb = math.floor(2 * math.log(s / math.sqrt(1.001)) / LN / sp) * sp
        while tb >= t_now:
            tb -= sp
        ta = min(tb - sp, math.floor(2 * math.log(s / math.sqrt(M)) / LN / sp) * sp)
    return math.exp(ta * LN / 2), math.exp(tb * LN / 2)


def unit_units(p, s, sa, sb):
    u0, u1 = amounts(1.0, s, sa, sb)
    return ((u0, u1) if p.q1 else (u1, u0))


class Swapper:
    """Exact quotes, or modeled fee + impact (impact measured from the exact entry quote)."""

    def __init__(self, p, exact, impact):
        self.p, self.exact, self.impact = p, exact, impact
        self.fee = p.meta["fee"] / 1e6

    def sell_token(self, amt, s, blk):
        if amt < 1:
            return 0.0
        if self.exact:
            out = quote_exact_in(self.p.meta, self.p.q1, int(min(amt, 2**128 - 1)), blk - 1)
            return None if out is None else float(out)
        return amt * price_q(self.p, s) * (1 - self.fee) * (1 - self.impact)

    def buy_token(self, q, s, blk):
        if q < 1:
            return 0.0
        if self.exact:
            out = quote_exact_in(self.p.meta, not self.p.q1, int(q), blk - 1)
            return None if out is None else float(out)
        return q / price_q(self.p, s) * (1 - self.fee) * (1 - self.impact)


def run(p, d, bounds, clock, proto, width, reband, session, exact, impact, dollars=100.0):
    days = sorted(bounds)
    di = days.index(d)
    A, B = bounds[d], bounds[days[di + V.HORIZON]]
    s = p.sqrt_before(A)
    sw = Swapper(p, exact, impact)
    fee_mult = 1 - p.meta["fee"] / 1e6
    sa, sb = s / math.sqrt(width), s * math.sqrt(width)
    sa, sb, _, _ = snap_range(s, 1 / width, width, p.spacing, p.q1)
    tu, qu = unit_units(p, s, sa, sb)
    uval = qu + tu * price_q(p, s)
    V0 = dollars * 1e6
    swap_in = V0 * (tu * price_q(p, s)) / uval
    got = sw.buy_token(swap_in, s, A)
    if got is None:
        return {"status": "failed_entry"}
    tok, q = got, V0 - swap_in
    tok0, q0 = tok, q
    gas = 2 * V.GAS
    fees_q, rebands = 0.0, 0
    L, live = 0.0, False
    p0, p1 = proto(None, p.pid, d)
    daily = [bounds[x] for x in days[di + 1: di + V.HORIZON]]
    points = sorted(set(daily + switch_points(clock, A, B, session) + [B]))
    x = A
    last_boundary = A

    def mint_now(sx):
        nonlocal L, tok, q, live
        tu_, qu_ = unit_units(p, sx, sa, sb)
        Lt = tok / tu_ if tu_ > 0 else math.inf
        Lq = q / qu_ if qu_ > 0 else math.inf
        L = min(Lt, Lq)
        if not math.isfinite(L):
            L = 0.0
        tok -= L * tu_
        q -= L * qu_
        live = True

    def withdraw(sy):
        nonlocal L, tok, q, live
        a0, a1 = amounts(L, sy, sa, sb)
        t_w, q_w = ((a0, a1) if p.q1 else (a1, a0))
        tok += t_w
        q += q_w
        L, live = 0.0, False

    if is_live(clock, A, session):
        mint_now(s)
    for y in points:
        sx = p.sqrt_before(x) or s
        if live:
            f0, f1, _, _ = p.fees(x, y, sa, sb, L, p0, p1, sx)
            sy = p.sqrt_before(y) or sx
            tf, qf = (f0, f1) if p.q1 else (f1, f0)
            fees_q += (qf + tf * price_q(p, sy) * fee_mult) / V.HAIRCUT
        sy = p.sqrt_before(y) or sx
        if y == B:
            if live:
                withdraw(sy)
            break
        if y in daily:
            i0, i1 = p.idx(last_boundary), p.idx(y)
            path = p.sq[i0:i1]
            out_all = len(path) > 0 and (np.all(path < sa) or np.all(path > sb))
            if out_all and reband != "static" and abs(p.tick[i1 - 1]) < V.SANE:
                was_live = live
                if live:
                    withdraw(sy)
                    gas += V.GAS
                if reband == "swap50":
                    nsa, nsb, _, _ = snap_range(sy, 1 / width, width, p.spacing, p.q1)
                    ntu, nqu = unit_units(p, sy, nsa, nsb)
                    total = q + tok * price_q(p, sy)
                    target_tok_val = total * (ntu * price_q(p, sy)) / (nqu + ntu * price_q(p, sy))
                    if tok * price_q(p, sy) > target_tok_val:
                        sell = tok - target_tok_val / price_q(p, sy)
                        out = sw.sell_token(sell, sy, y)
                        if out is not None:
                            tok -= sell
                            q += out
                    else:
                        spend = q - (total - target_tok_val)
                        out = sw.buy_token(spend, sy, y)
                        if out is not None:
                            q -= spend
                            tok += out
                    gas += V.GAS
                    sa, sb = nsa, nsb
                else:                                   # maker: one-sided range, no swap
                    side = "bid" if tok * price_q(p, sy) < q else "ask"
                    sa, sb = one_sided(p, sy, side, width)
                rebands += 1
                if was_live or is_live(clock, y, session):
                    mint_now(sy)
                    gas += V.GAS
            last_boundary = y
        if session != "always":
            nxt_live = is_live(clock, y, session)
            if live and not nxt_live:
                withdraw(sy)
                gas += V.GAS
            elif not live and nxt_live:
                mint_now(sy)
                gas += V.GAS
        x = y
    se = p.sqrt_before(B) or s
    out = sw.sell_token(tok, se, B)
    hold_out = sw.sell_token(tok0, se, B)
    gas += 2 * V.GAS
    val = (q + (out or 0) + fees_q) / 1e6
    hold = (q0 + (hold_out or 0)) / 1e6 - 2 * V.GAS
    return {"status": "failed_exit" if out is None else "ok", "net_usd": val - gas - dollars,
            "vs_hold_usd": val - gas - hold, "fees_usd": fees_q / 1e6, "gas_usd": gas, "rebands": rebands,
            "token_ret": price_q(p, se) / price_q(p, s) - 1}


def setup():
    load_cache()
    state = json.load(gzip.open(S.STATE, "rt", encoding="utf-8"))
    S.seed_cache_from_state(state)
    screen = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())
    bounds = {d: b for d, b in screen["day_bounds"].items() if "2026-09-01" <= d <= "2026-09-30"}
    clock = V.Clock(bounds)
    proto = make_proto(state, bounds)
    pools = {pid: p for pid, p in C.load_pools().items() if p.quote == S.USDG and p.token in V.STOCKS}
    return bounds, clock, proto, pools


def entry_impact(p, bounds, d):
    """Impact (ex-fee) of the exact $50 USDG->token entry quote at the decision block."""
    A = bounds[d]
    s = p.sqrt_before(A)
    amt = int(50e6)
    got = quote_exact_in(p.meta, not p.q1, amt, A - 1)
    if not got:
        return None
    fair = amt / price_q(p, s)
    return max(0.0, 1 - got / (fair * (1 - p.meta["fee"] / 1e6)))


def summarize(rows, key="net_usd"):
    ok = [r for r in rows if r.get("status") in ("ok", "failed_exit")]
    if not ok:
        return {"n": 0}
    byd = {}
    for r in ok:
        byd.setdefault(r["day"], []).append(r[key])
    ks = sorted(byd)
    rng = random.Random(12)
    m = sorted(statistics.mean([v for k in [rng.choice(ks) for _ in ks] for v in byd[k]]) for _ in range(4000))
    return {"n": len(ok), "mean": round(statistics.mean(r[key] for r in ok), 3),
            "median": round(statistics.median(r[key] for r in ok), 3),
            "vs_hold": round(statistics.mean(r["vs_hold_usd"] for r in ok), 3),
            "fees": round(statistics.mean(r["fees_usd"] for r in ok), 3),
            "gas": round(statistics.mean(r["gas_usd"] for r in ok), 3),
            "rebands": round(statistics.mean(r["rebands"] for r in ok), 3),
            "win": round(sum(r[key] > 0 for r in ok) / len(ok), 3), "boot90": [round(m[200], 3), round(m[3800], 3)],
            "symbols_profitable": sum(statistics.mean(v) > 0 for v in _by(ok, "symbol").values()),
            "symbols": len(_by(ok, "symbol"))}


def _by(rows, k):
    out = {}
    for r in rows:
        out.setdefault(r[k], []).append(r["net_usd"])
    return out


def screen_cmd():
    import os
    V.GAS = float(os.environ.get("HUNTX_GAS_TX", str(V.GAS)))
    print("gas per tx", V.GAS, flush=True)
    bounds, clock, proto, pools = setup()
    units = [(pid, d) for d in DISC for pid in V.eligible(pools, bounds, d)]
    imp = dict(zip(units, S.pmap(lambda u: entry_impact(pools[u[0]], bounds, u[1]), units, workers=6)))
    save_cache()
    units = [u for u in units if imp[u] is not None]
    print("discovery units", len(units), "median impact", round(statistics.median(imp.values() if False else [imp[u] for u in units]), 5), flush=True)
    res = {}
    for w, rb, ss in itertools.product(WIDTHS, REBANDS, SESSIONS):
        rows = []
        for pid, d in units:
            r = run(pools[pid], d, bounds, clock, proto, WIDTHS[w], rb, ss, False, imp[(pid, d)])
            rows.append({"pool_id": pid, "symbol": V.STOCKS[pools[pid].token], "day": d, **r})
        res[f"{w}|{rb}|{ss}"] = summarize(rows)
        print(f"{w:>4} {rb:7} {ss:10}", json.dumps(res[f'{w}|{rb}|{ss}']), flush=True)
    eligible_cfg = {k: v for k, v in res.items() if v.get("n") and v["vs_hold"] > 0}
    best = max(eligible_cfg, key=lambda k: eligible_cfg[k]["mean"]) if eligible_cfg else None
    out = {"method": __doc__.strip(), "discovery": DISC, "units": len(units), "screen": res, "selected": best,
           "baseline": "|".join(BASELINE)}
    tag = str(V.GAS).replace(".", "p")
    (ROOT / f"huntx_stock_mgmt_screen_gas{tag}.json").write_text(json.dumps(out, indent=1))
    print("SELECTED", best, "baseline", "|".join(BASELINE), flush=True)


def confirm_cmd(sel):
    import os
    V.GAS = float(os.environ.get("HUNTX_GAS_TX", str(V.GAS)))
    print("gas per tx", V.GAS, flush=True)
    bounds, clock, proto, pools = setup()
    units = [(pid, d) for d in TEST for pid in V.eligible(pools, bounds, d)]
    print("test units", len(units), flush=True)
    out = {}
    for label, cfg in (("selected", sel), ("krystal_baseline", BASELINE)):
        w, rb, ss = cfg
        res = S.pmap(lambda u: run(pools[u[0]], u[1], bounds, clock, proto, WIDTHS[w], rb, ss, True, 0.0), units,
                     workers=6)
        save_cache()
        out[label] = [{"pool_id": pid, "symbol": V.STOCKS[pools[pid].token], "day": d, **r}
                      for (pid, d), r in zip(units, res)]
        print(label, "|".join(cfg), json.dumps(summarize(out[label])), flush=True)
    diff = []
    base = {(r["pool_id"], r["day"]): r for r in out["krystal_baseline"] if r.get("status") in ("ok", "failed_exit")}
    for r in out["selected"]:
        b = base.get((r["pool_id"], r["day"]))
        if b and r.get("status") in ("ok", "failed_exit"):
            diff.append({"day": r["day"], "symbol": r["symbol"], "net_usd": r["net_usd"] - b["net_usd"],
                         "vs_hold_usd": 0.0, "fees_usd": 0.0, "gas_usd": 0.0, "rebands": 0})
    report = {"selected": "|".join(sel), "baseline": "|".join(BASELINE),
              "selected_summary": summarize(out["selected"]), "baseline_summary": summarize(out["krystal_baseline"]),
              "paired_difference": summarize(diff)}
    tag = str(V.GAS).replace(".", "p")
    (ROOT / f"huntx_stock_mgmt_confirm_gas{tag}.json").write_text(json.dumps(report, indent=1))
    with gzip.open(ROOT / "huntx_stock_mgmt_confirm_units.json.gz", "wt") as fh:
        json.dump(out, fh)
    print(json.dumps(report, indent=1))


if __name__ == "__main__" and sys.argv[1] in ("screen", "confirm"):
    if sys.argv[1] == "screen":
        screen_cmd()
    else:
        confirm_cmd(tuple(sys.argv[2:5]))


def portfolio_cmd():
    """A13: $200 portfolio, K slots, one per symbol, ranked by trailing fee yield (+/-2.5%)."""
    import os
    V.GAS = float(os.environ.get("HUNTX_GAS_TX", "0.0125"))
    bounds, clock, proto, pools = setup()
    days = sorted(bounds)
    out = {}
    for K in (3, 5):
        held, taken, nav = [], [], 0.0
        for d in TEST:
            di = days.index(d)
            for h in [h for h in held if h["exit"] <= di]:
                nav += h["net"]
            held = [h for h in held if h["exit"] > di]
            el = V.eligible(pools, bounds, d)
            ranked = sorted(((trailing_yield25(pools[pid], bounds, d, proto) or -1, pid) for pid in el), reverse=True)
            for y, pid in ranked:
                if len(held) >= K:
                    break
                sym = V.STOCKS[pools[pid].token]
                if any(h["sym"] == sym for h in held):
                    continue
                r = run(pools[pid], d, bounds, clock, proto, 1.025, "static", "always", True, 0.0, 200 / K)
                if r.get("status") == "failed_entry":
                    continue
                held.append({"sym": sym, "exit": di + V.HORIZON, "net": r["net_usd"], "day": d})
                taken.append({"sym": sym, "day": d, "net": r["net_usd"], "fees": r["fees_usd"]})
        nav += sum(h["net"] for h in held)
        save_cache()
        out[f"K{K}"] = {"net_usd_on_200": round(nav, 3), "positions": len(taken),
                        "profitable": sum(t["net"] > 0 for t in taken), "positions_detail": taken}
        print(f"K{K}", json.dumps({k: v for k, v in out[f'K{K}'].items() if k != 'positions_detail'}), flush=True)
    (ROOT / "huntx_stock_portfolio.json").write_text(json.dumps(out, indent=1))


def trailing_yield25(p, bounds, d, proto):
    days = sorted(bounds)
    di = days.index(d)
    ys = []
    for k in (3, 2, 1):
        a, b = bounds[days[di - k]], bounds[days[di - k + 1]]
        s = p.sqrt_before(a)
        if s is None:                      # logs start at the first boundary: use the first swap's price
            i = p.idx(a)
            if i >= len(p.sq) or p.blk[i] >= b:
                return None
            s = float(p.sq[i])
        sa, sb, _, _ = snap_range(s, 1 / 1.025, 1.025, p.spacing, p.q1)
        u0, u1 = amounts(1.0, s, sa, sb)
        L = 100e6 / value_in_quote(u0, u1, s, p.q1)
        p0, p1 = proto(None, p.pid, days[di - k])
        f0, f1, _, _ = p.fees(a, b, sa, sb, L, p0, p1, s)
        ys.append(value_in_quote(f0, f1, p.sqrt_before(b) or s, p.q1) / 100e6)
    return statistics.mean(ys)


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "portfolio":
    portfolio_cmd()
