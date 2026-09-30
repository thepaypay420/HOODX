"""A15: continuous stock-LP vault simulation (SLP-v2, SLP-v2-vol, Krystal-like), $200.

Hourly stepping 2026-09-04 -> 2026-09-29 on the pools' own swap logs. Fee
accrual uses the validated V4 model with dilution (÷1.03). Entry and exit, and
the Krystal-like swap rebalances, use exact V4Quoter quotes at the archive
block. Measured gas $0.0125/tx. Read-only.
"""

from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

import numpy as np

import huntx_stock_mgmt as M
import huntx_stock_vault as V
from huntx_edge_engine import amounts, quote_exact_in, save_cache, snap_range

ROOT = Path(__file__).parent
OUT = ROOT / "huntx_slp_continuous_results.json"
START, END, MID = "2026-09-04", "2026-09-29", "2026-09-16"
K = 5
CAPITAL = 200.0
H = 35_700
GAS = 0.0125
HAIR = 1.03


def price_q(p, s):
    return s * s if p.q1 else 1 / (s * s)


class Sleeve:
    def __init__(self, p, mode, dollars, t0, proto, route=None):
        self.p, self.mode, self.proto = p, mode, proto
        self.route = route or [p]          # pools of the same token usable for conversions
        self.gas, self.fee_tok, self.fee_q, self.rebands = 0.0, 0.0, 0.0, 0
        s = p.sqrt_before(t0)
        self.width = self._width(t0)
        if mode.startswith("skew:"):
            _, lo, hi = mode.split(":")
            sa, sb, _, _ = snap_range(s, float(lo), float(hi), p.spacing, p.q1)
        else:
            sa, sb, _, _ = snap_range(s, 1 / self.width, self.width, p.spacing, p.q1)
        tu, qu = M.unit_units(p, s, sa, sb)
        V0 = dollars * 1e6
        swap_in = V0 * (tu * price_q(p, s)) / (qu + tu * price_q(p, s))
        quotes = [quote_exact_in(r.meta, not r.q1, int(swap_in), t0 - 1) for r in self.route]
        quotes = [q for q in quotes if q]
        got = max(quotes) if quotes else None
        if got is None:
            raise RuntimeError("entry quote failed")
        self.tok, self.q = float(got), V0 - swap_in
        self.sa, self.sb = sa, sb
        self.L = 0.0
        self._mint(s)
        self.gas += 2 * GAS
        self.out_since = None
        self.last_reband = t0

    def _width(self, t):
        if self.mode.startswith("skew:"):
            _, lo, hi = self.mode.split(":")
            return math.sqrt(float(hi) / float(lo))
        if self.mode.startswith("fixed:"):
            return 1 + float(self.mode.split(":")[1])
        lo_hi = (0.025, 0.06)
        if self.mode.startswith("vol:"):
            _, k, lo, hi = self.mode.split(":")
            lo_hi = (float(lo), float(hi))
        if self.mode != "slp_vol" and not self.mode.startswith("vol:"):
            return 1.10 if self.mode == "krystal" else 1.025
        i0, i1 = self.p.idx(t - 72 * H), self.p.idx(t)
        sq = self.p.sq[i0:i1]
        if len(sq) < 30:
            return 1.025
        # hourly log returns of the token price over 3 days -> daily sigma
        blk = self.p.blk[i0:i1]
        hours = np.searchsorted(blk, np.arange(t - 72 * H, t, H), side="right") - 1
        hours = hours[hours >= 0]
        lp = np.log(sq[hours] ** 2)
        r = np.diff(lp)
        sig = float(np.std(r) * math.sqrt(24)) if len(r) > 5 else lo_hi[0]
        return 1 + min(max(sig, lo_hi[0]), lo_hi[1])

    def _mint(self, s):
        tu, qu = M.unit_units(self.p, s, self.sa, self.sb)
        Lt = self.tok / tu if tu > 0 else math.inf
        Lq = self.q / qu if qu > 0 else math.inf
        add = min(Lt, Lq)
        if not math.isfinite(add):
            add = 0.0
        self.L += add
        self.tok -= add * tu
        self.q -= add * qu

    def _withdraw(self, s):
        a0, a1 = amounts(self.L, s, self.sa, self.sb)
        t, q = ((a0, a1) if self.p.q1 else (a1, a0))
        self.tok += t
        self.q += q
        self.L = 0.0

    def step(self, t, t2, daily):
        p = self.p
        s = p.sqrt_before(t) or p.sq[0]
        day = DAYS[int(np.searchsorted(DAY_BLOCKS, t, side="right")) - 1]
        p0, p1 = self.proto(None, p.pid, day)
        if self.L > 0:
            f0, f1, _, _ = p.fees(t, t2, self.sa, self.sb, self.L, p0, p1, s)
            tf, qf = (f0, f1) if p.q1 else (f1, f0)
            self.fee_tok += tf / HAIR
            self.fee_q += qf / HAIR
        s2 = p.sqrt_before(t2) or s
        i2 = p.idx(t2)
        sane = i2 > 0 and abs(p.tick[i2 - 1]) < V.SANE
        out = not (self.sa <= s2 <= self.sb)
        self.out_since = (self.out_since or t2) if out else None
        if (sane and self.out_since and t2 - self.out_since >= 24 * H and t2 - self.last_reband >= 24 * H):
            self._withdraw(s2)
            self.gas += GAS
            if self.mode == "krystal":
                self.width = 1.10
                nsa, nsb, _, _ = snap_range(s2, 1 / self.width, self.width, p.spacing, p.q1)
                tu, qu = M.unit_units(p, s2, nsa, nsb)
                total = self.q + self.tok * price_q(p, s2)
                target = total * (tu * price_q(p, s2)) / (qu + tu * price_q(p, s2))
                if self.tok * price_q(p, s2) > target:
                    sell = self.tok - target / price_q(p, s2)
                    o = quote_exact_in(p.meta, p.q1, int(sell), t2 - 1)
                    if o is not None:
                        self.tok -= sell
                        self.q += o
                else:
                    spend = self.q - (total - target)
                    o = quote_exact_in(p.meta, not p.q1, int(spend), t2 - 1)
                    if o is not None:
                        self.q -= spend
                        self.tok += o
                self.gas += GAS
                self.sa, self.sb = nsa, nsb
            else:
                self.width = self._width(t2)
                side = "bid" if self.tok * price_q(p, s2) < self.q else "ask"
                self.sa, self.sb = M.one_sided(p, s2, side, self.width)
            self._mint(s2)
            self.gas += GAS
            self.rebands += 1
            self.last_reband = t2
            self.out_since = None
        if daily:
            if self.mode == "krystal":
                # harvest: token fees sold at mid minus the pool fee, into cash
                self.q += self.fee_q + self.fee_tok * price_q(p, s2) * (1 - p.meta["fee"] / 1e6)
                self.fee_tok = self.fee_q = 0.0
                self.gas += GAS
            else:
                self.tok += self.fee_tok
                self.q += self.fee_q
                self.fee_tok = self.fee_q = 0.0
                self._mint(s2)
                self.gas += GAS

    def mark_mid(self, t):
        s = self.p.sqrt_before(t)
        a0, a1 = amounts(self.L, s, self.sa, self.sb)
        t_, q_ = ((a0, a1) if self.p.q1 else (a1, a0))
        tok = self.tok + t_ + self.fee_tok
        return (self.q + q_ + self.fee_q + tok * price_q(self.p, s)) / 1e6 - self.gas

    def close(self, t):
        s = self.p.sqrt_before(t)
        self._withdraw(s)
        tok = self.tok + self.fee_tok
        amt = int(min(tok, 2**128 - 1))
        outs = [quote_exact_in(r.meta, r.q1, amt, t - 1) for r in self.route] if tok >= 1 else [0]
        outs = [o for o in outs if o is not None]
        out = max(outs) if outs else None
        self.gas += 2 * GAS
        return (self.q + self.fee_q + (out or 0)) / 1e6 - self.gas


