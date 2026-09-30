"""A23: weekly rotation (R1) vs static B0, both with best-pool routing, 14-day windows."""
import json, statistics
from datetime import date, timedelta
from pathlib import Path
import numpy as np
import huntx_slp_continuous as SC
import huntx_slp_depth as D
import huntx_stock_mgmt as M
import huntx_stock_vault as V
from huntx_edge_engine import save_cache

ROOT = Path(__file__).parent
STARTS = ["2026-09-04", "2026-09-07", "2026-09-10", "2026-09-13"]
H = SC.H


def ranked(pools, bounds, proto, day):
    best = {}
    for pid in V.eligible(pools, bounds, day):
        y = M.trailing_yield25(pools[pid], bounds, day, proto)
        sym = V.STOCKS[pools[pid].token]
        if y is not None and (sym not in best or y > best[sym][0]):
            best[sym] = (y, pid)
    return [(sym, pid) for sym, (y, pid) in sorted(best.items(), key=lambda kv: -kv[1][0])]


def run(pools, bounds, proto, start, end, rotate):
    import datetime as _dt
    days = sorted(bounds)
    SC.DAYS = days
    SC.DAY_BLOCKS = np.array([bounds[d] for d in days])
    SC.DAY_TS = np.array([_dt.datetime.fromisoformat(d).replace(tzinfo=_dt.timezone.utc).timestamp() for d in days])
    rk = ranked(pools, bounds, proto, start)[:8]
    routes = D.routes_for(pools, [pid for _, pid in rk])
    held = {sym: SC.Sleeve(pools[pid], "fixed:0.01", 200 / 8, bounds[start], proto, route=routes[pid])
            for sym, pid in rk}
    cash, realized = 0.0, 0.0
    T0, T1 = bounds[start], bounds[end]
    rot_day = (date.fromisoformat(start) + timedelta(days=7)).isoformat()
    t = T0
    rotations = 0
    while t < T1:
        t2 = min(t + H, T1)
        daily = any(bounds[d] <= t2 < bounds[d] + H for d in days if start < d < end)
        for sl in held.values():
            sl.step(t, t2, daily)
        if rotate and rot_day in bounds and t < bounds[rot_day] <= t2:
            top = ranked(pools, bounds, proto, rot_day)
            top12 = {s for s, _ in top[:12]}
            for sym in [s for s in held if s not in top12]:
                cash += held.pop(sym).close(bounds[rot_day])
                rotations += 1
            free = 8 - len(held)
            if free and cash > 0:
                new = [(s, pid) for s, pid in top if s not in held][:free]
                each = cash / max(1, len(new))
                r2 = D.routes_for(pools, [pid for _, pid in new])
                for s, pid in new:
                    try:
                        held[s] = SC.Sleeve(pools[pid], "fixed:0.01", each, bounds[rot_day], proto, route=r2[pid])
                        cash -= each
                    except RuntimeError:
                        pass
        t = t2
    final = sum(sl.close(T1) for sl in held.values()) + cash
    save_cache()
    return {"net_usd": round(final - 200, 3), "rotations": rotations, "held": sorted(held)}


def main():
    bounds, clock, proto, pools = M.setup()
    res = {}
    for s in STARTS:
        e = (date.fromisoformat(s) + timedelta(days=14)).isoformat()
        b0 = run(pools, bounds, proto, s, e, False)
        r1 = run(pools, bounds, proto, s, e, True)
        res[s] = {"B0": b0["net_usd"], "R1": r1["net_usd"], "rotations": r1["rotations"]}
        print(s, json.dumps(res[s]), flush=True)
    b0v = [res[s]["B0"] for s in res]
    r1v = [res[s]["R1"] for s in res]
    summ = {"B0_mean": round(statistics.mean(b0v), 3), "B0_worst": min(b0v),
            "R1_mean": round(statistics.mean(r1v), 3), "R1_worst": min(r1v)}
    summ["pass"] = summ["R1_mean"] >= summ["B0_mean"] + 0.5 and summ["R1_worst"] >= summ["B0_worst"]
    (ROOT / "huntx_slp_rotation_results.json").write_text(json.dumps({"windows": res, "summary": summ}, indent=1))
    print("SUMMARY", json.dumps(summ), flush=True)


if __name__ == "__main__":
    main()
