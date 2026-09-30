"""HUNTX multi-position LP edge study (pre-registered; read-only).

Pipeline: panel swaps -> per pool-day unit metrics (calibrated to on-chain fee
growth) -> daily decision-time gates/features -> hypothesis eligibility ->
exact-quote outcomes (V4Quoter at the entry and exit archive blocks) -> top-K
portfolios with non-overlap -> fold/bootstrap report + full decision ledger.

See docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md. Thresholds below are the
frozen pre-registered values; do not tune them on outcomes.
"""

from __future__ import annotations

import gzip
import json
import math
import random
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from feex_next_day_check import rpc
from huntx_edge_engine import (NATIVE, USDG, WETH, PoolSeries, amounts, calibration, cached_call,
                               fee_growth, load_cache, quote_exact_in, save_cache, slot0, snap_range,
                               value_in_quote)

ROOT = Path(__file__).parent
PANEL = ROOT / "huntx_edge_panel_swaps.json.gz"
OUT = ROOT / "huntx_edge_study_results.json"
LEDGER = ROOT / "huntx_edge_decision_ledger.json.gz"

# ---- frozen pre-registered parameters
PILOT_USD = 200.0
HOLD_DAYS = 3
UNIT_USD = 100.0
TOKEN_RANGE = (1 / 1.25, 1.25)
MAJOR_RANGE = (1 / 1.05, 1.05)
BID_RANGE = (0.90, 0.99)
MIN_AGE_DAYS = 3
G3_BAND = (0.85, 1.15)
G6_MIN_SWAPS = 20
G7_MAX_SHARE = 0.25
G5_EXTRA = 0.01
H2_SPIKE = 2.0
H2_MAX_LIQ_GROWTH = 1.5
H3_MAX_IMBALANCE = 0.20
GAS_TX_ETH_P90 = 1.982e-05   # measured: p90 of 60 real POSM txs (huntx_edge_gas note in report)
TX_PER_ROUND_TRIP = 4
DEV = ("2026-08-25", "2026-09-07")
FOLDS = {"F1": ("2026-09-08", "2026-09-14"), "F2": ("2026-09-15", "2026-09-21"),
         "F3": ("2026-09-22", "2026-09-26")}
LAST_DECISION = "2026-09-26"


def pmap(fn, items, workers=8):
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(fn, items))


def load_panel():
    payload = json.load(gzip.open(PANEL, "rt", encoding="utf-8"))
    bounds = payload["day_bounds"]
    days = sorted(bounds)
    series = {pid: PoolSeries(pid, meta, payload["swaps"][pid]) for pid, meta in payload["pools"].items()}
    return days, [bounds[d] for d in days], series


def eth_usd_series(series, blocks):
    """ETH price in USDG at each boundary from the most active WETH|ETH / USDG pool."""
    cands = [s for s in series.values() if s.quote == USDG and s.token in (WETH, NATIVE)]
    if not cands:
        raise RuntimeError("no ETH/USDG pool in panel")
    ref = max(cands, key=lambda s: len(s.rows))
    out = []
    for b in blocks:
        sq = ref.sqrt_before(b)
        p = sq * sq if ref.quote_is_1 else 1 / (sq * sq)       # quote raw per token raw
        out.append(p * 1e18 / 1e6)                                # USDG per ETH
    return ref.pool_id, out


def unit_value_raw(s: PoolSeries, eth_usd: float, usd: float) -> float:
    return usd * 1e6 if s.quote == USDG else usd / eth_usd * 1e18


def range_for(s: PoolSeries, kind: str):
    if kind == "bid":
        return BID_RANGE
    return MAJOR_RANGE if s.major_pair else TOKEN_RANGE


def open_position(s: PoolSeries, sq: float, value_raw: float, kind: str):
    """Liquidity + unit amounts for a position worth value_raw (quote raw) at sqrt sq."""
    lo, hi = range_for(s, kind)
    sa, sb, ta, tb = snap_range(sq, lo, hi, s.meta["tick_spacing"], s.quote_is_1)
    u0, u1 = amounts(1.0, sq, sa, sb)
    uval = value_in_quote(u0, u1, sq, s.quote_is_1)
    if not (uval > 0 and math.isfinite(uval)):
        return None
    tok_unit = u0 if s.quote_is_1 else u1
    q_unit = u1 if s.quote_is_1 else u0
    tok_val_unit = uval - q_unit
    return {"sa": sa, "sb": sb, "ta": ta, "tb": tb, "uval": uval, "tok_unit": tok_unit,
            "q_unit": q_unit, "phi": tok_val_unit / uval}


