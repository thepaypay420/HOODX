"""Loop L1 (Amendment A7): launch-age LP outcomes with per-episode rug marking.

Offline, 0 RPC. Reuses the reconstructed LP population and swap logs.
Valuation rule: an episode opened at a degenerate price (|tick| >= 700k) is
dropped; an episode still open at the window end in a pool that is then
degenerate is a total loss of its remaining value (pnl = fees - deposit).
"""

from __future__ import annotations

import gzip
import json
import math
import os
from pathlib import Path

import numpy as np

import huntx_lp_population_analysis as A

ROOT = Path(__file__).parent
DIRS = ["huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap", "huntx_edge_logs_gap2"]
OUT = ROOT / "huntx_launch_l1.json"
BPD = 857_000
SANE = 700_000
_cache: dict = {}


def tick_at(pid, blk):
    if pid not in _cache:
        parts = [np.load(ROOT / d / f"{pid}.npy") for d in DIRS if (ROOT / d / f"{pid}.npy").exists()]
        if not parts:
            _cache[pid] = None
        else:
            a = np.concatenate(parts)
            a = a[np.lexsort((a[:, 1], a[:, 0]))]
            _cache[pid] = (a[:, 0], a[:, 6])
    if _cache[pid] is None:
        return None
    b, t = _cache[pid]
    i = int(np.searchsorted(b, blk, side="right")) - 1
    return None if i < 0 else t[i]


def valued_episodes():
    eps = json.load(gzip.open(ROOT / "huntx_lp_population" / "episodes.json.gz", "rt"))
    out, dropped, rugged = [], 0, 0
    for e in eps:
        if e.get("contaminated") or not all(math.isfinite(e[k]) for k in
                                           ("dep_usd", "wd_usd", "fee_usd", "pnl_usd", "vs_hold_usd")):
            continue
        to, tc = tick_at(e["pool_id"], e["open_block"]), tick_at(e["pool_id"], e["close_block"])
        if to is None or abs(to) >= SANE:
            dropped += 1
            continue
        if tc is None or abs(tc) >= SANE:
            if e["status"] == "closed":
                dropped += 1                        # closed at a degenerate mid: cannot value
                continue
            e = dict(e, pnl_usd=e["fee_usd"] - e["dep_usd"], vs_hold_usd=e["fee_usd"] - e["dep_usd"], rugged=True)
            rugged += 1
        if A.MIN_DEP <= e["dep_usd"] <= A.MAX_DEP:
            out.append(e)
    return out, dropped, rugged


def age_bucket(e, init):
    a = (e["open_block"] - init[e["pool_id"]]) / BPD
    return "<1h" if a < 1 / 24 else "1-6h" if a < 0.25 else "6-24h" if a < 1 else "1-3d" if a < 3 else \
        "3-7d" if a < 7 else ">7d"


def hold_bucket(e):
    h = e["blocks_held"] / 35_700
    return "<15m" if h < 0.25 else "15m-2h" if h < 2 else "2-12h" if h < 12 else ">12h"


def main():
    reg = {p["pool_id"]: p["init_block"] for p in json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz", "rt"))["pools"]}
    eps, dropped, rugged = valued_episodes()
    split = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]["2026-09-15"]
    halves = {"disc": [e for e in eps if e["open_block"] < split], "test": [e for e in eps if e["open_block"] >= split]}
    res = {"method": __doc__.strip(), "valued": len(eps), "dropped_unvaluable": dropped,
           "open_in_drained_marked_total_loss": rugged, "age": {}, "shape_in_first_hour": {}}
    for b in ("<1h", "1-6h", "6-24h", "1-3d", "3-7d", ">7d"):
        res["age"][b] = {h: A.describe([e for e in v if age_bucket(e, reg) == b]) for h, v in halves.items()}
        for h, v in halves.items():
            res["age"][b][h]["rugged_share"] = round(
                sum(bool(e.get("rugged")) for e in v if age_bucket(e, reg) == b) /
                max(1, sum(1 for e in v if age_bucket(e, reg) == b)), 4)
    for dim, fn in (("side", A.side_bucket), ("width", A.width_bucket), ("hold", hold_bucket)):
        tab = {}
        for lab in sorted({fn(e) for e in eps}):
            tab[lab] = {h: A.describe([e for e in v if age_bucket(e, reg) == "<1h" and fn(e) == lab])
                        for h, v in halves.items()}
        res["shape_in_first_hour"][dim] = tab
    # joint side x width cells inside <1h, ranked on discovery
    cells = {}
    for e in eps:
        if age_bucket(e, reg) != "<1h":
            continue
        k = f"{A.side_bucket(e)}|{A.width_bucket(e)}|{hold_bucket(e)}"
        cells.setdefault(k, {"disc": [], "test": []})["disc" if e["open_block"] < split else "test"].append(e)
    ranked = sorted(((A.wret(v["disc"]), k, len(v["disc"]), A.wret(v["test"]), len(v["test"]))
                     for k, v in cells.items() if len(v["disc"]) >= 300 and len(v["test"]) >= 100),
                    key=lambda x: -(x[0] or -9))
    res["first_hour_cells_ranked_on_disc"] = [{"cell": k, "disc_n": n1, "disc_vs_usd": r1, "test_n": n2,
                                               "test_vs_usd": r2} for r1, k, n1, r2, n2 in ranked[:12]]
    OUT.write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps({k: res[k] for k in ("valued", "dropped_unvaluable", "open_in_drained_marked_total_loss")}))
    for b, v in res["age"].items():
        print(f"{b:6} disc n={v['disc'].get('n',0):7} vsUSD={v['disc'].get('ret_vs_usd')} rug={v['disc']['rugged_share']} | "
              f"test n={v['test'].get('n',0):7} vsUSD={v['test'].get('ret_vs_usd')} rug={v['test']['rugged_share']}")
    for dim, tab in res["shape_in_first_hour"].items():
        print("\n<1h by", dim)
        for lab, v in tab.items():
            print(f"   {lab:16} disc n={v['disc'].get('n',0):6} vsUSD={v['disc'].get('ret_vs_usd')} | "
                  f"test n={v['test'].get('n',0):6} vsUSD={v['test'].get('ret_vs_usd')}")
    print("\ncells ranked on discovery:")
    for c in res["first_hour_cells_ranked_on_disc"]:
        print("  ", c)


if __name__ == "__main__":
    main()
