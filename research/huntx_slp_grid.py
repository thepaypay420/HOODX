"""A16: profit optimization grid for the continuous stock-LP vault + SGOV cash sleeve.

Selection starts 09-04/07/10, confirmation starts 09-13/16/19, 9-day horizon,
$200, exact entry/exit quotes. See docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md A16.
"""

from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from pathlib import Path

import huntx_slp_continuous as SC
import huntx_stock_mgmt as M
import huntx_stock_vault as V
from huntx_edge_engine import quote_exact_in, save_cache

ROOT = Path(__file__).parent
OUT = ROOT / "huntx_slp_grid_results.json"
SEL = ["2026-09-04", "2026-09-07", "2026-09-10"]
CONF = ["2026-09-13", "2026-09-16", "2026-09-19"]
HORIZON = 9
WIDTHS = {"w1": "fixed:0.01", "w1.5": "fixed:0.015", "w2.5": "fixed:0.025", "vol": "vol:1.0:0.015:0.06"}
KS = (5, 8)
REF = ("w2.5", 5)


def end_of(start):
    return (date.fromisoformat(start) + timedelta(days=HORIZON)).isoformat()


def main():
    bounds, clock, proto, pools = M.setup()
    res = {"runs": {}}
    prog = ROOT / "huntx_slp_grid_progress.log"
    for start in SEL + CONF:
        for wk, mode in WIDTHS.items():
            for K in KS:
                key = f"{wk}|K{K}|{start}"
                r = SC.run_vault(pools, bounds, proto, start, end_of(start), K, mode)
                res["runs"][key] = r
                with prog.open("a") as fh:
                    fh.write(f"{key} net {r['net_usd']:+.3f} sleeves {r['sleeves']} rebands {r['rebands']}\n")
        OUT.write_text(json.dumps(res, indent=1))
    # selection / confirmation
    summ = {}
    for wk in WIDTHS:
        for K in KS:
            sel = [res["runs"][f"{wk}|K{K}|{s}"]["net_usd"] for s in SEL]
            conf = [res["runs"][f"{wk}|K{K}|{s}"]["net_usd"] for s in CONF]
            summ[f"{wk}|K{K}"] = {"sel_mean": round(statistics.mean(sel), 3), "sel_worst": round(min(sel), 3),
                                  "conf_mean": round(statistics.mean(conf), 3), "conf": [round(x, 3) for x in conf],
                                  "sel": [round(x, 3) for x in sel]}
    ok = {k: v for k, v in summ.items() if v["sel_worst"] > -4.0}          # worst start > -2% of $200
    chosen = max(ok, key=lambda k: ok[k]["sel_mean"]) if ok else None
    ref = f"{REF[0]}|K{REF[1]}"
    beats = sum(a > b for a, b in zip(summ[chosen]["conf"], summ[ref]["conf"])) if chosen else 0
    res["summary"] = summ
    res["selected"] = chosen
    res["verdict"] = {"selected_conf_mean": summ[chosen]["conf_mean"] if chosen else None,
                      "beats_reference_on_conf_starts": beats,
                      "pass": bool(chosen and summ[chosen]["conf_mean"] > 0 and beats >= 2)}
    # SGOV cash sleeve (descriptive): best SGOV/USDG pool by swaps
    sg = [pid for pid, p in pools.items() if V.STOCKS.get(p.token) == "SGOV"]
    if sg:
        pid = max(sg, key=lambda x: len(pools[x].blk))
        cash = {}
        for w in ("fixed:0.005", "fixed:0.01"):
            r = SC.run_vault(pools, bounds, proto, "2026-09-04", "2026-09-28", 1, w, symbols=[pid])
            cash[w] = r
        p = pools[pid]
        T0, T1 = bounds["2026-09-04"], bounds["2026-09-28"]
        got = quote_exact_in(p.meta, not p.q1, int(200e6), T0 - 1)
        out = quote_exact_in(p.meta, p.q1, int(got), T1 - 1)
        cash["hold_sgov"] = {"net_usd": (out or 0) / 1e6 - 200}
        cash["pool"] = pid
        cash["fee_tier"] = p.meta["fee"]
        res["sgov_cash_sleeve"] = cash
        save_cache()
    OUT.write_text(json.dumps(res, indent=1))
    print(json.dumps({"summary": summ, "selected": chosen, "verdict": res["verdict"],
                      "sgov": {k: (v["net_usd"] if isinstance(v, dict) else v) for k, v in res.get("sgov_cash_sleeve", {}).items()}},
                     indent=1))


if __name__ == "__main__":
    main()
