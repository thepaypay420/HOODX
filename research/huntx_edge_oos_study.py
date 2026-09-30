"""Out-of-sample test of the frozen rules on untouched folds F1/F2 (Amendment A3).

Decisions 2026-09-08..09-21 (00:00 UTC), 3-day hold, exact V4Quoter entry and
exit quotes. Primary: H3. Reference and control: H1, C0. Reuses the slice
engine (huntx_edge_slice_study.py) unchanged except for data loading:
* logs = early (09-01..19, all lean pools) + slice (09-20..29, prefilter pools)
  + gap (09-20..23, remaining lean pools), deduplicated by (block, log index);
* ETH/USD from the reference ETH/USDG pool's last swap before each boundary;
* protocol fee: slot0 read at the pool's first live boundary and 09-19; if
  those differ, an exact archive slot0 read at the needed boundary.
"""

from __future__ import annotations

import gzip
import json
import random
import statistics
from pathlib import Path

import numpy as np

import huntx_edge_slice_study as S
from huntx_edge_engine import load_cache, save_cache, slot0 as engine_slot0

ROOT = Path(__file__).parent
DIRS = ["huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap"]
OUT = ROOT / "huntx_edge_oos_results.json"
LEDGER = ROOT / "huntx_edge_oos_ledger.json.gz"
FOLDS = {"F1": ("2026-09-08", "2026-09-14"), "F2": ("2026-09-15", "2026-09-21")}
ETH_REF = "0x24107d152f"          # most active ETH/USDG pool (same reference as the slice)


def load_pools(state):
    metas, parts = {}, {}
    for d in DIRS:
        mfile = ROOT / d / "meta.json"
        if not mfile.exists():
            continue
        meta = json.loads(mfile.read_text())
        for pid, m in meta["pools"].items():
            f = ROOT / d / f"{pid}.npy"
            if f.exists():
                metas.setdefault(pid, m)
                parts.setdefault(pid, []).append(np.load(f))
    pools = {}
    for pid, arrs in parts.items():
        m = metas[pid]
        if m["hooks"] != S.NATIVE or m["fee"] == 0:
            continue
        arr = np.concatenate(arrs)
        key = arr[:, 0] * 1e6 + arr[:, 1]
        _, first = np.unique(key, return_index=True)
        arr = arr[np.sort(first)]
        arr = arr[np.lexsort((arr[:, 1], arr[:, 0]))]
        pools[pid] = S.Pool(pid, m, arr)
    return pools


def eth_from_logs(pools, days, bounds, state):
    ref = next(p for pid, p in pools.items() if pid.startswith(ETH_REF))
    out = {}
    for d in days:
        s = ref.sqrt_before(bounds[d]) or S.state_sqrt(state, ref.pid, d)
        price = s * s if ref.q1 else 1 / (s * s)
        out[d] = price * 1e18 / 1e6
    return ref.pid, out


def make_proto(state, bounds):
    """Protocol fee per (pool, day). Pools whose early-window setting changed get
    their single switch day located by bisection over exact archive reads; the
    result is verified at the day before the switch."""
    days = sorted(bounds)
    switch = {}

    def raw(pid, day):
        recs = state["state"].get(pid, {})
        if day in recs and "proto" in recs[day]:
            return recs[day]["proto"]
        s0 = engine_slot0(pid, bounds[day] - 1)
        return s0["proto0"] | (s0["proto1"] << 12)

    def locate(pid, early):
        lo, hi = days.index(early[0]), days.index(early[-1])
        first, last = raw(pid, days[lo]), raw(pid, days[hi])
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if raw(pid, days[mid]) == first:
                lo = mid
            else:
                hi = mid
        # single-switch assumption check: value just after the switch must equal the final value
        return (days[hi], first, last) if raw(pid, days[hi]) == last else None

    def proto(_state, pid, day):
        recs = state["state"].get(pid, {})
        if day in recs and "proto" in recs[day]:
            p = recs[day]["proto"]
            return p & 0xFFF, p >> 12
        early = sorted(d for d, r in recs.items() if "proto" in r and d <= "2026-09-19")
        vals = {recs[d]["proto"] for d in early}
        if len(vals) <= 1:
            prior = [d for d in sorted(d for d, r in recs.items() if "proto" in r) if d <= day]
            p = recs[prior[-1] if prior else early[0]]["proto"] if (prior or early) else 0
        else:
            if pid not in switch:
                switch[pid] = locate(pid, early)
            sw = switch[pid]
            if sw is None:
                p = raw(pid, day)                          # not a single switch: exact read
            else:
                p = sw[1] if day < sw[0] else sw[2]
        return p & 0xFFF, p >> 12
    return proto


