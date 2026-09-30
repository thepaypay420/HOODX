"""A24: breadth for capacity. K8 vs K12 vs K16 at $2k / $10k / $20k (pre-registered, see prereg doc)."""
import json, statistics, sys
from pathlib import Path
import requests
import huntx_slp_beta as B
import huntx_slp_continuous as SC
import huntx_slp_depth as D
import huntx_stock_mgmt as M
from huntx_edge_engine import save_cache

ROOT = Path(__file__).parent
RPC_BUDGET = 9_000
_calls = {"n": 0}
_post = requests.post


def _counted_post(*a, **k):
    _calls["n"] += 1
    if _calls["n"] > RPC_BUDGET:
        save_cache()
        sys.exit("RPC budget reached; cache saved")
    return _post(*a, **k)


requests.post = _counted_post
KS = (8, 12, 16)
CAPS = (2000.0, 10000.0, 20000.0)


def main():
    bounds, clock, proto, pools = M.setup()
    res = {}
    for start, end, tag in B.windows():
        row = {"tag": tag}
        for cap in CAPS:
            for k in KS:
                ids = D.depth_picks(pools, bounds, proto, start, cap, k=k)
                r = SC.run_vault(pools, bounds, proto, start, end, k, "fixed:0.01", capital=cap, symbols=ids,
                                 routes=D.routes_for(pools, ids))
                row[f"K{k}_{int(cap)}_pct"] = round(100 * r["net_usd"] / cap, 3)
                row[f"K{k}_{int(cap)}_n"] = len(ids)
        res[start] = row
        save_cache()
        print(start, tag, json.dumps({k: v for k, v in row.items() if k.endswith("pct")}), "rpc", _calls["n"], flush=True)
    summ, verdict = {}, {}
    for cap in CAPS:
        c = int(cap)
        for k in KS:
            name = f"K{k}_{c}"
            conf = [res[s][f"{name}_pct"] for s in res if res[s]["tag"] != "sel"]
            sel = [res[s][f"{name}_pct"] for s in res if res[s]["tag"] == "sel"]
            summ[name] = {"conf_mean": round(statistics.mean(conf), 3), "conf_worst": round(min(conf), 3),
                          "sel_mean": round(statistics.mean(sel), 3)}
        base = summ[f"K8_{c}"]
        winners = [k for k in KS[1:] if summ[f"K{k}_{c}"]["conf_mean"] >= base["conf_mean"] + 0.25
                   and summ[f"K{k}_{c}"]["conf_worst"] >= base["conf_worst"] - 0.25]
        best = max(winners, key=lambda k: summ[f"K{k}_{c}"]["conf_mean"]) if winners else 8
        verdict[c] = {"adopted_K": best, "ok_for_cap": summ[f"K{best}_{c}"]["conf_mean"] >= 1.5
                      and summ[f"K{best}_{c}"]["conf_worst"] >= -1.0}
    (ROOT / "huntx_slp_breadth_results.json").write_text(
        json.dumps({"windows": res, "summary": summ, "verdict": verdict, "rpc": _calls["n"]}, indent=1))
    print("SUMMARY", json.dumps(summ), flush=True)
    print("VERDICT", json.dumps(verdict), "rpc", _calls["n"], flush=True)


if __name__ == "__main__":
    main()