def split(s: PoolSeries, a0: float, a1: float):
    """(token, quote) from (amount0, amount1)."""
    return (a0, a1) if s.quote_is_1 else (a1, a0)


# ------------------------------------------------------------- day metrics

def day_metrics(s: PoolSeries, day_blocks, eth_usd):
    """Unit ($100) daily re-centred position metrics per UTC day (mid prices)."""
    rows = []
    for j in range(len(day_blocks) - 1):
        a, b = day_blocks[j], day_blocks[j + 1]
        sq0, sq1 = s.sqrt_before(a), s.sqrt_before(b)
        win = s.window(a, b)
        rec = {"day": j, "swaps": len(win)}
        vol = buy = 0.0
        largest = 0.0
        for r in win:
            q = r[3] if s.quote_is_1 else r[2]
            vol += abs(q)
            largest = max(largest, abs(q))
            if q < 0:
                buy += -q          # quote paid in by caller = token buyer
        rec.update(quote_vol=vol / 10**s.quote_decimals, buy_vol=buy / 10**s.quote_decimals,
                   largest=largest / 10**s.quote_decimals, liq_open=s.liq_before(a))
        if sq0 is None or sq1 is None:
            rows.append(rec)
            continue
        s0 = slot0(s.pool_id, a - 1)
        v = unit_value_raw(s, eth_usd[j], UNIT_USD)
        pos = open_position(s, sq0, v, "lp")
        rec.update(price_open=sq0 * sq0, price_close=sq1 * sq1, lp_fee=s0["lp_fee"])
        if pos is None:
            rows.append(rec)
            continue
        liq = v / pos["uval"]
        f0, f1, g0, g1 = s.fee_accrual(a, b, pos["sa"], pos["sb"], liq, s0["proto0"], s0["proto1"], sq0)
        r0, r1, d0, d1 = calibration(s, a, b, g0, g1)
        c0 = r0 if r0 is not None and 0.5 <= r0 <= 2 else min(r0 or 1.0, 1.0)
        c1 = r1 if r1 is not None and 0.5 <= r1 <= 2 else min(r1 or 1.0, 1.0)
        fee_val = value_in_quote(f0 * c0, f1 * c1, sq1, s.quote_is_1)
        e0, e1 = amounts(liq, sq1, pos["sa"], pos["sb"])
        i0, i1 = amounts(liq, sq0, pos["sa"], pos["sb"])
        lp_end = value_in_quote(e0, e1, sq1, s.quote_is_1)
        hold_end = value_in_quote(i0, i1, sq1, s.quote_is_1)
        rec.update(fee_yield=fee_val / v, excess=(fee_val + lp_end - hold_end) / v,
                   lp_ret=(fee_val + lp_end - v) / v, cal0=r0, cal1=r1,
                   ev_g=[g0, g1], chain_g=[d0, d1])
        rows.append(rec)
    return rows


# ------------------------------------------------------------- outcomes

def quote_dir_token_to_quote(s: PoolSeries) -> bool:
    """zeroForOne flag when selling token for quote."""
    return s.quote_is_1


def gas_quote_raw(s: PoolSeries, eth_usd: float, txs: int) -> float:
    eth = GAS_TX_ETH_P90 * txs
    return eth * eth_usd * 1e6 if s.quote == USDG else eth * 1e18


def roundtrip_gate(s: PoolSeries, sq: float, value_raw: float, block: int, kind: str):
    """G4/G5 at decision block-1: entry swap and its immediate reverse at exact size."""
    pos = open_position(s, sq, value_raw, "lp" if kind != "bid" else "lp")
    swap_in = int(value_raw * pos["phi"]) if kind != "bid" else int(value_raw * 0.5)
    got = quote_exact_in(s.meta, not s.quote_is_1, swap_in, block - 1)
    if not got:
        return {"ok": False, "reason": "G4 entry quote failed"}
    back = quote_exact_in(s.meta, s.quote_is_1, got, block - 1)
    if not back:
        return {"ok": False, "reason": "G4 reverse quote failed"}
    loss = (swap_in - back) / swap_in
    limit = 2 * s.meta["fee"] / 1e6 + G5_EXTRA if s.meta["fee"] < 1_000_000 else 0
    if loss > limit:
        return {"ok": False, "reason": f"G5 round-trip loss {loss:.4f} > {limit:.4f}", "rt_loss": loss}
    return {"ok": True, "rt_loss": loss, "rt_cost_frac": loss * swap_in / value_raw}