def boot_lower(values_by_day, n=5000, seed=11):
    keys = sorted(values_by_day)
    if len(keys) < 2:
        return None
    rng = random.Random(seed)
    means = []
    for _ in range(n):
        pick = [rng.choice(keys) for _ in keys]
        vals = [v for k in pick for v in values_by_day[k]]
        means.append(statistics.mean(vals))
    means.sort()
    return {"p05": round(means[int(0.05 * n)], 3), "p50": round(means[n // 2], 3), "p95": round(means[int(0.95 * n)], 3)}


def main():
    load_cache()
    state = json.load(gzip.open(S.STATE, "rt", encoding="utf-8"))
    S.seed_cache_from_state(state)
    screen = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())
    bounds = {d: b for d, b in screen["day_bounds"].items() if "2026-09-01" <= d <= "2026-09-30"}
    days = sorted(bounds)
    pools = load_pools(state)
    ref, eth = eth_from_logs(pools, days, bounds, state)
    S.proto = make_proto(state, bounds)
    print("pools", len(pools), "ETH", {d: round(eth[d]) for d in (days[0], days[-1])}, flush=True)

    def initializer(pid):
        tx = pools[pid].meta.get("init_tx")
        return pid, (S.cached_call(f"from:{tx}", lambda: S.rpc("eth_getTransactionByHash", [tx])["from"].lower())
                     if tx else None)
    init_from = dict(S.pmap(initializer, list(pools), workers=4))
    save_cache()
    metrics = dict(zip(pools, S.pmap(lambda p: S.day_metrics(pools[p], state, days, bounds, eth), list(pools))))
    save_cache()
    print("metrics done", flush=True)

    dec_days = [d for d in days if FOLDS["F1"][0] <= d <= FOLDS["F2"][1]]
    decisions = []
    for d in dec_days:
        cands = S.candidates(pools, metrics, state, days, bounds, eth, init_from, d)
        # Coverage guard: logs must cover the trailing 7 days and the full hold.
        di = days.index(d)
        S.quote_gate(pools, cands, bounds, d, eth)
        for c in cands:
            c["flags"] = S.flags(c, eth[d])
        decisions.append(((d, di), cands))
        save_cache()
        print(d, "gate-pass", sum(c["ok"] for c in cands),
              {h: sum(c["flags"][h] is not None for c in cands) for h in ("H1", "H3", "H5", "H6")}, flush=True)

    memo = {}

    def outcome_fn(hyp, pid, d, usd):
        kind = "bid" if hyp == "H3" else "lp"
        key = (pid, d, round(usd, 4), kind)
        if key not in memo:
            memo[key] = S.lp_outcome(pools[pid], state, days, bounds, eth, d, usd, kind)
        return memo[key]

    jobs = [(h, c["pool_id"], d[0]) for d, cands in decisions for c in cands for h in ("H3", "H1")
            if c["flags"][h] is not None]
    for d, cands in decisions:
        for c in sorted((c for c in cands if c["flags"]["C0"] is not None), key=lambda c: -c["flags"]["C0"])[:5]:
            jobs.append(("C0", c["pool_id"], d[0]))
    print("outcomes", len(jobs), flush=True)
    res = S.pmap(lambda j: outcome_fn(j[0], j[1], j[2], S.UNIT_USD), jobs)
    save_cache()
    cand = {(d[0], c["pool_id"]): c for d, cs in decisions for c in cs}
    rows = {"H3": [], "H1": [], "C0": []}
    for (h, pid, d), r in zip(jobs, res):
        c = cand[(d, pid)]
        rows[h].append({"day": d, "pool_id": pid, "token": c["token"], "stratum": c["stratum"],
                        "score": c["flags"][h], **r})

    def fold(day):
        return next((f for f, (a, b) in FOLDS.items() if a <= day <= b), None)
    report = {}
    for h, rs in rows.items():
        ok = [r for r in rs if r.get("status") in ("ok", "failed_exit")]
        rep = {"all": S.summarize(rs)}
        for f in FOLDS:
            fr = [r for r in rs if fold(r["day"]) == f]
            rep[f] = S.summarize(fr)
            by_day = {}
            for r in fr:
                if r.get("status") in ("ok", "failed_exit"):
                    by_day.setdefault(r["day"], []).append(r["net_usd"])
            rep[f]["day_cluster_boot_mean"] = boot_lower(by_day)
        by_day = {}
        for r in ok:
            by_day.setdefault(r["day"], []).append(r["net_usd"])
        rep["day_cluster_boot_mean_all"] = boot_lower(by_day)
        tok = {}
        for r in ok:
            tok.setdefault(r["token"], []).append(r["net_usd"])
        rep["token_level"] = {"tokens": len(tok),
                              "mean_of_token_means": round(statistics.mean(statistics.mean(v) for v in tok.values()), 3)
                              if tok else None,
                              "profitable_tokens": sum(statistics.mean(v) > 0 for v in tok.values())}
        report[h] = rep
    ports = {}
    for h in ("H3", "H1", "C0"):
        for k in (1, 2, 3):
            ledger, nav = S.portfolio(h, k, decisions, outcome_fn)
            ents = [e for row in ledger for e in row["entries"] if "res" in e]
            ports[f"{h}_K{k}"] = {"net_usd_on_200": round(nav, 3), "positions": len(ents),
                                  "profitable": sum(e["res"].get("net_usd", 0) > 0 for e in ents),
                                  "unique_tokens": len({e["token"] for e in ents}),
                                  "abstain_days": sum(r["abstain"] for r in ledger),
                                  "worst_usd": round(min((e["res"].get("net_usd", 0) for e in ents), default=0), 3)}
    save_cache()
    OUT.write_text(json.dumps({"method": __doc__.strip(), "pools": len(pools), "eth_ref": ref,
                               "decision_days": dec_days, "hypotheses": report, "portfolios": ports},
                              indent=1, default=str))
    with gzip.open(LEDGER, "wt", encoding="utf-8") as fh:
        json.dump({"decisions": [{"day": d[0], "block": bounds[d[0]], "candidates": c} for d, c in decisions],
                   "outcomes": rows}, fh, default=str)
    print(json.dumps({h: {k: report[h][k] for k in ("all", "F1", "F2", "day_cluster_boot_mean_all", "token_level")}
                      for h in report}, indent=1, default=str))
    print(json.dumps(ports, indent=1))


if __name__ == "__main__":
    main()
