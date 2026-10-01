"""HUNTX prospective forward test ("shadow"), Amendment A6. Read-only.

Run once per day after 00:00 UTC (idempotent; safe to re-run):
  1. extend UTC day boundaries to today;
  2. fetch each newly completed day's Swap logs for the fixed lean universe;
  3. read boundary state (feeGrowthGlobals, slot0) for pools that traded;
  4. freeze today's H3 / H8 decisions into a hash-chained ledger;
  5. score matured decisions (H3 after 3 days, H8 after 5) with exact exits,
     and maintain $200 K=3 shadow portfolios.
Nothing is signed or broadcast. RPC endpoint is loaded locally, never printed.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import random
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests
from eth_abi import decode, encode

import feex_next_day_check as fx
import huntx_edge_slice_study as S
import huntx_harvester_clone as C
from feex_next_day_check import rpc
from huntx_edge_chain import MANAGER, STATE_VIEW, SWAP_TOPIC, block_at
from huntx_edge_engine import load_cache, quote_exact_in, save_cache
from huntx_edge_log_stage import parse
import huntx_stock_mgmt as M
import huntx_stock_vault as V
import huntx_slp_continuous as SC

ROOT = Path(__file__).parent
FWD = ROOT / "huntx_forward"
LOGS = FWD / "logs"
BOUNDS = FWD / "bounds.json"
STATE = FWD / "state.json.gz"
CHAIN = FWD / "chain.txt"
SUMMARY = FWD / "summary.json"
PORTF = FWD / "portfolios.json"
HIST_DIRS = ["huntx_edge_logs", "huntx_edge_logs_gap", "huntx_edge_logs_gap2"]
START = "2026-09-20"          # earliest day loaded (trailing features need 8 days)
FIRST_DECISION = "2026-10-01"
DAY0 = ROOT / "huntx_edge_prospective_2026-09-30.json"
# ETH/USDG reference pool (native ETH, 0.01%): always fetched, since ETH pricing depends on it and it may not be
# in the state panel's tracked list (locally its history came from the large log folders).
ETH_REF_POOL = "0x24107d152f14a76d292123265ae3f3c71f863fc2f4ef7ba49d64e78d28ea379e"


def tracked_pools():
    panel = json.load(gzip.open(ROOT / "huntx_edge_state_panel.json.gz", "rt", encoding="utf-8"))["pools"]
    return sorted(set(panel) | {ETH_REF_POOL})
H3_HOLD, H8_HOLD = 3, 5
RATE = 40
SEL_S0 = "0x" + __import__("web3").Web3.keccak(text="getSlot0(bytes32)")[:4].hex().removeprefix("0x")
SEL_FG = "0x" + __import__("web3").Web3.keccak(text="getFeeGrowthGlobals(bytes32)")[:4].hex().removeprefix("0x")


def log(*a):
    print(datetime.now(timezone.utc).strftime("%H:%M:%S"), *a, flush=True)


def day_str(d):
    return d.date().isoformat()


# ------------------------------------------------------------------ boundaries

def extend_bounds():
    screen = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    bounds = dict(screen)
    if BOUNDS.exists():
        bounds.update(json.loads(BOUNDS.read_text()))
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    d = datetime.fromisoformat(max(bounds)).replace(tzinfo=timezone.utc) + timedelta(days=1)
    latest = int(rpc("eth_blockNumber", []), 16)
    while d <= today:
        bounds[day_str(d)] = block_at(int(d.timestamp()), latest, low=bounds[max(bounds)])
        log("boundary", day_str(d), bounds[day_str(d)])
        d += timedelta(days=1)
    FWD.mkdir(parents=True, exist_ok=True)
    BOUNDS.write_text(json.dumps({k: v for k, v in bounds.items() if k >= "2026-09-30"}, indent=1))
    return bounds


# ------------------------------------------------------------------ logs

def fetch_day_logs(day, bounds, ids):
    out = LOGS / day
    if (out / "done").exists():
        return
    out.mkdir(parents=True, exist_ok=True)
    nxt = (datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat()
    a0, b0 = bounds[day], bounds[nxt] - 1
    chunks = [(a, min(a + 7_999, b0)) for a in range(a0, b0 + 1, 8_000)]
    batches = [ids[i:i + 1000] for i in range(0, len(ids), 1000)]
    index = {pid: i for i, pid in enumerate(ids)}

    def run(job):
        a, b, bi = job
        return rpc("eth_getLogs", [{"address": MANAGER, "fromBlock": hex(a), "toBlock": hex(b),
                                    "topics": [SWAP_TOPIC, batches[bi]]}], timeout=120)
    per = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for rows in ex.map(run, [(a, b, bi) for a, b in chunks for bi in range(len(batches))]):
            for pi, recs in parse(rows, index).items():
                per.setdefault(pi, []).extend(recs)
    for pi, recs in per.items():
        arr = np.array(recs, dtype=np.float64)
        np.save(out / f"{ids[pi]}.npy", arr[np.lexsort((arr[:, 1], arr[:, 0]))])
    (out / "done").write_text(json.dumps({"requests": len(chunks) * len(batches),
                                          "swaps": sum(len(v) for v in per.values())}))
    log("logs", day, "pools with swaps", len(per))


# ------------------------------------------------------------------ state

def batch_eth_call(calls):
    out, pending = {}, calls
    for attempt in range(8):
        if not pending:
            break
        for k in range(0, len(pending), RATE):
            part = pending[k:k + RATE]
            t0 = time.time()
            try:
                resp = requests.post(fx.ENDPOINT, json=[{"jsonrpc": "2.0", "id": i, "method": "eth_call",
                                                         "params": [{"to": STATE_VIEW, "data": d}, hex(b)]}
                                                        for i, d, b in part], timeout=60, verify=fx.TLS_VERIFY).json()
            except (requests.RequestException, ValueError):
                resp = []
            for item in resp if isinstance(resp, list) else []:
                if "result" in item:
                    out[item["id"]] = item["result"]
            time.sleep(max(0.0, len(part) / RATE - (time.time() - t0)))
        pending = [c for c in pending if c[0] not in out]
        time.sleep(attempt)
    if pending:
        raise RuntimeError(f"{len(pending)} state reads failed")
    return out


def update_state(bounds, lean, fstate):
    panel = json.load(gzip.open(ROOT / "huntx_edge_state_panel.json.gz", "rt", encoding="utf-8"))
    merged = {pid: dict(panel["state"].get(pid, {})) for pid in lean}
    for pid, recs in fstate.items():
        if pid.startswith("0x"):
            merged.setdefault(pid, {}).update(recs)
    for day in sorted(d for d in bounds if d > "2026-09-30"):
        if fstate.get("_done_" + day):
            continue
        prev = (datetime.fromisoformat(day) - timedelta(days=1)).date().isoformat()
        traded = set()
        f = LOGS / prev
        if f.exists():
            traded = {p.stem for p in f.glob("0x*.npy")}
        calls, index, n = [], {}, 0
        for pid in lean:
            if pid in traded:
                for kind, sel in (("s0", SEL_S0), ("fg", SEL_FG)):
                    calls.append((n, sel + encode(["bytes32"], [bytes.fromhex(pid[2:])]).hex(), bounds[day] - 1))
                    index[n] = (pid, kind)
                    n += 1
        res = batch_eth_call(calls)
        for i, raw in res.items():
            pid, kind = index[i]
            data = bytes.fromhex(raw[2:])
            rec = fstate.setdefault(pid, {}).setdefault(day, {})
            if kind == "s0":
                s, tick, proto, lp = decode(["uint160", "int24", "uint24", "uint24"], data)
                rec.update(sqrt=str(s), tick=tick, proto=proto, lp_fee=lp)
            else:
                g0, g1 = decode(["uint256", "uint256"], data)
                rec.update(g0=str(g0), g1=str(g1))
        # pools that did not trade: state unchanged, carry forward the previous record
        for pid in lean:
            if pid not in traded:
                last = merged.get(pid, {}).get(prev) or fstate.get(pid, {}).get(prev)
                if last:
                    fstate.setdefault(pid, {})[day] = dict(last)
        fstate["_done_" + day] = True
        log("state", day, "reads", len(calls))
        for pid in lean:
            if day in fstate.get(pid, {}):
                merged.setdefault(pid, {})[day] = fstate[pid][day]
    with gzip.open(STATE, "wt", encoding="utf-8") as fh:
        json.dump(fstate, fh)
    return {"day_bounds": bounds, "pools": panel["pools"], "state": merged}


# ------------------------------------------------------------------ pools

def load_pools(days):
    metas, parts = {}, {}
    for d in HIST_DIRS:
        for pid, m in json.loads((ROOT / d / "meta.json").read_text())["pools"].items():
            # Metadata is registered even without historical arrays: on a cloud runner all swaps come from
            # the forward logs (LOGS/<day>), and pools created after the historical snapshot must load too.
            metas.setdefault(pid, m)
            f = ROOT / d / f"{pid}.npy"
            if f.exists():
                parts.setdefault(pid, []).append(np.load(f))
    for day in days:
        for f in (LOGS / day).glob("0x*.npy") if (LOGS / day).exists() else []:
            parts.setdefault(f.stem, []).append(np.load(f))
    pools = {}
    for pid, arrs in parts.items():
        m = metas.get(pid)
        if m is None or m["hooks"] != S.NATIVE or m["fee"] == 0:
            continue
        a = np.concatenate(arrs)
        a = a[a[:, 0] >= 0]
        _, first = np.unique(a[:, 0] * 1e6 + a[:, 1], return_index=True)
        a = a[np.sort(first)]
        pools[pid] = S.Pool(pid, m, a[np.lexsort((a[:, 1], a[:, 0]))])
    return pools


def simple_proto(state):
    def proto(_s, pid, day):
        recs = state["state"].get(pid, {})
        have = sorted(d for d, r in recs.items() if "proto" in r and d <= day) or \
            sorted(d for d, r in recs.items() if "proto" in r)
        p = recs[have[-1]]["proto"] if have else 0
        return p & 0xFFF, p >> 12
    return proto


# ------------------------------------------------------------------ decisions

def chain_head():
    if not CHAIN.exists():
        return "genesis:" + hashlib.sha256(DAY0.read_bytes()).hexdigest()
    return CHAIN.read_text().strip().splitlines()[-1].split()[-1]


def freeze(day, payload):
    f = FWD / f"decisions_{day}.json"
    if f.exists():
        return json.loads(f.read_text())
    prev = chain_head()
    blob = json.dumps(payload, sort_keys=True, default=str)
    h = hashlib.sha256((prev + blob).encode()).hexdigest()
    f.write_text(json.dumps({"prev_hash": prev, "hash": h, "payload": payload}, indent=1, default=str))
    with CHAIN.open("a") as fh:
        fh.write(f"{day} {h}\n")
    log("frozen", day, h[:16])
    return json.loads(f.read_text())


def decide(day, pools, state, days, bounds, eth, proto):
    metrics = dict(zip(pools, S.pmap(lambda p: S.day_metrics(pools[p], state, days, bounds, eth), list(pools))))
    init_from = {pid: S.cached_call(f"from:{pools[pid].meta.get('init_tx')}", lambda: None) for pid in pools}
    cands = S.candidates(pools, metrics, state, days, bounds, eth, init_from, day)
    S.quote_gate(pools, cands, bounds, day, eth)
    for c in cands:
        c["flags"] = S.flags(c, eth[day])
    clone_rows = {r["pool_id"]: r for r in C.candidates(pools, state, days, bounds, eth, proto, day)}
    h3, h8 = [], []
    for c in cands:
        if c["flags"]["H3"] is not None:
            h3.append({"pool_id": c["pool_id"], "token": c["token"], "score": c["flags"]["H3"],
                       "initializer": c.get("initializer")})
        r = clone_rows.get(c["pool_id"])
        if (r and r["eligible"] and c["ok"] and c.get("imbalance") is not None and c["imbalance"] <= 0.20
                and c.get("drift7") is not None and c["drift7"] >= 0 and all(e > 0 for e in c["excess"])):
            h8.append({"pool_id": c["pool_id"], "token": c["token"], "score": r["fee_tvl"],
                       "initializer": c.get("initializer")})
    # A14 SLP25: stock-token USDG pools, ranked by trailing-3-day fee yield of a +/-2.5% position
    stock_pools = {pid: p for pid, p in pools.items() if p.quote == S.USDG and p.token in V.STOCKS}
    slp = []
    for pid in V.eligible(stock_pools, bounds, day):
        y = M.trailing_yield25(stock_pools[pid], bounds, day, proto)
        if y is not None:
            slp.append({"pool_id": pid, "token": stock_pools[pid].token, "symbol": V.STOCKS[stock_pools[pid].token],
                        "score": y})
    census = {}
    for c in cands:
        for reason in c["reasons"] or ["PASS"]:
            key = reason.split(" ")[0]
            census[key] = census.get(key, 0) + 1
    return {"day": day, "decision_block": bounds[day], "universe": len(pools),
            "rules": "docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md A6 (sha256 chain in research/huntx_edge_prereg.sha256)",
            "H3": sorted(h3, key=lambda x: -x["score"]), "H8": sorted(h8, key=lambda x: -x["score"]),
            "SLP25": sorted(slp, key=lambda x: -x["score"]),
            "gate_census": census}


# ------------------------------------------------------------------ scoring

def score(decisions, pools, state, days, bounds, eth, proto):
    res_file = FWD / "outcomes.json"
    done = json.loads(res_file.read_text()) if res_file.exists() else {}
    for d, dec in decisions.items():
        for hyp, hold in (("H3", H3_HOLD), ("H8", H8_HOLD)):
            if d not in days or days.index(d) + hold >= len(days):
                continue
            for pick in dec.get(hyp, []):
                key = f"{hyp}|{d}|{pick['pool_id']}"
                if key in done or pick["pool_id"] not in pools:
                    continue
                pool = pools[pick["pool_id"]]
                if hyp == "H3":
                    r = S.lp_outcome(pool, state, days, bounds, eth, d, 100.0, "bid")
                    net = r.get("net_usd")
                else:
                    r = C.run_unit(pool, state, days, bounds, eth, proto, d, 100.0)
                    net = r.get("net_exec_usd")
                done[key] = {"hyp": hyp, "day": d, "pool_id": pick["pool_id"], "token": pick["token"],
                             "net_usd_per_100": net, **{k: v for k, v in r.items() if k != "post_fill_24h_token_ret"}}
    clock = V.Clock(bounds)
    V.GAS = 0.0125
    for d, dec in decisions.items():
        if d not in days or days.index(d) + V.HORIZON >= len(days):
            continue
        for pick in dec.get("SLP25", []):
            key = f"SLP25|{d}|{pick['pool_id']}"
            if key in done or pick["pool_id"] not in pools:
                continue
            r = M.run(pools[pick["pool_id"]], d, bounds, clock, proto, 1.025, "static", "always", True, 0.0, 100.0)
            done[key] = {"hyp": "SLP25", "day": d, "pool_id": pick["pool_id"], "token": pick["symbol"],
                         "net_usd_per_100": r.get("net_usd"), **r}
    res_file.write_text(json.dumps(done, indent=1, default=str))
    return done


def portfolios(decisions, pools, state, days, bounds, eth, proto):
    """$200, K=3 shadow portfolios per hypothesis: 3 slots, one per token/initializer."""
    out = {}
    for hyp, hold in (("H3", H3_HOLD), ("H8", H8_HOLD)):
        held, rows, nav = [], [], 0.0
        for d in sorted(decisions):
            if d not in days:
                continue
            di = days.index(d)
            for p in [p for p in held if p["exit_idx"] <= di]:
                nav += p["net"] or 0.0
            held = [p for p in held if p["exit_idx"] > di]
            for pick in decisions[d].get(hyp, []):
                if len(held) >= 3:
                    break
                if pick["pool_id"] not in pools or any(
                        pick["token"] == p["token"] or (pick.get("initializer") and pick.get("initializer") == p["init"])
                        for p in held):
                    continue
                matured = di + hold < len(days)
                net = None
                if matured:
                    pool = pools[pick["pool_id"]]
                    r = (S.lp_outcome(pool, state, days, bounds, eth, d, 200 / 3, "bid") if hyp == "H3"
                         else C.run_unit(pool, state, days, bounds, eth, proto, d, 200 / 3))
                    net = r.get("net_usd") if hyp == "H3" else r.get("net_exec_usd")
                p = {"day": d, "pool_id": pick["pool_id"], "token": pick["token"], "init": pick.get("initializer"),
                     "exit_idx": di + hold, "matured": matured, "net": net}
                held.append(p)
                rows.append(p)
        nav += sum(p["net"] or 0.0 for p in held if p["matured"])
        out[hyp] = {"realized_net_usd_on_200": round(nav, 3), "positions": len(rows),
                    "matured": sum(p["matured"] for p in rows),
                    "profitable": sum((p["net"] or 0) > 0 for p in rows if p["matured"]), "ledger": rows}
    # SLP25 $200 K=5 book, one per symbol, 5-day units
    clock = V.Clock(bounds)
    held, rows, nav = [], [], 0.0
    for d in sorted(decisions):
        if d not in days:
            continue
        di = days.index(d)
        for p in [p for p in held if p["exit_idx"] <= di]:
            nav += p["net"] or 0.0
        held = [p for p in held if p["exit_idx"] > di]
        for pick in decisions[d].get("SLP25", []):
            if len(held) >= 5:
                break
            if pick["pool_id"] not in pools or any(pick["symbol"] == p["token"] for p in held):
                continue
            matured = di + V.HORIZON < len(days)
            net = None
            if matured:
                r = M.run(pools[pick["pool_id"]], d, bounds, clock, proto, 1.025, "static", "always", True, 0.0, 40.0)
                net = r.get("net_usd")
            p = {"day": d, "pool_id": pick["pool_id"], "token": pick["symbol"], "exit_idx": di + V.HORIZON,
                 "matured": matured, "net": net}
            held.append(p)
            rows.append(p)
    nav += sum(p["net"] or 0.0 for p in held if p["matured"])
    out["SLP25"] = {"realized_net_usd_on_200": round(nav, 3), "positions": len(rows),
                    "matured": sum(p["matured"] for p in rows),
                    "profitable": sum((p["net"] or 0) > 0 for p in rows if p["matured"]),
                    "worst_position_usd": min([p["net"] for p in rows if p["matured"] and p["net"] is not None] or [0]),
                    "ledger": rows}
    PORTF.write_text(json.dumps(out, indent=1, default=str))
    return out


def slp10k8_book(pools, state, days, bounds, proto):
    """A17: frozen 8-symbol continuous book from 2026-10-01; daily exact-exit valuation."""
    start = "2026-10-01"
    if start not in bounds or days[-1] <= start:
        return None
    stock_pools = {pid: p for pid, p in pools.items() if p.quote == S.USDG and p.token in V.STOCKS}
    pf = FWD / "slp10k8_picks.json"
    if not pf.exists():
        best = {}
        for pid in V.eligible(stock_pools, bounds, start):
            y = M.trailing_yield25(stock_pools[pid], bounds, start, proto)
            sym = V.STOCKS[stock_pools[pid].token]
            if y is not None and (sym not in best or y > best[sym][0]):
                best[sym] = (y, pid)
        picks = [{"symbol": s_, "pool_id": pid, "score": y}
                 for s_, (y, pid) in sorted(best.items(), key=lambda kv: -kv[1][0])[:8]]
        payload = {"start": start, "decision_block": bounds[start], "picks": picks,
                   "rule": "A17 (docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md)"}
        prev = chain_head()
        h = hashlib.sha256((prev + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
        pf.write_text(json.dumps({"prev_hash": prev, "hash": h, "payload": payload}, indent=1))
        with CHAIN.open("a") as fh:
            fh.write(f"slp10k8-picks {h}\n")
    picks = json.loads(pf.read_text())["payload"]["picks"]
    ids = [x["pool_id"] for x in picks if x["pool_id"] in stock_pools]
    hist_f = FWD / "slp10k8_nav.json"
    hist = json.loads(hist_f.read_text()) if hist_f.exists() else {}
    end = days[-1]
    if end not in hist:
        r = SC.run_vault(stock_pools, bounds, proto, start, end, 8, "fixed:0.01", symbols=ids)
        r_skew = SC.run_vault(stock_pools, bounds, proto, start, end, 8, "skew:0.985:1.005", symbols=ids)
        hold = 0.0
        for pid in ids:
            p = stock_pools[pid]
            got = quote_exact_in(p.meta, not p.q1, int(200 / len(ids) * 1e6), bounds[start] - 1)
            out = quote_exact_in(p.meta, p.q1, int(got or 0), bounds[end] - 1) if got else 0
            hold += (out or 0) / 1e6
        hist[end] = {"book_exit_value": round(200 + r["net_usd"], 4),
                     "skew_book_exit_value": round(200 + r_skew["net_usd"], 4),
                     "skew_per_sleeve": r_skew["per_sleeve"],
                     "hold_stocks_value": round(hold, 4),
                     "hold_usdg": 200.0, "per_sleeve": r["per_sleeve"], "rebands": r["rebands"]}
        hist_f.write_text(json.dumps(hist, indent=1))
    return hist


COHORTS = ["2026-10-01", "2026-10-10", "2026-10-19", "2026-10-28"]
ENTRY_GATE_BPS = 70.0  # A26
ETH_LEG_BPS = 2.0  # ETH/USDG 0.01% pool, in and out


def _earnings_excluded(sym, d):
    """A25 rule as fixed in research/huntx_forward/earnings_calendar.json before October data."""
    cal = json.loads((FWD / "earnings_calendar.json").read_text())["events"]
    ev = cal.get(sym)
    if not ev:
        return False
    start = datetime.fromisoformat(d).date()
    when = datetime.fromisoformat(ev["date"]).date()
    if ev["status"] == "confirmed":
        return start <= when <= start + timedelta(days=9)
    return start - timedelta(days=7) <= when <= start + timedelta(days=16)


def cohort_books(pools, state, days, bounds, proto):
    """A25/A26: every 9 days freeze B0 / E1 (earnings exclusion) / G1 (ETH-entry cost gate) picks; value daily,
    scored after one ETH entry + exit at the routes measured at the decision block."""
    import huntx_route_costs as RC
    stock_pools = {pid: p for pid, p in pools.items() if p.quote == S.USDG and p.token in V.STOCKS}
    nav_f = FWD / "cohort_nav.json"
    nav = json.loads(nav_f.read_text()) if nav_f.exists() else {}
    for d in COHORTS:
        if d not in bounds or days[-1] <= d:
            continue
        pf = FWD / f"cohort_{d}.json"
        if not pf.exists():
            best = {}
            for pid in V.eligible(stock_pools, bounds, d):
                y = M.trailing_yield25(stock_pools[pid], bounds, d, proto)
                sym = V.STOCKS[stock_pools[pid].token]
                if y is not None and (sym not in best or y > best[sym][0]):
                    best[sym] = (y, pid)
            ranked = sorted(best, key=lambda s_: -best[s_][0])
            rt = RC.best_round_trip_bps(ranked[:20], bounds[d] - 1)
            b0 = ranked[:8]
            e1 = [s_ for s_ in ranked if not _earnings_excluded(s_, d)][:8]
            g1 = [s_ for s_ in ranked if rt.get(s_) is not None and rt[s_] <= ENTRY_GATE_BPS][:8]
            missing = [s_ for s_ in set(e1 + g1) if s_ not in rt]
            if missing:
                rt.update(RC.best_round_trip_bps(missing, bounds[d] - 1))
            payload = {"start": d, "decision_block": bounds[d],
                       "books": {k: [{"symbol": s_, "pool_id": best[s_][1], "score": best[s_][0]} for s_ in v]
                                 for k, v in (("B0", b0), ("E1", e1), ("G1", g1))},
                       "round_trip_bps_at_250": rt, "rule": "A25/A26 (docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md)"}
            prev = chain_head()
            h = hashlib.sha256((prev + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
            pf.write_text(json.dumps({"prev_hash": prev, "hash": h, "payload": payload}, indent=1))
            with CHAIN.open("a") as fh:
                fh.write(f"cohort-{d} {h}" + chr(10))
            save_cache()
        payload = json.loads(pf.read_text())["payload"]
        end = min((datetime.fromisoformat(d) + timedelta(days=9)).date().isoformat(), days[-1])
        if end not in bounds or end in nav.get(d, {}):
            continue
        row = {}
        for book, picks in payload["books"].items():
            ids = [x["pool_id"] for x in picks if x["pool_id"] in stock_pools]
            if not ids:
                continue
            r = SC.run_vault(stock_pools, bounds, proto, d, end, len(ids), "fixed:0.01", symbols=ids)
            per = 200 / len(ids)
            rts = payload["round_trip_bps_at_250"]
            entry = sum(per / 2 * (rts.get(x["symbol"]) if rts.get(x["symbol"]) is not None else 10_000) / 1e4
                        for x in picks) + 200 * ETH_LEG_BPS / 1e4
            row[book] = {"net_usd": round(r["net_usd"], 4), "entry_exit_cost_usd": round(entry, 4),
                         "net_after_entry_usd": round(r["net_usd"] - entry, 4),
                         "worst_sleeve_usd": round(min(r["per_sleeve"].values()) if isinstance(r["per_sleeve"], dict) else min(r["per_sleeve"]), 4)}
        nav.setdefault(d, {})[end] = row
        nav_f.write_text(json.dumps(nav, indent=1))
    return nav


def summarize(done, ports):
    summ = {"updated_utc": datetime.now(timezone.utc).isoformat()}
    for hyp in ("H3", "H8", "SLP25"):
        rows = [r for r in done.values() if r["hyp"] == hyp and r.get("net_usd_per_100") is not None]
        byd = {}
        for r in rows:
            byd.setdefault(r["day"], []).append(r["net_usd_per_100"])
        boot = None
        if len(byd) >= 2:
            ks = sorted(byd)
            rng = random.Random(1)
            m = sorted(statistics.mean([v for k in [rng.choice(ks) for _ in ks] for v in byd[k]]) for _ in range(4000))
            boot = {"p05": round(m[200], 3), "p50": round(m[2000], 3), "p95": round(m[3800], 3)}
        tok = {}
        for r in rows:
            tok.setdefault(r["token"], []).append(r["net_usd_per_100"])
        summ[hyp] = {"scored_decision_days": len(byd), "positions": len(rows),
                     "mean_net_per_100": round(statistics.mean(r["net_usd_per_100"] for r in rows), 3) if rows else None,
                     "day_cluster_90": boot, "tokens": len(tok),
                     "profitable_tokens": sum(statistics.mean(v) > 0 for v in tok.values()),
                     "portfolio_on_200": {k: v for k, v in ports[hyp].items() if k != "ledger"},
                     "verdict_ready": len(byd) >= 30}
    SUMMARY.write_text(json.dumps(summ, indent=1))
    return summ


def main():
    FWD.mkdir(parents=True, exist_ok=True)
    load_cache()
    bounds = extend_bounds()
    lean = tracked_pools()
    complete = [d for d in sorted(bounds) if d >= "2026-09-30" and
                (datetime.fromisoformat(d) + timedelta(days=1)).date().isoformat() in bounds]
    for d in complete:
        fetch_day_logs(d, bounds, lean)
    fstate = json.load(gzip.open(STATE, "rt")) if STATE.exists() else {}
    state = update_state(bounds, lean, fstate)
    S.seed_cache_from_state(state)
    days = sorted(d for d in bounds if d >= START)
    pools = load_pools(days)
    ref = next(p for pid, p in pools.items() if pid.startswith("0x24107d152f"))
    eth = {d: C.price_q(ref, ref.sqrt_before(bounds[d]) or S.state_sqrt(state, ref.pid, d)) * 1e12 for d in days}
    proto = simple_proto(state)
    S.proto = proto
    log("pools", len(pools), "days", days[0], "->", days[-1])
    decisions = {}
    day0 = json.loads(DAY0.read_text())["frozen"]
    decisions["2026-09-30"] = {"H3": [{"pool_id": c["pool_id"], "token": c["token"], "score": c["flags"]["H3"],
                                       "initializer": c.get("initializer")}
                                      for c in day0["selected"] if c["flags"].get("H3") is not None], "H8": []}
    for d in days:
        if d >= FIRST_DECISION:
            f = FWD / f"decisions_{d}.json"
            if not f.exists():
                payload = decide(d, pools, state, days, bounds, eth, proto)
                save_cache()
                freeze(d, payload)
            decisions[d] = json.loads(f.read_text())["payload"]
    done = score(decisions, pools, state, days, bounds, eth, proto)
    save_cache()
    ports = portfolios(decisions, pools, state, days, bounds, eth, proto)
    save_cache()
    summ = summarize(done, ports)
    book = slp10k8_book(pools, state, days, bounds, proto)
    if book:
        summ["SLP10K8_book"] = book[max(book)]
        SUMMARY.write_text(json.dumps(summ, indent=1))
    try:
        cohorts = cohort_books(pools, state, days, bounds, proto)
        if cohorts:
            summ["cohorts_A25_A26"] = {d: v[max(v)] for d, v in cohorts.items() if v}
            SUMMARY.write_text(json.dumps(summ, indent=1))
    except Exception as exc:  # the A17 book above must never be blocked by the new books
        log("cohort books failed:", repr(exc))
    finally:
        save_cache()
    print(json.dumps({"today": days[-1], "SLP25_today": len(decisions.get(days[-1], {}).get("SLP25", [])),
                      "H3_today": len(decisions.get(days[-1], {}).get("H3", [])),
                      "H8_today": len(decisions.get(days[-1], {}).get("H8", [])), "summary": summ}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
