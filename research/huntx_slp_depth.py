"""A21: depth-aware pool choice + best-pool routing (D1) vs B0 at $2k and $20k."""
import json, statistics
from pathlib import Path
import huntx_slp_beta as B
import huntx_slp_continuous as SC
import huntx_stock_mgmt as M
import huntx_stock_vault as V
from huntx_edge_engine import quote_exact_in, save_cache

ROOT = Path(__file__).parent


def price_q(p, s):
    return s * s if p.q1 else 1 / (s * s)


def depth_ok(p, t0, sleeve_usd):
    s = p.sqrt_before(t0)
    if s is None:
        return False
    tokens = (sleeve_usd / 2) * 1e6 / price_q(p, s)
    out = quote_exact_in(p.meta, p.q1, int(tokens), t0 - 1)
    if not out:
        return False
    fair = tokens * price_q(p, s) * (1 - p.meta["fee"] / 1e6)
    return 1 - out / fair <= 0.01


def depth_picks(pools, bounds, proto, start, capital, k=8):
    t0 = bounds[start]
    by_sym = {}
    for pid in V.eligible(pools, bounds, start):
        y = M.trailing_yield25(pools[pid], bounds, start, proto)
        if y is not None:
            by_sym.setdefault(V.STOCKS[pools[pid].token], []).append((y, pid))
    ranked_syms = sorted(by_sym, key=lambda s_: -max(y for y, _ in by_sym[s_]))
    picks = []
    for sym in ranked_syms:
        for y, pid in sorted(by_sym[sym], reverse=True):
            if depth_ok(pools[pid], t0, capital / k):
                picks.append(pid)
                break
        if len(picks) == k:
            break
    return picks


def routes_for(pools, picks):
    out = {}
    for pid in picks:
        tok = pools[pid].token
        out[pid] = [p for p in pools.values() if p.token == tok]
    return out


def main():
    bounds, clock, proto, pools = M.setup()
    res = {}
    for start, end, tag in B.windows():
        row = {"tag": tag}
        base_ids = B.picks_at(pools, bounds, proto, start)
        for cap in (2000.0, 20000.0):
            r0 = SC.run_vault(pools, bounds, proto, start, end, 8, "fixed:0.01", capital=cap, symbols=base_ids)
            ids = depth_picks(pools, bounds, proto, start, cap)
            r1 = SC.run_vault(pools, bounds, proto, start, end, 8, "fixed:0.01", capital=cap, symbols=ids,
                              routes=routes_for(pools, ids))
            row[f"B0_{int(cap)}_pct"] = round(100 * r0["net_usd"] / cap, 3)
            row[f"D1_{int(cap)}_pct"] = round(100 * r1["net_usd"] / cap, 3)
            row[f"D1_{int(cap)}_symbols"] = r1["symbols"]
        res[start] = row
        save_cache()
        print(start, json.dumps(row), flush=True)
    summ = {}
    for name in ("B0_2000", "D1_2000", "B0_20000", "D1_20000"):
        vals = [res[s][f"{name}_pct"] for s in res]
        summ[name] = {"mean_pct": round(statistics.mean(vals), 3), "worst_pct": round(min(vals), 3)}
    verdict = (summ["D1_20000"]["mean_pct"] >= 1.5 and summ["D1_20000"]["worst_pct"] >= -2.0
               and summ["D1_2000"]["mean_pct"] >= summ["B0_2000"]["mean_pct"] - 0.2)
    (ROOT / "huntx_slp_depth_results.json").write_text(json.dumps({"windows": res, "summary": summ, "pass": verdict}, indent=1))
    print("SUMMARY", json.dumps(summ), "PASS", verdict, flush=True)


if __name__ == "__main__":
    main()
