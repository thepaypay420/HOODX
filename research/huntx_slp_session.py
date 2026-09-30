"""A22: session-aware width (W1, W2) vs B0 and B2 on the A18 windows."""
import json, statistics
from pathlib import Path
import huntx_slp_beta as B
import huntx_slp_continuous as SC
import huntx_stock_mgmt as M
from huntx_edge_engine import save_cache

ROOT = Path(__file__).parent
VARS = {"B0": "fixed:0.01", "B2": "skew:0.985:1.005", "W1": "session:0.005:0.015", "W2": "session:0.005:0.01"}


def main():
    bounds, clock, proto, pools = M.setup()
    res = {}
    for start, end, tag in B.windows():
        ids = B.picks_at(pools, bounds, proto, start)
        row = {"tag": tag}
        for k, mode in VARS.items():
            r = SC.run_vault(pools, bounds, proto, start, end, 8, mode, symbols=ids)
            row[k] = round(r["net_usd"], 3)
        res[start] = row
        save_cache()
        print(start, json.dumps(row), flush=True)
    summ = {}
    conf_keys = [s for s in res if res[s]["tag"] in ("conf", "down")]
    for k in VARS:
        conf = [res[s][k] for s in conf_keys]
        summ[k] = {"sel_mean": round(statistics.mean(res[s][k] for s in res if res[s]["tag"] == "sel"), 3),
                   "conf_mean": round(statistics.mean(conf), 3), "worst": round(min(res[s][k] for s in res), 3),
                   "down": res["2026-09-20"][k]}
    b2 = summ["B2"]
    for k in ("W1", "W2"):
        summ[k]["replaces_B2"] = bool(summ[k]["conf_mean"] >= b2["conf_mean"] + 0.5 and summ[k]["worst"] >= b2["worst"]
                                      and summ[k]["down"] >= b2["down"])
    (ROOT / "huntx_slp_session_results.json").write_text(json.dumps({"windows": res, "summary": summ}, indent=1))
    print("SUMMARY", json.dumps(summ), flush=True)


if __name__ == "__main__":
    main()