def outcome(s: PoolSeries, entry_block: int, exit_block: int, value_raw: float, kind: str,
            eth_entry: float, eth_exit: float):
    sq = s.sqrt_before(entry_block)
    pos = open_position(s, sq, value_raw, kind)
    res = {"kind": kind}
    if kind == "bid":
        tokens_out, q_left0 = 0.0, value_raw
        liq = value_raw / pos["uval"]
        tok_left, q_left = 0.0, value_raw - liq * pos["q_unit"]
    else:
        swap_in = int(value_raw * pos["phi"])
        got = quote_exact_in(s.meta, not s.quote_is_1, swap_in, entry_block - 1)
        if not got:
            return {**res, "status": "failed_entry"}
        tokens_out, q_left0 = float(got), value_raw - swap_in
        liq = min(tokens_out / pos["tok_unit"] if pos["tok_unit"] > 0 else math.inf,
                  q_left0 / pos["q_unit"] if pos["q_unit"] > 0 else math.inf)
        tok_left = tokens_out - liq * pos["tok_unit"]
        q_left = q_left0 - liq * pos["q_unit"]
    s0 = slot0(s.pool_id, entry_block - 1)
    f0, f1, g0, g1 = s.fee_accrual(entry_block, exit_block, pos["sa"], pos["sb"], liq,
                                   s0["proto0"], s0["proto1"], sq)
    r0, r1, _, _ = calibration(s, entry_block, exit_block, g0, g1)
    c0 = r0 if r0 is not None and 0.5 <= r0 <= 2 else min(r0 or 1.0, 1.0)
    c1 = r1 if r1 is not None and 0.5 <= r1 <= 2 else min(r1 or 1.0, 1.0)
    sq_e = s.sqrt_before(exit_block)
    e0, e1 = amounts(liq, sq_e, pos["sa"], pos["sb"])
    lp_tok, lp_q = split(s, e0, e1)
    fee_tok, fee_q = split(s, f0 * c0, f1 * c1)
    tok_total = int(lp_tok + fee_tok + tok_left)
    out = quote_exact_in(s.meta, s.quote_is_1, tok_total, exit_block - 1) if tok_total > 0 else 0
    failed_exit = out is None
    gas = gas_quote_raw(s, eth_exit, TX_PER_ROUND_TRIP)
    proceeds = lp_q + fee_q + q_left + (0 if failed_exit else out) - gas
    hold_out = quote_exact_in(s.meta, s.quote_is_1, int(tokens_out), exit_block - 1) if tokens_out > 0 else 0
    hold_proceeds = q_left0 + (hold_out or 0) - gas_quote_raw(s, eth_exit, 2 if tokens_out > 0 else 0)
    fee_val_mid = value_in_quote(*((f0 * c0, f1 * c1)), sq_e, s.quote_is_1)
    scale = 10**s.quote_decimals
    to_usd = (lambda x: x / scale) if s.quote == USDG else (lambda x: x / scale * eth_exit)
    return {**res, "status": "failed_exit" if failed_exit else "ok",
            "value_usd": to_usd(value_raw), "net_usd": to_usd(proceeds - value_raw),
            "net_frac": (proceeds - value_raw) / value_raw,
            "vs_hold_usd": to_usd(proceeds - hold_proceeds),
            "hold_net_usd": to_usd(hold_proceeds - value_raw),
            "fees_usd": to_usd(fee_val_mid), "gas_usd": to_usd(gas),
            "cal": [r0, r1], "in_range_exit": pos["sa"] <= sq_e <= pos["sb"],
            "price_change": (sq_e / sq) ** (2 if s.quote_is_1 else -2) - 1}


# ------------------------------------------------------------- decisions

def stratum(s: PoolSeries, age_days: float) -> str:
    if s.major_pair:
        return "major"
    return "established" if age_days >= 7 else "young"


