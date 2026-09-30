"""Causal clone of the RAPTOR-X-style breadth fee harvester (Amendment A5).

Decisions 2026-09-15..09-24 at 00:00 UTC (test half only), 5-day units,
centered +/-15%, daily re-centering when out of range for the whole prior day,
daily fee sweeps, exact V4Quoter costs for entry, rebalancing and exit.
Only data strictly before each decision block feeds the entry decision.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import random
import statistics
from pathlib import Path

import numpy as np

import huntx_edge_slice_study as S
from huntx_edge_engine import amounts, load_cache, quote_exact_in, save_cache, snap_range, value_in_quote
from huntx_edge_oos_study import make_proto

ROOT = Path(__file__).parent
DIRS = ["huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap", "huntx_edge_logs_gap2"]
OUT = ROOT / "huntx_harvester_clone_results.json"
LEDGER = ROOT / "huntx_harvester_clone_ledger.json.gz"
DECISIONS = [f"2026-09-{d:02d}" for d in range(15, 25)]
HORIZON = 5
RANGE = (1 / 1.15, 1.15)
TVL_BAND = 1.5
MIN_FEES_USD, MIN_VOL_USD = 75.0, 7_500.0
MIN_FEE_TVL, MIN_VOL_TVL = 0.006, 0.25
MAX_DD_24H = 0.35
MAX_ENTRY_IMPACT, MAX_EXIT_IMPACT = 0.025, 0.04
GAS_TX_USD = 0.27
UNIT_USD = 100.0
SANE_TICK = 700_000


def load_pools():
    metas, parts = {}, {}
    for d in DIRS:
        mf = ROOT / d / "meta.json"
        if not mf.exists():
            continue
        for pid, m in json.loads(mf.read_text())["pools"].items():
            f = ROOT / d / f"{pid}.npy"
            if f.exists():
                metas.setdefault(pid, m)
                parts.setdefault(pid, []).append(np.load(f))
    pools = {}
    for pid, arrs in parts.items():
        m = metas[pid]
        if m["hooks"] != S.NATIVE or m["fee"] == 0:
            continue
        a = np.concatenate(arrs)
        _, first = np.unique(a[:, 0] * 1e6 + a[:, 1], return_index=True)
        a = a[np.sort(first)]
        a = a[np.lexsort((a[:, 1], a[:, 0]))]
        pools[pid] = S.Pool(pid, m, a)
    return pools


def usd(pool, eth, raw):
    return raw / 1e6 if pool.quote == S.USDG else raw / 1e18 * eth


def raw_of(pool, eth, dollars):
    return dollars * 1e6 if pool.quote == S.USDG else dollars / eth * 1e18


def price_q(pool, s):
    """quote per token (raw)."""
    return s * s if pool.q1 else 1 / (s * s)


def trailing(pool, a, b, s_end, proto0, proto1, eth):
    i0, i1 = pool.idx(a), pool.idx(b)
    a0, a1, fee, liq = pool.a0[i0:i1], pool.a1[i0:i1], pool.fee[i0:i1], pool.liq[i0:i1]
    zin = a0 < 0
    gross = np.where(zin, -a0, -a1)
    lp = np.where(gross > 0, gross * np.maximum(fee - np.where(zin, proto0, proto1), 0) / 1e6, 0.0)
    f0, f1 = float(lp[zin].sum()), float(lp[~zin].sum())
    fees = usd(pool, eth, value_in_quote(f0, f1, s_end, pool.q1))
    vol = usd(pool, eth, float(np.abs(pool.qamt[i0:i1]).sum()))
    return fees, vol, i1 - i0


def tvl_proxy(pool, s, L, eth):
    sa, sb = s / math.sqrt(TVL_BAND), s * math.sqrt(TVL_BAND)
    x, y = amounts(L, s, sa, sb)
    return usd(pool, eth, value_in_quote(x, y, s, pool.q1))


def impact(pool, s, amount_in, out, selling_token):
    """Price impact excluding the pool fee, vs mid s."""
    fee = pool.meta["fee"] / 1e6
    p = price_q(pool, s)
    fair = amount_in * p if selling_token else amount_in / p
    return 1 - out / (fair * (1 - fee)) if fair > 0 else 1.0


def centered(pool, s, V):
    sa, sb, _, _ = snap_range(s, RANGE[0], RANGE[1], pool.spacing, pool.q1)
    u0, u1 = amounts(1.0, s, sa, sb)
    uval = value_in_quote(u0, u1, s, pool.q1)
    tok_u, q_u = (u0, u1) if pool.q1 else (u1, u0)
    return sa, sb, uval, tok_u, q_u, (uval - q_u) / uval


def run_unit(pool, state, days, bounds, eth, proto, d, dollars):
    """One harvester unit: enter at d, manage daily, exit after HORIZON days."""
    di = days.index(d)
    A = bounds[d]
    s = pool.sqrt_before(A)
    V = raw_of(pool, eth[d], dollars)
    sa, sb, uval, tok_u, q_u, phi = centered(pool, s, V)
    swap_in = int(V * phi)
    got = quote_exact_in(pool.meta, not pool.q1, swap_in, A - 1) if swap_in > 0 else 0
    if got is None:
        return {"status": "failed_entry"}
    tok, q = float(got), V - swap_in
    L = min(tok / tok_u if tok_u > 0 else math.inf, q / q_u if q_u > 0 else math.inf)
    tok_idle, q_idle = tok - L * tok_u, q - L * q_u
    fees_usd, gas_usd, reranges, rerange_cost_usd = 0.0, 2 * GAS_TX_USD, 0, 0.0
    for j in range(HORIZON):
        a, b = bounds[days[di + j]], bounds[days[di + j + 1]]
        p0, p1 = proto(state, pool.pid, days[di + j])
        f0, f1, g0, g1 = pool.fees(a, b, sa, sb, L, p0, p1, pool.sqrt_before(a) or s)
        r0, r1 = S.calib(state, pool, days[di + j], days[di + j + 1], g0, g1)
        f0, f1 = f0 * S.use_ratio(r0), f1 * S.use_ratio(r1)
        s_end = pool.sqrt_before(b) or s
        ft, fq = (f0, f1) if pool.q1 else (f1, f0)
        # daily sweep: quote fees kept, token fees sold at mid minus the pool fee
        i_b = pool.idx(b)
        sane = i_b == 0 or abs(pool.tick[i_b - 1]) < SANE_TICK
        # token fees at a degenerate (drained) price are unsellable: value them at 0
        fees_usd += usd(pool, eth[days[di + j + 1]],
                        fq + (ft * price_q(pool, s_end) * (1 - pool.meta["fee"] / 1e6) if sane else 0.0))
        if j == HORIZON - 1:
            break
        # out of range for the whole day?  (every swap and the boundary price outside [sa, sb])
        i0, i1 = pool.idx(a), pool.idx(b)
        path = pool.sq[i0:i1]
        whole_day_out = len(path) > 0 and (np.all(path < sa) or np.all(path > sb))
        tick_now = pool.tick[i1 - 1] if i1 > 0 else 0
        if whole_day_out and abs(tick_now) < SANE_TICK:           # never rebalance at a degenerate price
            x, y = amounts(L, s_end, sa, sb)
            t_have, q_have = ((x, y) if pool.q1 else (y, x))
            t_have += tok_idle
            q_have += q_idle
            nsa, nsb, nuval, ntok_u, nq_u, nphi = centered(pool, s_end, 1.0)
            total_q = q_have + t_have * price_q(pool, s_end)
            target_tok_val = total_q * nphi
            blk = b - 1
            if t_have * price_q(pool, s_end) > target_tok_val:          # sell surplus token
                sell = int(min(t_have, t_have - target_tok_val / price_q(pool, s_end)))
                out = quote_exact_in(pool.meta, pool.q1, sell, blk) if sell > 0 else 0
                if out is None:
                    continue                                              # cannot rebalance: stay
                rerange_cost_usd += usd(pool, eth[days[di + j + 1]], sell * price_q(pool, s_end) - out)
                t_have -= sell
                q_have += out
            else:                                                         # buy token with surplus quote
                spend = int(min(q_have, q_have - (total_q - target_tok_val)))
                out = quote_exact_in(pool.meta, not pool.q1, spend, blk) if spend > 0 else 0
                if out is None:
                    continue
                rerange_cost_usd += usd(pool, eth[days[di + j + 1]], spend - out * price_q(pool, s_end))
                q_have -= spend
                t_have += out
            sa, sb, tok_u, q_u = nsa, nsb, ntok_u, nq_u
            L = min(t_have / tok_u if tok_u > 0 else math.inf, q_have / q_u if q_u > 0 else math.inf)
            tok_idle, q_idle = t_have - L * tok_u, q_have - L * q_u
            reranges += 1
            gas_usd += 2 * GAS_TX_USD
    B = bounds[days[di + HORIZON]]
    se = pool.sqrt_before(B) or s
    x, y = amounts(L, se, sa, sb)
    t_end, q_end = ((x, y) if pool.q1 else (y, x))
    t_end += tok_idle
    q_end += q_idle
    t_sell = int(min(t_end, 2**128 - 1))
    out = quote_exact_in(pool.meta, pool.q1, t_sell, B - 1) if t_sell >= 1 else 0
    gas_usd += 2 * GAS_TX_USD
    eth_x = eth[days[di + HORIZON]]
    exec_val = usd(pool, eth_x, q_end + (out or 0))
    i_end = pool.idx(B)
    degenerate_exit = i_end > 0 and abs(pool.tick[i_end - 1]) >= SANE_TICK
    # at a degenerate (drained) price the mid is meaningless: use the executable value
    mid_val = exec_val if degenerate_exit else usd(pool, eth_x, q_end + t_end * price_q(pool, se))
    return {"status": "failed_exit" if out is None else "ok",
            "net_exec_usd": exec_val + fees_usd - gas_usd - dollars,
            "net_mid_usd": mid_val + fees_usd - gas_usd - dollars,
            "fees_usd": fees_usd, "gas_usd": gas_usd, "reranges": reranges, "degenerate_exit": bool(degenerate_exit),
            "rerange_cost_usd": rerange_cost_usd,
            "token_ret": price_q(pool, se) / price_q(pool, s) - 1}


def candidates(pools, state, days, bounds, eth, proto, d):
    di = days.index(d)
    A, A1 = bounds[d], bounds[days[di - 1]]
    rows = []
    for pid, pool in pools.items():
        c = {"pool_id": pid, "token": pool.token, "quote": pool.quote, "fee": pool.meta["fee"], "reasons": []}
        s = pool.sqrt_before(A)
        i = pool.idx(A)
        if s is None or i == 0:
            c["reasons"].append("no price")
            rows.append(c)
            continue
        if abs(pool.tick[i - 1]) >= SANE_TICK:
            c["reasons"].append("degenerate price")
        if pool.meta["init_block"] >= bounds[days[di - 3]]:
            c["reasons"].append("age < 3d")
        p0, p1 = proto(state, pid, days[di - 1])
        fees, vol, nsw = trailing(pool, A1, A, s, p0, p1, eth[d])
        L = pool.liq_before(A) or 0.0
        tvl = tvl_proxy(pool, s, L, eth[d]) if L > 0 else 0.0
        s_prev = pool.sqrt_before(A1)
        dd = (price_q(pool, s) / price_q(pool, s_prev) - 1) if s_prev else 0.0
        c.update(fees_24h=fees, vol_24h=vol, swaps_24h=nsw, tvl_proxy=tvl,
                 fee_tvl=fees / tvl if tvl > 0 else 0.0, vol_tvl=vol / tvl if tvl > 0 else 0.0, chg_24h=dd)
        if fees < MIN_FEES_USD:
            c["reasons"].append("fees_24h < $75")
        if vol < MIN_VOL_USD:
            c["reasons"].append("volume_24h < $7.5k")
        if c["fee_tvl"] < MIN_FEE_TVL:
            c["reasons"].append("fees/TVL < 0.6%")
        if c["vol_tvl"] < MIN_VOL_TVL:
            c["reasons"].append("vol/TVL < 0.25")
        if dd < -MAX_DD_24H:
            c["reasons"].append("24h drawdown > 35%")
        rows.append(c)
    # quote gates only for pools passing the cheap filters
    todo = [c for c in rows if not c["reasons"]]

    def gate(c):
        pool = pools[c["pool_id"]]
        s = pool.sqrt_before(A)
        V = raw_of(pool, eth[d], UNIT_USD)
        *_, phi = centered(pool, s, V)
        swap_in = int(V * phi)
        got = quote_exact_in(pool.meta, not pool.q1, swap_in, A - 1)
        if not got:
            return "entry quote failed"
        if impact(pool, s, swap_in, got, False) > MAX_ENTRY_IMPACT:
            return "entry impact > 2.5%"
        back = quote_exact_in(pool.meta, pool.q1, got, A - 1)
        if not back:
            return "exit quote failed"
        if impact(pool, s, got, back, True) > MAX_EXIT_IMPACT:
            return "exit impact > 4%"
        return None
    for c, r in zip(todo, S.pmap(gate, todo, workers=6)):
        if r:
            c["reasons"].append(r)
    for c in rows:
        c["eligible"] = not c["reasons"]
    return rows


def main():
    load_cache()
    state = json.load(gzip.open(S.STATE, "rt", encoding="utf-8"))
    S.seed_cache_from_state(state)
    screen = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())
    bounds = {d: b for d, b in screen["day_bounds"].items() if "2026-09-01" <= d <= "2026-09-30"}
    days = sorted(bounds)
    pools = load_pools()
    ref = next(p for pid, p in pools.items() if pid.startswith("0x24107d152f"))
    eth = {d: price_q(ref, ref.sqrt_before(bounds[d]) or S.state_sqrt(state, ref.pid, d)) * 1e12 for d in days}
    proto = make_proto(state, bounds)
    S.proto = proto
    print("pools", len(pools), flush=True)
    decisions = []
    for d in DECISIONS:
        rows = candidates(pools, state, days, bounds, eth, proto, d)
        decisions.append((d, rows))
        save_cache()
        print(d, "eligible", sum(c["eligible"] for c in rows), flush=True)
    jobs = [(c["pool_id"], d) for d, rows in decisions for c in rows if c["eligible"]]
    print("units to score", len(jobs), flush=True)
    res = S.pmap(lambda j: run_unit(pools[j[0]], state, days, bounds, eth, proto, j[1], UNIT_USD), jobs, workers=6)
    save_cache()
    by = {j: r for j, r in zip(jobs, res)}
    units = []
    for d, rows in decisions:
        for c in rows:
            if c["eligible"]:
                units.append({"day": d, **{k: c[k] for k in ("pool_id", "token", "fee", "fee_tvl")},
                              **by[(c["pool_id"], d)]})
    ok = [u for u in units if u.get("status") in ("ok", "failed_exit")]

    def boot(key):
        byd = {}
        for u in ok:
            byd.setdefault(u["day"], []).append(u[key])
        ks = sorted(byd)
        rng = random.Random(3)
        m = sorted(statistics.mean([v for k in [rng.choice(ks) for _ in ks] for v in byd[k]]) for _ in range(4000))
        return {"p05": round(m[200], 3), "p50": round(m[2000], 3), "p95": round(m[3800], 3)}
    tok = {}
    for u in ok:
        tok.setdefault(u["token"], []).append(u["net_exec_usd"])
    summary = {
        "units": len(ok), "failed_entries": sum(u.get("status") == "failed_entry" for u in units),
        "failed_exits": sum(u["status"] == "failed_exit" for u in ok),
        "tokens": len(tok), "profitable_tokens": sum(statistics.mean(v) > 0 for v in tok.values()),
        "mean_net_exec_per_100": round(statistics.mean(u["net_exec_usd"] for u in ok), 3) if ok else None,
        "median_net_exec_per_100": round(statistics.median(u["net_exec_usd"] for u in ok), 3) if ok else None,
        "mean_net_mid_per_100": round(statistics.mean(u["net_mid_usd"] for u in ok), 3) if ok else None,
        "mean_fees": round(statistics.mean(u["fees_usd"] for u in ok), 3) if ok else None,
        "mean_rerange_cost": round(statistics.mean(u["rerange_cost_usd"] for u in ok), 3) if ok else None,
        "mean_reranges": round(statistics.mean(u["reranges"] for u in ok), 3) if ok else None,
        "boot_net_exec": boot("net_exec_usd") if ok else None,
        "day_means": {d: round(statistics.mean(u["net_exec_usd"] for u in ok if u["day"] == d), 3)
                      for d in DECISIONS if any(u["day"] == d for u in ok)},
    }
    # $200 portfolios: K slots, 5-day units, one per token, rank by fee/TVL
    ports = {}
    for K in (1, 2, 3):
        held, nav, pos = [], 0.0, []
        for d, rows in decisions:
            di = days.index(d)
            for p in [p for p in held if p["exit_idx"] <= di]:
                nav += p["res"].get("net_exec_usd", 0.0)
            held = [p for p in held if p["exit_idx"] > di]
            for c in sorted((c for c in rows if c["eligible"]), key=lambda c: -c["fee_tvl"]):
                if len(held) >= K:
                    break
                if any(p["token"] == c["token"] for p in held):
                    continue
                r = run_unit(pools[c["pool_id"]], state, days, bounds, eth, proto, d, 200.0 / K)
                if r.get("status") == "failed_entry":
                    continue
                p = {"token": c["token"], "pool_id": c["pool_id"], "day": d, "exit_idx": di + HORIZON, "res": r}
                held.append(p)
                pos.append(p)
        nav += sum(p["res"].get("net_exec_usd", 0.0) for p in held)
        ports[f"K{K}"] = {"net_exec_usd_on_200": round(nav, 3), "positions": len(pos),
                          "profitable": sum(p["res"].get("net_exec_usd", 0) > 0 for p in pos),
                          "tokens": len({p["token"] for p in pos})}
    save_cache()
    census = {d: {} for d, _ in decisions}
    for d, rows in decisions:
        for c in rows:
            for r in c["reasons"] or ["ELIGIBLE"]:
                census[d][r.split(" <")[0].split(" >")[0]] = census[d].get(r.split(" <")[0].split(" >")[0], 0) + 1
    OUT.write_text(json.dumps({"method": __doc__.strip(), "summary": summary, "portfolios": ports,
                               "rejection_census": census}, indent=1, default=str))
    with gzip.open(LEDGER, "wt") as fh:
        json.dump({"decisions": [{"day": d, "rows": rows} for d, rows in decisions], "units": units}, fh, default=str)
    print(json.dumps({"summary": summary, "portfolios": ports}, indent=1, default=str))


if __name__ == "__main__":
    main()
