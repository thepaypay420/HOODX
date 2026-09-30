"""A18: beta control for the stock-LP vault (B0-B3). See the pre-registration."""
import json, statistics
from datetime import date, timedelta
from pathlib import Path
import numpy as np
import huntx_slp_continuous as SC
import huntx_stock_mgmt as M
import huntx_stock_vault as V
from huntx_edge_engine import quote_exact_in, save_cache

ROOT = Path(__file__).parent
SEL = ["2026-09-04", "2026-09-07", "2026-09-10"]
CONF = ["2026-09-13", "2026-09-16", "2026-09-19"]
DOWN = ("2026-09-20", "2026-09-29")
VARIANTS = {"B0": ("fixed:0.01", 0.0), "B1": ("fixed:0.01", 0.3),
            "B2": ("skew:0.985:1.005", 0.0), "B3": ("skew:0.985:1.005", 0.3)}


def windows():
    w = [(s, (date.fromisoformat(s) + timedelta(days=9)).isoformat(), "sel") for s in SEL]
    w += [(s, (date.fromisoformat(s) + timedelta(days=9)).isoformat(), "conf") for s in CONF]
    w.append((DOWN[0], DOWN[1], "down"))
    return w


def picks_at(pools, bounds, proto, start, k=8):
    best = {}
    for pid in V.eligible(pools, bounds, start):
        y = M.trailing_yield25(pools[pid], bounds, start, proto)
        sym = V.STOCKS[pools[pid].token]
        if y is not None and (sym not in best or y > best[sym][0]):
            best[sym] = (y, pid)
    return [pid for _, (y, pid) in sorted(best.items(), key=lambda kv: -kv[1][0])[:k]]


def main():
    bounds, clock, proto, pools = M.setup()
    sgov = max((pid for pid, p in pools.items() if V.STOCKS.get(p.token) == "SGOV"), key=lambda x: len(pools[x].blk))
    out = {"runs": {}}
    for start, end, tag in windows():
        ids = picks_at(pools, bounds, proto, start)
        T0, T1 = bounds[start], bounds[end]
        hold = 0.0
        for pid in ids:
            p = pools[pid]
            got = quote_exact_in(p.meta, not p.q1, int(200 / len(ids) * 1e6), T0 - 1)
            o = quote_exact_in(p.meta, p.q1, int(got or 0), T1 - 1) if got else 0
            hold += (o or 0) / 1e6
        row = {"tag": tag, "end": end, "hold_net": round(hold - 200, 3), "symbols": [V.STOCKS[pools[i].token] for i in ids]}
        for name, (mode, cash) in VARIANTS.items():
            stock_cap = 200 * (1 - cash)
            r = SC.run_vault(pools, bounds, proto, start, end, 8, mode, capital=stock_cap, symbols=ids)
            net = r["net_usd"]
            if cash:
                rc = SC.run_vault(pools, bounds, proto, start, end, 1, "fixed:0.005", capital=200 * cash, symbols=[sgov])
                net += rc["net_usd"]
            row[name] = round(net, 3)
        out["runs"][start] = row
        print(start, tag, json.dumps(row), flush=True)
        save_cache()
    summ = {}
    for name in VARIANTS:
        conf = [out["runs"][s][name] for s in CONF] + [out["runs"][DOWN[0]][name]]
        sel = [out["runs"][s][name] for s in SEL]
        allw = [out["runs"][s][name] for s in out["runs"]]
        holds = [out["runs"][s]["hold_net"] for s in out["runs"]]
        beta = float(np.polyfit(holds, allw, 1)[0]) if len(set(holds)) > 1 else None
        summ[name] = {"sel_mean": round(statistics.mean(sel), 3), "conf_mean": round(statistics.mean(conf), 3),
                      "conf_worst": round(min(conf), 3), "down": out["runs"][DOWN[0]][name],
                      "beta_vs_hold": round(beta, 3) if beta is not None else None}
    b0 = summ["B0"]
    for name, v in summ.items():
        v["replaces_B0"] = bool(name != "B0" and v["conf_mean"] >= 0.9 * b0["conf_mean"]
                                and v["conf_worst"] >= b0["conf_worst"] and v["down"] >= b0["down"])
    out["summary"] = summ
    (ROOT / "huntx_slp_beta_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(summ, indent=1))


if __name__ == "__main__":
    main()