def build_candidates(days, blocks, series, metrics, eth_usd, init_from, d_idx):
    """All pools at decision day index d_idx: gates, features, hypothesis flags."""
    block = blocks[d_idx]
    out = []
    for pid, s in series.items():
        m = metrics[pid]
        c = {"pool_id": pid, "token": s.token, "quote": s.quote, "fee": s.meta["fee"],
             "hooks": s.meta["hooks"], "initializer": init_from.get(pid)}
        age = (block - s.meta["init_block"]) / max(1, (blocks[d_idx] - blocks[d_idx - 1]))
        c["age_days"] = round(age, 2)
        c["stratum"] = stratum(s, age)
        reasons = []
        if s.meta["init_block"] >= blocks[d_idx - MIN_AGE_DAYS]:
            reasons.append("G1 age < 3d")
        if s.meta["hooks"] != NATIVE:
            reasons.append("G2 hooked pool: UNVERIFIED")
        trail = [m[j] for j in range(d_idx - 3, d_idx) if j >= 0]
        if s.sqrt_before(block) is None or len(trail) < 3 or any("excess" not in t for t in trail):
            reasons.append("no trailing 3d price/metrics")
            c.update(eligible_gates=False, reasons=reasons)
            out.append(c)
            continue
        ev = [sum(t["ev_g"][k] for t in trail) for k in (0, 1)]
        ch = [sum(t["chain_g"][k] for t in trail) for k in (0, 1)]
        ratios = [ch[k] / ev[k] if ev[k] > 0 else (None if ch[k] > 0 else 1.0) for k in (0, 1)]
        c["g3_ratios"] = ratios
        if any(r is None or not (G3_BAND[0] <= r <= G3_BAND[1]) for r in ratios):
            reasons.append("G3 fee accounting mismatch: UNVERIFIED")
        swaps = [t["swaps"] for t in trail]
        c["trail_swaps"] = swaps
        if min(swaps) < G6_MIN_SWAPS:
            reasons.append("G6 < 20 swaps on a trailing day")
        vol3 = sum(t["quote_vol"] for t in trail)
        largest = max(t["largest"] for t in trail)
        c["largest_share"] = largest / vol3 if vol3 else None
        if not vol3 or largest / vol3 > G7_MAX_SHARE:
            reasons.append("G7 single swap > 25% of 3d volume")
        excess = [t["excess"] for t in trail]
        c["trail_excess"] = excess
        c["trail_fee_yield"] = [t["fee_yield"] for t in trail]
        buy = sum(t["buy_vol"] for t in trail)
        c["imbalance"] = abs(2 * buy - vol3) / vol3 if vol3 else None
        prior = [m[j] for j in range(d_idx - 8, d_idx - 1) if j >= 0 and "fee_yield" in m[j]]
        c["h2_base"] = statistics.median([t["fee_yield"] for t in prior]) if len(prior) >= 5 else None
        p7 = m[d_idx - 7].get("price_open") if d_idx >= 7 else None
        pnow = trail[-1]["price_close"]
        if p7:
            drift = math.log(pnow / p7)
            c["drift7"] = drift if s.quote_is_1 else -drift
        liq_now, liq_3 = s.liq_before(block), m[d_idx - 3].get("liq_open")
        c["liq_growth3"] = liq_now / liq_3 if liq_now and liq_3 else None
        usd = (lambda x: x) if s.quote == USDG else (lambda x: x * eth_usd[d_idx])
        c["fee_usd_24h"] = usd(trail[-1]["quote_vol"]) * s.meta["fee"] / 1e6
        c["eligible_gates"] = not reasons
        c["reasons"] = reasons
        out.append(c)
    return out


def apply_quote_gates(series, cands, blocks, d_idx, eth_usd, value_usd):
    """G4/G5 (exact quotes) only for pools that already pass the cheap gates."""
    todo = [c for c in cands if c["eligible_gates"]]

    def run(c):
        s = series[c["pool_id"]]
        sq = s.sqrt_before(blocks[d_idx])
        return roundtrip_gate(s, sq, unit_value_raw(s, eth_usd[d_idx], value_usd), blocks[d_idx], "lp")
    for c, g in zip(todo, pmap(run, todo)):
        c[f"quote_gate_{int(value_usd)}"] = g
        if not g["ok"]:
            c["reasons"].append(g["reason"])
            c["eligible_gates"] = False
        else:
            c["rt_cost_frac"] = g["rt_cost_frac"]


def gas_frac(c, eth):
    return GAS_TX_ETH_P90 * TX_PER_ROUND_TRIP * eth / UNIT_USD


