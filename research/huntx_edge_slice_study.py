"""HUNTX edge — pilot-slice study (Amendment A2; exploratory, fold F3 only).

Decision days 2026-09-23..09-27 (00:00 UTC), 3-day hold, plus a frozen
prospective decision at 2026-09-30 00:00. Inputs: complete Swap logs for
prefilter-passing pools (huntx_edge_log_stage.py), archive state at every
boundary (huntx_edge_state_panel.py, seeded into the RPC cache), and exact
V4Quoter quotes at entry/exit archive blocks. Hypotheses H1, H2, H3, H5, H6
and control C0 exactly as pre-registered (docs/HUNTX-EDGE-PREREGISTRATION-
2026-09-30.md incl. amendments A1, A2). No threshold is tuned here.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from feex_next_day_check import rpc
from huntx_edge_chain import Q128, USDG, WETH
from huntx_edge_engine import (_cache, amounts, cached_call, load_cache, quote_exact_in, save_cache,
                               snap_range, value_in_quote)

ROOT = Path(__file__).parent
LOGDIR = ROOT / "huntx_edge_logs"
STATE = ROOT / "huntx_edge_state_panel.json.gz"
OUT = ROOT / "huntx_edge_slice_results.json"
LEDGER = ROOT / "huntx_edge_slice_ledger.json.gz"
PROSPECTIVE = ROOT / "huntx_edge_prospective_2026-09-30.json"
NATIVE = "0x" + "0" * 40
MAJORS = {USDG, WETH, NATIVE}

# ---- frozen pre-registered parameters (see prereg)
HOLD = 3
UNIT_USD = 100.0
PILOT_USD = 200.0
TOKEN_RANGE = (1 / 1.25, 1.25)
MAJOR_RANGE = (1 / 1.05, 1.05)
BID_RANGE = (0.90, 0.99)
G3_BAND = (0.85, 1.15)
G6_MIN_SWAPS = 20
G7_MAX_SHARE = 0.25
G5_EXTRA = 0.01
H2_SPIKE, H2_MAX_LIQ_GROWTH = 2.0, 1.5
H3_MAX_IMBALANCE = 0.20
GAS_TX_ETH_P90 = 1.982e-05
BLOCKS_PER_HOUR = 35_700          # ~9.92 blocks/s measured from day bounds
DECISION_DAYS = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]
PROSPECTIVE_DAY = "2026-09-30"


def pmap(fn, items, workers=8):
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(fn, items))


class Pool:
    def __init__(self, pid, meta, arr):
        self.pid, self.meta = pid, meta
        self.blk = arr[:, 0].astype(np.int64)
        self.a0, self.a1, self.sq, self.liq = arr[:, 2], arr[:, 3], arr[:, 4], arr[:, 5]
        self.tick, self.fee = arr[:, 6].astype(np.int64), arr[:, 7]
        c0, c1 = meta["currency0"], meta["currency1"]
        self.quote = USDG if USDG in (c0, c1) else WETH if WETH in (c0, c1) else NATIVE
        self.q1 = c1 == self.quote
        self.token = c0 if self.q1 else c1
        self.qdec = 6 if self.quote == USDG else 18
        self.major = self.token in MAJORS
        self.spacing = meta["tick_spacing"]
        self.qamt = self.a1 if self.q1 else self.a0          # caller-perspective quote delta

    def idx(self, block):
        return int(np.searchsorted(self.blk, block, side="left"))

    def sqrt_before(self, block):
        i = self.idx(block)
        return None if i == 0 else float(self.sq[i - 1])

    def liq_before(self, block):
        i = self.idx(block)
        return None if i == 0 else float(self.liq[i - 1])

    def fees(self, a, b, sa, sb, L, proto0, proto1, start_sqrt):
        """Vectorized position fees (raw token0/1) + event global growth (per unit L)."""
        i0, i1 = self.idx(a), self.idx(b)
        if i1 <= i0:
            return 0.0, 0.0, 0.0, 0.0
        cur = np.log(self.sq[i0:i1])
        prev = np.concatenate(([math.log(start_sqrt)], cur[:-1]))
        la, lb = math.log(sa), math.log(sb)
        lo, hi = np.minimum(prev, cur), np.maximum(prev, cur)
        span = hi - lo
        overlap = np.clip(np.minimum(hi, lb) - np.maximum(lo, la), 0, None)
        point = ((lo >= la) & (lo <= lb)).astype(float)
        frac = np.where(span < 1e-15, point, overlap / np.where(span < 1e-15, 1, span))
        a0, a1, liq, fee = self.a0[i0:i1], self.a1[i0:i1], self.liq[i0:i1], self.fee[i0:i1]
        zin = a0 < 0
        gross = np.where(zin, -a0, -a1)
        proto = np.where(zin, proto0, proto1)
        ok = (gross > 0) & (liq > 0)
        lp = np.where(ok, gross * np.maximum(fee - proto, 0) / 1e6, 0.0)
        safe = np.where(liq > 0, liq, 1.0)
        ours = lp * L / (safe + L) * frac
        g = np.where(ok, lp / safe, 0.0)
        return (float(ours[zin].sum()), float(ours[~zin].sum()), float(g[zin].sum()), float(g[~zin].sum()))


# ------------------------------------------------------------------ helpers

def seed_cache_from_state(state):
    """State panel reads use the same archive blocks as the engine cache keys."""
    bounds = state["day_bounds"]
    n = 0
    for pid, days in state["state"].items():
        for d, rec in days.items():
            blk = bounds[d] - 1
            if "g0" in rec:
                _cache.setdefault(f"fg:{pid}:{blk}", [rec["g0"], rec["g1"]]); n += 1
            if "sqrt" in rec:
                _cache.setdefault(f"s0:{pid}:{blk}", [int(rec["sqrt"]), rec["tick"], rec["proto"], rec["lp_fee"]])
    return n


def state_at(state, pid, day):
    return state["state"].get(pid, {}).get(day)


def state_sqrt(state, pid, day):
    r = state_at(state, pid, day)
    return int(r["sqrt"]) / 2**96 if r and "sqrt" in r and int(r["sqrt"]) > 0 else None


def fg(state, pid, day):
    r = state_at(state, pid, day)
    return None if r is None or "g0" not in r else (int(r["g0"]), int(r["g1"]))


def proto(state, pid, day):
    r = state_at(state, pid, day)
    p = r["proto"] if r else 0
    return p & 0xFFF, p >> 12


def eth_usd(state, days):
    """ETH in USDG at each boundary from the most active WETH|ETH/USDG state-panel pool."""
    cands = [(p.get("est_day_volume", 0), pid, p) for pid, p in state["pools"].items()
             if USDG in (p["currency0"], p["currency1"])
             and ({p["currency0"], p["currency1"]} & {WETH, NATIVE})]
    _, pid, p = max(cands)
    q1 = p["currency1"] == USDG
    out = {}
    for d in days:
        s = int(state["state"][pid][d]["sqrt"]) / 2**96
        price = s * s if q1 else 1 / (s * s)
        out[d] = price * 1e18 / 1e6
    return pid, out


def rng(pool, kind):
    if kind == "bid":
        return BID_RANGE
    return MAJOR_RANGE if pool.major else TOKEN_RANGE


def unit_raw(pool, eth, usd):
    return usd * 1e6 if pool.quote == USDG else usd / eth * 1e18


def to_usd(pool, eth, raw):
    return raw / 1e6 if pool.quote == USDG else raw / 1e18 * eth


def bid_range(pool, sq, lo, hi):
    """USDG-only bid: the edge nearest the price snaps INWARD so the whole range lies
    strictly on the quote side of the current price (prereg: 'USDG only')."""
    t_now = 2 * math.log(sq) / math.log(1.0001)
    sp = pool.spacing
    if pool.q1:                     # token price = s^2: bid lies at lower ticks
        ta = math.floor(2 * math.log(sq * math.sqrt(lo)) / math.log(1.0001) / sp) * sp
        tb = math.floor(2 * math.log(sq * math.sqrt(hi)) / math.log(1.0001) / sp) * sp
        while tb >= t_now:
            tb -= sp
        if ta >= tb:
            ta = tb - sp
    else:                           # token price = 1/s^2: bid lies at higher ticks
        ta = math.ceil(2 * math.log(sq / math.sqrt(hi)) / math.log(1.0001) / sp) * sp
        tb = math.ceil(2 * math.log(sq / math.sqrt(lo)) / math.log(1.0001) / sp) * sp
        while ta <= t_now:
            ta += sp
        if tb <= ta:
            tb = ta + sp
    return math.exp(ta * math.log(1.0001) / 2), math.exp(tb * math.log(1.0001) / 2), ta, tb


def position(pool, sq, value, kind):
    lo, hi = rng(pool, kind)
    if kind == "bid":
        sa, sb, ta, tb = bid_range(pool, sq, lo, hi)
    else:
        sa, sb, ta, tb = snap_range(sq, lo, hi, pool.spacing, pool.q1)
    u0, u1 = amounts(1.0, sq, sa, sb)
    uval = value_in_quote(u0, u1, sq, pool.q1)
    if not (uval > 0 and math.isfinite(uval)):
        return None
    tok_u, q_u = (u0, u1) if pool.q1 else (u1, u0)
    return {"sa": sa, "sb": sb, "uval": uval, "tok_u": tok_u, "q_u": q_u, "phi": (uval - q_u) / uval}


def calib(state, pool, d0, d1, g0, g1):
    x, y = fg(state, pool.pid, d0), fg(state, pool.pid, d1)
    if x is None or y is None:
        return None, None
    c0 = ((y[0] - x[0]) % 2**256) / Q128
    c1 = ((y[1] - x[1]) % 2**256) / Q128
    r0 = c0 / g0 if g0 > 0 else (1.0 if c0 == 0 else None)
    r1 = c1 / g1 if g1 > 0 else (1.0 if c1 == 0 else None)
    return r0, r1


def use_ratio(r):
    """Apply calibration inside [0.5, 2]; otherwise never scale fees upward."""
    if r is None:
        return 1.0
    return r if 0.5 <= r <= 2 else min(r, 1.0)


# ------------------------------------------------------------------ day metrics

def day_metrics(pool, state, days, bounds, eth):
    out = {}
    for j in range(len(days) - 1):
        d, e = days[j], days[j + 1]
        a, b = bounds[d], bounds[e]
        i0, i1 = pool.idx(a), pool.idx(b)
        q = pool.qamt[i0:i1]
        vol = float(np.abs(q).sum()) / 10**pool.qdec
        rec = {"swaps": i1 - i0, "vol": vol,
               "buy": float(-q[q < 0].sum()) / 10**pool.qdec,
               "largest": float(np.abs(q).max()) / 10**pool.qdec if i1 > i0 else 0.0,
               "liq_open": pool.liq_before(a)}
        # Boundary price: last swap before the boundary, else exact archive slot0 at boundary-1
        # (logs start at the first boundary, so day 0 has no prior swap).
        s0 = pool.sqrt_before(a) or state_sqrt(state, pool.pid, d)
        s1 = pool.sqrt_before(b) or state_sqrt(state, pool.pid, e)
        if s0 is None or s1 is None:
            out[d] = rec
            continue
        V = unit_raw(pool, eth[d], UNIT_USD)
        pos = position(pool, s0, V, "lp")
        if pos is None:
            out[d] = rec
            continue
        L = V / pos["uval"]
        p0, p1 = proto(state, pool.pid, d)
        f0, f1, g0, g1 = pool.fees(a, b, pos["sa"], pos["sb"], L, p0, p1, s0)
        r0, r1 = calib(state, pool, d, e, g0, g1)
        fee_val = value_in_quote(f0 * use_ratio(r0), f1 * use_ratio(r1), s1, pool.q1)
        e0, e1 = amounts(L, s1, pos["sa"], pos["sb"])
        h0, h1 = amounts(L, s0, pos["sa"], pos["sb"])
        lp_end, hold_end = value_in_quote(e0, e1, s1, pool.q1), value_in_quote(h0, h1, s1, pool.q1)
        rec.update(fee_yield=fee_val / V, excess=(fee_val + lp_end - hold_end) / V,
                   ev_g=[g0, g1], cal=[r0, r1], price_open=s0, price_close=s1,
                   spread=markout_spread(pool, a, b))
        out[d] = rec
    return out


def markout_spread(pool, a, b):
    """H6: volume-weighted realized LP spread (fee - 1h markout) over swaps in [a, b)."""
    i0, i1 = pool.idx(a), pool.idx(b)
    if i1 - i0 < 2:
        return None
    q = pool.qamt[i0:i1]
    notional = np.abs(q)
    buy = q < 0                                   # taker pays quote -> buys token
    pre = np.concatenate(([pool.sq[i0 - 1] if i0 > 0 else pool.sq[i0]], pool.sq[i0:i1 - 1]))
    post = pool.sq[i0:i1]
    # token price in quote: s^2 if quote is currency1 else 1/s^2
    tp = (lambda s: s * s) if pool.q1 else (lambda s: 1 / (s * s))
    p_avg = np.sqrt(tp(pre) * tp(post))
    # Markout horizon is capped at the window end (= decision block): no look-ahead.
    j = np.minimum(np.searchsorted(pool.blk, pool.blk[i0:i1] + BLOCKS_PER_HOUR, side="left"), i1) - 1
    j = np.clip(j, 0, len(pool.blk) - 1)
    p_h = tp(pool.sq[j])
    direction = np.where(buy, 1.0, -1.0)          # LP is short token after a taker buy
    lp_mark = -direction * notional * (p_h / p_avg - 1)
    fee = notional * pool.fee[i0:i1] / 1e6
    tot = notional.sum()
    return float((fee + lp_mark).sum() / tot) if tot > 0 else None


# ------------------------------------------------------------------ gates

def candidates(pools, metrics, state, days, bounds, eth, init_from, d):
    di = days.index(d)
    block = bounds[d]
    out = []
    for pid, pool in pools.items():
        m = metrics[pid]
        c = {"pool_id": pid, "token": pool.token, "quote": pool.quote, "fee": pool.meta["fee"],
             "initializer": init_from.get(pid)}
        age = (block - pool.meta["init_block"]) / (bounds[days[di]] - bounds[days[di - 1]])
        c["age_days"] = round(age, 2)
        c["stratum"] = "major" if pool.major else ("established" if age >= 7 else "young")
        reasons = []
        if di < 3 or pool.meta["init_block"] >= bounds[days[di - 3]]:
            reasons.append("G1 age < 3d")
        trail = [m.get(days[di - k]) for k in (3, 2, 1)] if di >= 3 else []
        if len(trail) < 3 or any(t is None or "excess" not in t for t in trail):
            c.update(ok=False, reasons=reasons + ["no trailing 3d metrics"])
            out.append(c)
            continue
        ev = [sum(t["ev_g"][k] for t in trail) for k in (0, 1)]
        x, y = fg(state, pid, days[di - 3]), fg(state, pid, d)
        if x is None or y is None:
            reasons.append("G3 no fee-growth state: UNVERIFIED")
        else:
            ch = [((y[k] - x[k]) % 2**256) / Q128 for k in (0, 1)]
            ratios = [ch[k] / ev[k] if ev[k] > 0 else (1.0 if ch[k] == 0 else None) for k in (0, 1)]
            c["g3"] = ratios
            if any(r is None or not (G3_BAND[0] <= r <= G3_BAND[1]) for r in ratios):
                reasons.append("G3 fee accounting mismatch: UNVERIFIED")
        c["trail_swaps"] = [t["swaps"] for t in trail]
        if min(c["trail_swaps"]) < G6_MIN_SWAPS:
            reasons.append("G6 < 20 swaps on a trailing day")
        vol3 = sum(t["vol"] for t in trail)
        share = max(t["largest"] for t in trail) / vol3 if vol3 else 1.0
        c["largest_share"] = share
        if share > G7_MAX_SHARE:
            reasons.append("G7 single swap > 25% of 3d volume")
        if pool.major and pool.token == pool.quote:
            reasons.append("G8 degenerate pair")
        c["excess"] = [t["excess"] for t in trail]
        c["fee_yield"] = [t["fee_yield"] for t in trail]
        c["spread"] = [t.get("spread") for t in trail]
        buy = sum(t["buy"] for t in trail)
        c["imbalance"] = abs(2 * buy - vol3) / vol3 if vol3 else None
        prior = [m[days[di - k]]["fee_yield"] for k in range(2, 9)
                 if di - k >= 0 and "fee_yield" in m.get(days[di - k], {})]
        c["h2_base"] = statistics.median(prior) if len(prior) >= 5 else None
        if di >= 7 and "price_open" in m.get(days[di - 7], {}):
            r = trail[-1]["price_close"] / m[days[di - 7]]["price_open"]
            c["drift7"] = math.log(r * r) if pool.q1 else -math.log(r * r)
        lq, lq3 = pool.liq_before(block), m[days[di - 3]].get("liq_open")
        c["liq_growth3"] = lq / lq3 if lq and lq3 else None
        c["fee_usd_24h"] = (trail[-1]["vol"] * (1 if pool.quote == USDG else eth[d]) * pool.meta["fee"] / 1e6)
        c["ok"] = not reasons
        c["reasons"] = reasons
        out.append(c)
    return out


def quote_gate(pools, cands, bounds, d, eth):
    todo = [c for c in cands if c["ok"]]

    def run(c):
        pool = pools[c["pool_id"]]
        sq = pool.sqrt_before(bounds[d])
        V = unit_raw(pool, eth[d], UNIT_USD)
        pos = position(pool, sq, V, "lp") if sq else None
        if pos is None:
            return {"ok": False, "reason": "G4 no valid position at decision price"}
        swap_in = int(V * pos["phi"])
        if swap_in <= 0:
            return {"ok": False, "reason": "G4 zero swap size"}
        got = quote_exact_in(pool.meta, not pool.q1, swap_in, bounds[d] - 1)
        if not got:
            return {"ok": False, "reason": "G4 entry quote failed"}
        back = quote_exact_in(pool.meta, pool.q1, got, bounds[d] - 1)
        if not back:
            return {"ok": False, "reason": "G4 reverse quote failed"}
        loss = (swap_in - back) / swap_in
        limit = 2 * pool.meta["fee"] / 1e6 + G5_EXTRA
        if loss > limit:
            return {"ok": False, "reason": f"G5 round-trip loss {loss:.4f} > {limit:.4f}", "loss": loss}
        return {"ok": True, "loss": loss, "rt_cost": loss * swap_in / V}
    for c, g in zip(todo, pmap(run, todo)):
        c["quote_gate"] = g
        if not g["ok"]:
            c["ok"] = False
            c["reasons"].append(g["reason"])
        else:
            c["rt_cost"] = g["rt_cost"]


def flags(c, eth_d):
    if not c["ok"]:
        return {h: None for h in ("H1", "H2", "H3", "H5", "H6", "C0")}
    gasf = GAS_TX_ETH_P90 * 4 * eth_d / UNIT_USD
    ex = c["excess"]
    h1 = HOLD * statistics.mean(ex) - c["rt_cost"] - gasf
    persist = all(e > 0 for e in ex)
    f = {"H1": h1 if persist and h1 > 0 else None}
    y1, base, lg = c["fee_yield"][-1], c.get("h2_base"), c.get("liq_growth3")
    h2 = y1 - c["rt_cost"]
    f["H2"] = h2 if base and y1 >= H2_SPIKE * base and lg is not None and lg <= H2_MAX_LIQ_GROWTH and h2 > 0 else None
    f["H3"] = h1 if (f["H1"] is not None and c.get("imbalance") is not None and c["imbalance"] <= H3_MAX_IMBALANCE
                     and c.get("drift7") is not None and c["drift7"] >= 0) else None
    f["H5"] = h1 if persist else None
    sp = c["spread"]
    f["H6"] = (statistics.mean(sp) * statistics.mean(c["fee_yield"])
               if all(s is not None and s > 0 for s in sp) and h1 > 0 else None)
    f["C0"] = c["fee_usd_24h"]
    return f


# ------------------------------------------------------------------ outcomes

def lp_outcome(pool, state, days, bounds, eth, d, usd, kind):
    di = days.index(d)
    x = days[di + HOLD]
    A, B = bounds[d], bounds[x]
    sq = pool.sqrt_before(A)
    V = unit_raw(pool, eth[d], usd)
    pos = position(pool, sq, V, kind)
    if kind == "bid":
        assert pos["phi"] < 1e-12, "bid range must be quote-only"
        tokens, q0 = 0.0, V
        L = V / pos["uval"]
        tok_left, q_left = 0.0, V - L * pos["q_u"]
    else:
        swap_in = int(V * pos["phi"])
        got = quote_exact_in(pool.meta, not pool.q1, swap_in, A - 1)
        if not got:
            return {"status": "failed_entry"}
        tokens, q0 = float(got), V - swap_in
        L = min(tokens / pos["tok_u"] if pos["tok_u"] > 0 else math.inf,
                q0 / pos["q_u"] if pos["q_u"] > 0 else math.inf)
        tok_left, q_left = tokens - L * pos["tok_u"], q0 - L * pos["q_u"]
    p0, p1 = proto(state, pool.pid, d)
    f0, f1, g0, g1 = pool.fees(A, B, pos["sa"], pos["sb"], L, p0, p1, sq)
    r0, r1 = calib(state, pool, d, x, g0, g1)
    f0, f1 = f0 * use_ratio(r0), f1 * use_ratio(r1)
    se = pool.sqrt_before(B)
    e0, e1 = amounts(L, se, pos["sa"], pos["sb"])
    lt, lq = (e0, e1) if pool.q1 else (e1, e0)
    ft, fq = (f0, f1) if pool.q1 else (f1, f0)
    tok_total = int(lt + ft + tok_left)
    out = quote_exact_in(pool.meta, pool.q1, tok_total, B - 1) if tok_total > 0 else 0
    gas = unit_raw(pool, eth[x], GAS_TX_ETH_P90 * 4 * eth[x])
    proceeds = lq + fq + q_left + (out or 0) - gas
    hold_out = quote_exact_in(pool.meta, pool.q1, int(tokens), B - 1) if tokens > 0 else 0
    hold = q0 + (hold_out or 0) - (unit_raw(pool, eth[x], GAS_TX_ETH_P90 * 2 * eth[x]) if tokens > 0 else 0)
    return {"status": "failed_exit" if out is None else "ok",
            "net_usd": to_usd(pool, eth[x], proceeds - V), "vs_hold_usd": to_usd(pool, eth[x], proceeds - hold),
            "hold_net_usd": to_usd(pool, eth[x], hold - V),
            "fees_usd": to_usd(pool, eth[x], value_in_quote(f0, f1, se, pool.q1)),
            "cal": [r0, r1], "token_ret": (se / sq) ** (2 if pool.q1 else -2) - 1,
            "in_range_exit": pos["sa"] <= se <= pos["sb"]}


def maker_outcome(pool, state, days, bounds, eth, d, usd):
    """H5 maker-only range-order cycling over the 3-day hold (see prereg A1)."""
    di = days.index(d)
    x = days[di + HOLD]
    A, B = bounds[d], bounds[x]
    V = unit_raw(pool, eth[d], usd)
    sp = pool.spacing
    p0, p1 = proto(state, pool.pid, d)
    ln = math.log(1.0001)

    def sqrt_t(t):
        return math.exp(t * ln / 2)
    i0, i1 = pool.idx(A), pool.idx(B)
    s = pool.sqrt_before(A)
    tick = math.floor(2 * math.log(s) / ln)
    quote_bal, tok_bal, fee_q, fee_t = V, 0.0, 0.0, 0.0
    reposition = 0
    fills = []

    def place_bid(cur_tick):
        # quote-only band on the "cheaper token" side of the current price
        if pool.q1:
            tb = math.floor(cur_tick / sp) * sp
            if tb >= cur_tick:
                tb -= sp
            return ("bid", tb - 2 * sp, tb)
        ta = math.floor(cur_tick / sp) * sp + sp
        return ("bid", ta, ta + 2 * sp)

    state_pos = place_bid(tick)
    L = quote_bal / ((sqrt_t(state_pos[2]) - sqrt_t(state_pos[1])) if pool.q1 else
                     (sqrt_t(state_pos[2]) - sqrt_t(state_pos[1])) / (sqrt_t(state_pos[1]) * sqrt_t(state_pos[2])))
    quote_bal = 0.0
    prev = s
    for i in range(i0, i1):
        cur = float(pool.sq[i])
        kind, ta, tb = state_pos
        sa, sb = sqrt_t(ta), sqrt_t(tb)
        # fee for this swap segment
        la, lb = math.log(sa), math.log(sb)
        lo, hi = min(math.log(prev), math.log(cur)), max(math.log(prev), math.log(cur))
        frac = (1.0 if la <= lo <= lb else 0.0) if hi - lo < 1e-15 else max(0.0, min(hi, lb) - max(lo, la)) / (hi - lo)
        if frac > 0 and pool.liq[i] > 0:
            zin = pool.a0[i] < 0
            gross = -pool.a0[i] if zin else -pool.a1[i]
            if gross > 0:
                lpf = gross * max(pool.fee[i] - (p0 if zin else p1), 0) / 1e6 * L / (pool.liq[i] + L) * frac
                is_token_fee = (zin and pool.q1) or ((not zin) and not pool.q1)
                if is_token_fee:
                    fee_t += lpf
                else:
                    fee_q += lpf
        prev = cur
        a0, a1 = amounts(L, cur, sa, sb)
        tk, qt = (a0, a1) if pool.q1 else (a1, a0)
        # Full conversion is detected by price crossing the far band edge (unit-free);
        # any residual of the other asset is carried, never dropped.
        bid_done = kind == "bid" and ((cur <= sa) if pool.q1 else (cur >= sb))
        ask_done = kind == "ask" and ((cur >= sb) if pool.q1 else (cur <= sa))
        if bid_done:
            tok_bal += tk
            quote_bal += qt
            fills.append({"block": int(pool.blk[i]), "type": "bid_filled", "sqrt": cur})
            reposition += 1
            # ask band directly above the filled band (token-only)
            state_pos = ("ask", tb, tb + 2 * sp) if pool.q1 else ("ask", ta - 2 * sp, ta)
            na, nb = sqrt_t(state_pos[1]), sqrt_t(state_pos[2])
            L = tok_bal * na * nb / (nb - na) if pool.q1 else tok_bal / (nb - na)
            tok_bal = 0.0          # quote residual (if any) stays in quote_bal
        elif ask_done:
            quote_bal += qt
            tok_bal += tk
            fills.append({"block": int(pool.blk[i]), "type": "ask_filled", "sqrt": cur})
            reposition += 1
            t_now = int(pool.tick[i])
            state_pos = place_bid(t_now)
            na, nb = sqrt_t(state_pos[1]), sqrt_t(state_pos[2])
            L = quote_bal / (nb - na) if pool.q1 else quote_bal * na * nb / (nb - na)
            quote_bal = 0.0        # token residual (if any) stays in tok_bal
    # final withdrawal at exit price
    kind, ta, tb = state_pos
    se = pool.sqrt_before(B)
    a0, a1 = amounts(L, se, sqrt_t(ta), sqrt_t(tb))
    tk, qt = (a0, a1) if pool.q1 else (a1, a0)
    tok_total = int(tok_bal + tk + fee_t)
    out = quote_exact_in(pool.meta, pool.q1, tok_total, B - 1) if tok_total > 0 else 0
    gas = unit_raw(pool, eth[x], GAS_TX_ETH_P90 * (2 + 2 * reposition + (1 if tok_total else 0)) * eth[x])
    proceeds = quote_bal + qt + fee_q + (out or 0) - gas
    # diagnostic: 24h token return after each bid fill
    post = []
    for f in fills:
        if f["type"] != "bid_filled":
            continue
        j = pool.idx(f["block"] + 24 * BLOCKS_PER_HOUR) - 1
        if j < len(pool.sq) and pool.blk[j] > f["block"]:
            post.append((float(pool.sq[j]) / f["sqrt"]) ** (2 if pool.q1 else -2) - 1)
    return {"status": "failed_exit" if out is None else "ok",
            "net_usd": to_usd(pool, eth[x], proceeds - V), "vs_hold_usd": to_usd(pool, eth[x], proceeds - V),
            "fees_usd": to_usd(pool, eth[x], fee_q + (fee_t * (se * se if pool.q1 else 1 / (se * se)))),
            "fills": len(fills), "repositions": reposition, "post_fill_24h_token_ret": post,
            "token_ret": (se / pool.sqrt_before(A)) ** (2 if pool.q1 else -2) - 1}


# ------------------------------------------------------------------ main

def summarize(rows):
    ok = [r for r in rows if r.get("status") in ("ok", "failed_exit")]
    if not ok:
        return {"n": 0}
    nets = [r["net_usd"] for r in ok]
    by_day = {}
    for r in ok:
        by_day.setdefault(r["day"], []).append(r["net_usd"])
    return {
        "n": len(ok), "unique_pools": len({r["pool_id"] for r in ok}),
        "unique_tokens": len({r["token"] for r in ok}),
        "profitable": sum(n > 0 for n in nets),
        "profitable_tokens": len({r["token"] for r in ok if r["net_usd"] > 0}),
        "mean_net_usd_per_100": round(statistics.mean(nets), 3),
        "median_net_usd_per_100": round(statistics.median(nets), 3),
        "mean_vs_hold_usd_per_100": round(statistics.mean(r["vs_hold_usd"] for r in ok), 3),
        "worst": round(min(nets), 3), "best": round(max(nets), 3),
        "failed_exits": sum(r["status"] == "failed_exit" for r in ok),
        "failed_entries": sum(r.get("status") == "failed_entry" for r in rows),
        "day_means": {d: round(statistics.mean(v), 3) for d, v in sorted(by_day.items())},
        "positive_days": sum(statistics.mean(v) > 0 for v in by_day.values()),
    }


def portfolio(hyp, k, decisions, outcome_fn):
    """Top-K, 3-day holds, token/initializer non-overlap, abstain when nothing qualifies."""
    held, ledger, nav = [], [], 0.0
    for d, cands in decisions:
        still = []
        for p in held:
            if p["exit_day_idx"] <= d[1]:
                nav += p["res"].get("net_usd", 0.0)
            else:
                still.append(p)
        held = still
        ranked = sorted((c for c in cands if c["flags"][hyp] is not None), key=lambda c: -c["flags"][hyp])
        entries = []
        for c in ranked:
            if len(held) >= k:
                break
            if any(c["token"] == p["token"] or (c["initializer"] and c["initializer"] == p["initializer"])
                   for p in held):
                continue
            res = outcome_fn(hyp, c["pool_id"], d[0], PILOT_USD / k)
            if res.get("status") == "failed_entry":
                entries.append({"pool_id": c["pool_id"], "status": "failed_entry"})
                continue
            p = {"pool_id": c["pool_id"], "token": c["token"], "initializer": c["initializer"],
                 "day": d[0], "exit_day_idx": d[1] + HOLD, "score": c["flags"][hyp], "res": res}
            held.append(p)
            entries.append(p)
        ledger.append({"day": d[0], "eligible": len(ranked), "entries": entries, "abstain": not entries})
    nav += sum(p["res"].get("net_usd", 0.0) for p in held)
    return ledger, nav


def main():
    load_cache()
    state = json.load(gzip.open(STATE, "rt", encoding="utf-8"))
    print("seeded cache entries", seed_cache_from_state(state), flush=True)
    meta = json.loads((LOGDIR / "meta.json").read_text())
    bounds = meta["day_bounds"]
    days = sorted(bounds)
    pools = {}
    for pid, m in meta["pools"].items():
        f = LOGDIR / f"{pid}.npy"
        if f.exists() and m["hooks"] == NATIVE and m["fee"] > 0:
            pools[pid] = Pool(pid, m, np.load(f))
    ref, eth = eth_usd(state, days)
    print("pools", len(pools), "ETH ref", ref[:10], {d: round(eth[d]) for d in (days[0], days[-1])}, flush=True)

    def initializer(pid):
        tx = pools[pid].meta.get("init_tx")
        return pid, (cached_call(f"from:{tx}", lambda: rpc("eth_getTransactionByHash", [tx])["from"].lower())
                     if tx else None)
    init_from = dict(pmap(initializer, list(pools)))
    save_cache()

    metrics = dict(zip(pools, pmap(lambda p: day_metrics(pools[p], state, days, bounds, eth), list(pools))))
    print("metrics done", flush=True)

    decisions = []
    for d in DECISION_DAYS + [PROSPECTIVE_DAY]:
        cands = candidates(pools, metrics, state, days, bounds, eth, init_from, d)
        quote_gate(pools, cands, bounds, d, eth)
        for c in cands:
            c["flags"] = flags(c, eth[d])
        decisions.append(((d, days.index(d)), cands))
        save_cache()
        print(d, "gate-pass", sum(c["ok"] for c in cands),
              {h: sum(c["flags"][h] is not None for c in cands) for h in ("H1", "H2", "H3", "H5", "H6")}, flush=True)

    scored = [x for x in decisions if x[0][0] != PROSPECTIVE_DAY]
    memo = {}

    def outcome_fn(hyp, pid, d, usd):
        kind = "bid" if hyp == "H3" else "maker" if hyp == "H5" else "lp"
        key = (pid, d, round(usd, 4), kind)
        if key not in memo:
            pool = pools[pid]
            memo[key] = (maker_outcome(pool, state, days, bounds, eth, d, usd) if kind == "maker"
                         else lp_outcome(pool, state, days, bounds, eth, d, usd, kind))
        return memo[key]

    hyps = ("H1", "H2", "H3", "H5", "H6")
    jobs = [(h, c["pool_id"], d[0]) for d, cands in scored for c in cands for h in hyps if c["flags"][h] is not None]
    # C0: top 5 per day by trailing 24h pool fee USD among gate-passing pools
    for d, cands in scored:
        for c in sorted((c for c in cands if c["flags"]["C0"] is not None), key=lambda c: -c["flags"]["C0"])[:5]:
            jobs.append(("C0", c["pool_id"], d[0]))
    print("candidate outcomes", len(jobs), flush=True)
    results = pmap(lambda j: outcome_fn(j[0], j[1], j[2], UNIT_USD), jobs)
    save_cache()
    hyp_rows = {h: [] for h in hyps + ("C0",)}
    cand_by = {(d[0], c["pool_id"]): c for d, cands in scored for c in cands}
    for (h, pid, d), r in zip(jobs, results):
        c = cand_by[(d, pid)]
        hyp_rows[h].append({"day": d, "pool_id": pid, "token": c["token"], "stratum": c["stratum"],
                            "score": c["flags"][h], **r})
    report = {h: summarize(rows) for h, rows in hyp_rows.items()}
    for h in ("H1",):
        report[h + "_by_stratum"] = {s: summarize([r for r in hyp_rows[h] if r["stratum"] == s])
                                     for s in ("major", "established", "young")}
    h5_post = [x for r in hyp_rows["H5"] for x in r.get("post_fill_24h_token_ret", [])]
    report["H5_post_fill_median_24h_token_ret"] = statistics.median(h5_post) if h5_post else None

    ports = {}
    for h in hyps + ("C0",):
        for k in (1, 2, 3):
            ledger, nav = portfolio(h, k, scored, outcome_fn)
            ents = [e for row in ledger for e in row["entries"] if "res" in e]
            ports[f"{h}_K{k}"] = {"net_usd_on_200": round(nav, 3), "positions": len(ents),
                                  "profitable": sum(e["res"].get("net_usd", 0) > 0 for e in ents),
                                  "unique_tokens": len({e["token"] for e in ents}),
                                  "abstain_days": sum(r["abstain"] for r in ledger),
                                  "worst_usd": round(min((e["res"].get("net_usd", 0) for e in ents), default=0), 3)}
    save_cache()

    # rejection census
    census = {}
    for d, cands in decisions:
        cnt = {}
        for c in cands:
            for r in (c["reasons"] or ["PASS all gates"]):
                key = r.split(" ")[0] if r != "PASS all gates" else r
                cnt[key] = cnt.get(key, 0) + 1
        census[d[0]] = cnt

    result = {"method": __doc__.strip(), "pools": len(pools), "eth_ref_pool": ref,
              "decision_days": DECISION_DAYS, "hypotheses": report, "portfolios": ports,
              "rejection_census": census}
    OUT.write_text(json.dumps(result, indent=1, default=str))
    with gzip.open(LEDGER, "wt", encoding="utf-8") as fh:
        json.dump({"decisions": [{"day": d[0], "block": bounds[d[0]], "candidates": c} for d, c in decisions],
                   "outcomes": hyp_rows}, fh, default=str)
    prosp = [c for d, cands in decisions if d[0] == PROSPECTIVE_DAY for c in cands
             if any(v is not None for k, v in c["flags"].items() if k != "C0")]
    blob = json.dumps({"decision_block": bounds[PROSPECTIVE_DAY], "rule_sha256_file": "huntx_edge_prereg.sha256",
                       "selected": prosp}, default=str, sort_keys=True)
    PROSPECTIVE.write_text(json.dumps({"sha256": hashlib.sha256(blob.encode()).hexdigest(),
                                       "frozen": json.loads(blob)}, indent=1))
    print(json.dumps({"hypotheses": {h: {k: v for k, v in r.items() if k in ("n", "unique_tokens", "profitable",
                                                                             "mean_net_usd_per_100",
                                                                             "median_net_usd_per_100",
                                                                             "mean_vs_hold_usd_per_100", "worst",
                                                                             "positive_days", "failed_exits")}
                                     for h, r in report.items() if isinstance(r, dict) and "n" in r},
                      "portfolios": ports, "h5_post_fill": report["H5_post_fill_median_24h_token_ret"]},
                     indent=1, default=str))


if __name__ == "__main__":
    main()