DAYS: list = []
DAY_BLOCKS = np.array([])


def main():
    global DAYS, DAY_BLOCKS
    bounds, clock, proto, pools = M.setup()
    days = sorted(bounds)
    DAYS = days
    DAY_BLOCKS = np.array([bounds[d] for d in days])
    T0, T1, TM = bounds[START], bounds[END], bounds[MID]
    el = V.eligible(pools, bounds, START)
    best = {}
    for pid in el:
        y = M.trailing_yield25(pools[pid], bounds, START, proto)
        sym = V.STOCKS[pools[pid].token]
        if y is not None and (sym not in best or y > best[sym][0]):
            best[sym] = (y, pid)
    picks = sorted(best.items(), key=lambda kv: -kv[1][0])[:K]
    print("picks", [(s, round(y, 4)) for s, (y, _) in picks], flush=True)
    res = {"picks": [s for s, _ in picks]}
    daily_marks = {days.index(d): d for d in days if START < d <= END}
    for mode in ("slp", "slp_vol", "krystal"):
        sleeves = [Sleeve(pools[pid], mode, CAPITAL / K, T0, proto) for _, (_, pid) in picks]
        t = T0
        mid_nav = None
        while t < T1:
            t2 = min(t + H, T1)
            is_daily = any(bounds[d] <= t2 < bounds[d] + H for d in days if START < d < END)
            for sl in sleeves:
                sl.step(t, t2, is_daily)
            if mid_nav is None and t2 >= TM:
                mid_nav = sum(sl.mark_mid(t2) for sl in sleeves)
            t = t2
        final = [sl.close(T1) for sl in sleeves]
        res[mode] = {"final_nav": round(sum(final), 3), "net_usd": round(sum(final) - CAPITAL, 3),
                     "mid_nav_0916": round(mid_nav, 3), "per_sleeve": [round(x - CAPITAL / K, 3) for x in final],
                     "rebands": [sl.rebands for sl in sleeves], "gas": round(sum(sl.gas for sl in sleeves), 3)}
        save_cache()
        print(mode, json.dumps(res[mode]), flush=True)
    # hold baselines
    hold = 0.0
    for _, (_, pid) in picks:
        p = pools[pid]
        got = quote_exact_in(p.meta, not p.q1, int(CAPITAL / K * 1e6), T0 - 1)
        out = quote_exact_in(p.meta, p.q1, int(got), T1 - 1)
        hold += (out or 0) / 1e6
    res["hold_stocks"] = {"final_nav": round(hold, 3), "net_usd": round(hold - CAPITAL, 3)}
    res["hold_usdg"] = {"final_nav": CAPITAL, "net_usd": 0.0}
    save_cache()
    OUT.write_text(json.dumps({"method": __doc__.strip(), **res}, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()



def run_vault(pools, bounds, proto, start, end, K, mode, capital=200.0, symbols=None, routes=None):
    """Generic continuous vault run; returns net USD at exact exit plus per-sleeve detail."""
    global DAYS, DAY_BLOCKS
    days = sorted(bounds)
    DAYS = days
    DAY_BLOCKS = np.array([bounds[d] for d in days])
    T0, T1 = bounds[start], bounds[end]
    if symbols is None:
        best = {}
        for pid in V.eligible(pools, bounds, start):
            y = M.trailing_yield25(pools[pid], bounds, start, proto)
            sym = V.STOCKS[pools[pid].token]
            if y is not None and (sym not in best or y > best[sym][0]):
                best[sym] = (y, pid)
        picks = [pid for _, (y, pid) in sorted(best.items(), key=lambda kv: -kv[1][0])[:K]]
    else:
        picks = symbols
    sleeves = []
    for pid in picks:
        try:
            sleeves.append(Sleeve(pools[pid], mode, capital / len(picks), T0, proto,
                                  route=(routes or {}).get(pid)))
        except RuntimeError:
            continue
    t = T0
    while t < T1:
        t2 = min(t + H, T1)
        daily = any(bounds[d] <= t2 < bounds[d] + H for d in days if start < d < end)
        for sl in sleeves:
            sl.step(t, t2, daily)
        t = t2
    final = [sl.close(T1) for sl in sleeves]
    save_cache()
    return {"net_usd": sum(final) - capital * len(sleeves) / max(1, len(picks)), "sleeves": len(sleeves),
            "symbols": [V.STOCKS[pools[pid].token] for pid in picks],
            "per_sleeve": [round(x - capital / len(picks), 3) for x in final],
            "rebands": [sl.rebands for sl in sleeves], "gas": round(sum(sl.gas for sl in sleeves), 3)}