def hypothesis_flags(c, eth):
    """Return {hyp: score or None}. Pure function of decision-time features."""
    flags = {}
    if not c.get("eligible_gates"):
        return {h: None for h in ("H1", "H2", "H3", "C0")}
    ex = c["trail_excess"]
    h1 = HOLD_DAYS * statistics.mean(ex) - c["rt_cost_frac"] - gas_frac(c, eth)
    persistent = all(e > 0 for e in ex)
    flags["H1"] = h1 if persistent and h1 > 0 else None
    y1 = c["trail_fee_yield"][-1]
    base = c.get("h2_base")
    lg = c.get("liq_growth3")
    h2 = y1 - c["rt_cost_frac"]
    flags["H2"] = h2 if (base and y1 >= H2_SPIKE * base and lg is not None
                         and lg <= H2_MAX_LIQ_GROWTH and h2 > 0) else None
    flags["H3"] = h1 if (persistent and h1 > 0 and c.get("imbalance") is not None
                         and c["imbalance"] <= H3_MAX_IMBALANCE and c.get("drift7") is not None
                         and c["drift7"] >= 0) else None
    flags["C0"] = c["fee_usd_24h"]
    return flags


# ------------------------------------------------------------- portfolio

def run_policy(hyp, k, days, blocks, series, decisions, outcomes_fn, strata=None):
    size = PILOT_USD / k
    held = []            # dicts with exit_idx, token, initializer, result
    ledger = []
    nav_realized = 0.0
    daily_pnl = {}
    for d_idx, cands in decisions:
        # exit matured
        still = []
        for p in held:
            if p["exit_idx"] <= d_idx:
                nav_realized += p["result"].get("net_usd", 0.0)
                daily_pnl[days[p["exit_idx"]]] = daily_pnl.get(days[p["exit_idx"]], 0.0) + p["result"].get("net_usd", 0.0)
            else:
                still.append(p)
        held = still
        free = k - len(held)
        ranked = sorted((c for c in cands if c["flags"][hyp] is not None
                         and (strata is None or c["stratum"] in strata)),
                        key=lambda c: -c["flags"][hyp])
        entries = []
        for c in ranked:
            if free <= 0:
                break
            if any(c["token"] == p["token"] or (c["initializer"] and c["initializer"] == p["initializer"])
                   for p in held):
                continue
            res = outcomes_fn(c["pool_id"], d_idx, size, "bid" if hyp == "H3" else "lp")
            if res.get("status") == "failed_entry":
                entries.append({"pool_id": c["pool_id"], "status": "failed_entry"})
                continue
            p = {"pool_id": c["pool_id"], "token": c["token"], "initializer": c["initializer"],
                 "entry_day": days[d_idx], "exit_idx": d_idx + HOLD_DAYS, "score": c["flags"][hyp],
                 "stratum": c["stratum"], "result": res}
            held.append(p)
            entries.append(p)
            free -= 1
        ledger.append({"day": days[d_idx], "eligible": len(ranked), "entries": entries,
                       "abstain": not entries and free > 0, "held_after": len(held)})
    for p in held:  # all decisions end by LAST_DECISION so exits are in-window
        nav_realized += p["result"].get("net_usd", 0.0)
        daily_pnl[days[p["exit_idx"]]] = daily_pnl.get(days[p["exit_idx"]], 0.0) + p["result"].get("net_usd", 0.0)
    return ledger, nav_realized, daily_pnl


def summarize_positions(positions):
    ok = [p for p in positions if p["result"].get("status") in ("ok", "failed_exit")]
    nets = [p["result"]["net_usd"] for p in ok]
    return {
        "positions": len(ok),
        "failed_entries": sum(p.get("status") == "failed_entry" for p in positions),
        "failed_exits": sum(p["result"].get("status") == "failed_exit" for p in ok),
        "unique_pools": len({p["pool_id"] for p in ok}),
        "unique_tokens": len({p["token"] for p in ok}),
        "profitable_positions": sum(n > 0 for n in nets),
        "profitable_tokens": len({p["token"] for p in ok if p["result"]["net_usd"] > 0}),
        "profitable_entry_days": len({p["entry_day"] for p in ok if p["result"]["net_usd"] > 0}),
        "net_usd": round(sum(nets), 4),
        "vs_hold_usd": round(sum(p["result"]["vs_hold_usd"] for p in ok), 4),
        "fees_usd": round(sum(p["result"]["fees_usd"] for p in ok), 4),
        "gas_usd": round(sum(p["result"]["gas_usd"] for p in ok), 4),
        "worst_position_usd": round(min(nets), 4) if nets else None,
        "best_position_usd": round(max(nets), 4) if nets else None,
    }


def day_bootstrap(values_by_day: dict, n=4000, seed=7):
    keys = sorted(values_by_day)
    if not keys:
        return None
    rng = random.Random(seed)
    sums = []
    for _ in range(n):
        sums.append(sum(values_by_day[rng.choice(keys)] for _ in keys))
    sums.sort()
    return {"p05": round(sums[int(0.05 * n)], 3), "p50": round(sums[n // 2], 3), "p95": round(sums[int(0.95 * n)], 3)}


def in_range(day, span):
    return span[0] <= day <= span[1]


def main():
    load_cache()
    days, blocks, series = load_panel()
    print("panel pools", len(series), "days", days[0], days[-1], flush=True)
    ref_pool, eth_usd = eth_usd_series(series, blocks)
    print("ETH/USD ref", ref_pool, "first/last", round(eth_usd[0], 1), round(eth_usd[-1], 1), flush=True)

    init_from = {}

    def initializer(pid):
        tx = series[pid].meta.get("init_tx")
        if not tx:
            return pid, None
        return pid, cached_call(f"from:{tx}", lambda: rpc("eth_getTransactionByHash", [tx])["from"].lower())
    for pid, frm in pmap(initializer, list(series)):
        init_from[pid] = frm
    save_cache()

    metrics = {}
    pids = list(series)
    for n, (pid, rows) in enumerate(zip(pids, pmap(lambda p: day_metrics(series[p], blocks, eth_usd), pids))):
        metrics[pid] = rows
    save_cache()
    print("day metrics done", flush=True)

    d_first = days.index(DEV[0])
    d_last = days.index(LAST_DECISION)
    decisions = []
    for d_idx in range(d_first, d_last + 1):
        cands = build_candidates(days, blocks, series, metrics, eth_usd, init_from, d_idx)
        apply_quote_gates(series, cands, blocks, d_idx, eth_usd, UNIT_USD)
        for c in cands:
            c["flags"] = hypothesis_flags(c, eth_usd[d_idx])
        decisions.append((d_idx, cands))
        save_cache()
        print(days[d_idx], "pools", len(cands), "gate-pass", sum(c["eligible_gates"] for c in cands),
              {h: sum(c["flags"][h] is not None for c in cands) for h in ("H1", "H2", "H3")}, flush=True)

    outcome_cache = {}

    def outcomes_fn(pid, d_idx, usd, kind):
        key = (pid, d_idx, round(usd, 4), kind)
        if key not in outcome_cache:
            s = series[pid]
            outcome_cache[key] = outcome(s, blocks[d_idx], blocks[d_idx + HOLD_DAYS],
                                         unit_value_raw(s, eth_usd[d_idx], usd), kind,
                                         eth_usd[d_idx], eth_usd[d_idx + HOLD_DAYS])
        return outcome_cache[key]

    # Hypothesis-level test: every eligible candidate-day at $100 (not only selected).
    hyp_rows = {h: [] for h in ("H1", "H2", "H3", "C0")}
    jobs = []
    for d_idx, cands in decisions:
        for c in cands:
            for h in hyp_rows:
                if c["flags"][h] is not None:
                    jobs.append((h, d_idx, c))
    uniq = {(c["pool_id"], d_idx, "bid" if h == "H3" else "lp") for h, d_idx, c in jobs}
    print("candidate outcomes to evaluate", len(uniq), flush=True)
    pmap(lambda u: outcomes_fn(u[0], u[1], UNIT_USD, u[2]), sorted(uniq))
    save_cache()
    for h, d_idx, c in jobs:
        r = outcomes_fn(c["pool_id"], d_idx, UNIT_USD, "bid" if h == "H3" else "lp")
        hyp_rows[h].append({"day": days[d_idx], "pool_id": c["pool_id"], "token": c["token"],
                            "stratum": c["stratum"], "score": c["flags"][h], **r})

    def fold_of(day):
        if in_range(day, DEV):
            return "DEV"
        for f, span in FOLDS.items():
            if in_range(day, span):
                return f
        return None

    def spearman(xs, ys):
        if len(xs) < 5:
            return None
        rx = {v: i for i, v in enumerate(sorted(range(len(xs)), key=lambda i: xs[i]))}
        ry = {v: i for i, v in enumerate(sorted(range(len(ys)), key=lambda i: ys[i]))}
        a = [rx[i] for i in range(len(xs))]
        b = [ry[i] for i in range(len(ys))]
        ma, mb = statistics.mean(a), statistics.mean(b)
        num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
        den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
        return num / den if den else None

    hyp_report = {}
    for h, rows in hyp_rows.items():
        ok = [r for r in rows if r.get("status") in ("ok", "failed_exit")]
        rep = {}
        for f in ("DEV", "F1", "F2", "F3"):
            fr = [r for r in ok if fold_of(r["day"]) == f]
            by_day = {}
            for r in fr:
                by_day.setdefault(r["day"], []).append(r["net_usd"])
            rep[f] = {
                "candidate_days": len(fr), "unique_tokens": len({r["token"] for r in fr}),
                "mean_net_usd_per_100": round(statistics.mean([r["net_usd"] for r in fr]), 4) if fr else None,
                "mean_vs_hold_usd_per_100": round(statistics.mean([r["vs_hold_usd"] for r in fr]), 4) if fr else None,
                "win_rate": round(sum(r["net_usd"] > 0 for r in fr) / len(fr), 3) if fr else None,
                "spearman_score_vs_hold": spearman([r["score"] for r in fr], [r["vs_hold_usd"] for r in fr]),
                "day_cluster_mean_boot": day_bootstrap({d: statistics.mean(v) for d, v in by_day.items()})
                if by_day else None,
                "failed_exits": sum(r["status"] == "failed_exit" for r in fr),
            }
        by_stratum = {}
        for r in ok:
            if fold_of(r["day"]) in FOLDS:
                by_stratum.setdefault(r["stratum"], []).append(r["net_usd"])
        rep["eval_by_stratum"] = {k: {"n": len(v), "mean_net_usd_per_100": round(statistics.mean(v), 4)}
                                  for k, v in by_stratum.items()}
        hyp_report[h] = rep

    portfolios = {}
    ledgers = {}
    for h in ("H1", "H2", "H3", "C0"):
        for k in (1, 2, 3):
            ledger, nav, daily = run_policy(h, k, days, blocks, series, decisions, outcomes_fn)
            positions = [e for row in ledger for e in row["entries"]]
            per_fold = {}
            for f in ("DEV", "F1", "F2", "F3"):
                fp = [p for p in positions if "entry_day" in p and fold_of(p["entry_day"]) == f]
                per_fold[f] = summarize_positions(fp)
            eval_daily = {d: v for d, v in daily.items() if fold_of(d) in FOLDS or d > FOLDS["F3"][1]}
            portfolios[f"{h}_K{k}"] = {
                "decisions": len(ledger), "abstentions": sum(r["abstain"] for r in ledger),
                "total_net_usd": round(nav, 4), "per_fold": per_fold,
                "eval_day_bootstrap_net_usd": day_bootstrap(eval_daily),
            }
            ledgers[f"{h}_K{k}"] = ledger
        save_cache()
    for strat in ("major", "established", "young"):
        ledger, nav, daily = run_policy("H1", 1, days, blocks, series, decisions, outcomes_fn, strata={strat})
        positions = [e for row in ledger for e in row["entries"]]
        portfolios[f"H4_{strat}_K1"] = {"total_net_usd": round(nav, 4),
                                        "summary": summarize_positions([p for p in positions if "entry_day" in p])}
    save_cache()

    result = {"method": __doc__.strip(), "eth_usd_ref_pool": ref_pool,
              "panel_pools": len(series), "decision_days": [days[d] for d, _ in decisions],
              "gas_tx_eth_p90": GAS_TX_ETH_P90, "hypotheses": hyp_report, "portfolios": portfolios}
    OUT.write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    with gzip.open(LEDGER, "wt", encoding="utf-8") as fh:
        json.dump({"decisions": [{"day": days[d], "block": blocks[d], "candidates": cands}
                                 for d, cands in decisions],
                   "hypothesis_outcomes": hyp_rows, "portfolio_ledgers": ledgers}, fh, default=str)
    print(json.dumps({"hypotheses": {h: {f: (v[f]["candidate_days"], v[f]["mean_net_usd_per_100"])
                                         for f in ("DEV", "F1", "F2", "F3")} for h, v in hyp_report.items()},
                      "portfolios": {k: v.get("total_net_usd") for k, v in portfolios.items()}}, indent=1))


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    main()
