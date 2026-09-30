"""Position-exact validation of the fee model on a local fork (read-only).

Builds replay cases from real H3 bids (OOS ledger) and harvester units (clone
ledger) whose price entered the range. Each case is a window of up to 300 swaps
from the decision block in which no other LP changed liquidity in that pool
(the replay cannot reproduce other LPs' moves). Forge then mints our position
on a fork, replays the swaps with our liquidity present and records the fees
actually accrued. Those are compared with the model's prediction for the
same L, range and swaps. ERC-20-quoted, unhooked pools only.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import random
import subprocess
from pathlib import Path

import numpy as np

import feex_next_day_check as fx
import huntx_edge_slice_study as S
import huntx_harvester_clone as C
from huntx_edge_engine import amounts, value_in_quote

ROOT = Path(__file__).parent
PROJ = ROOT / "fork_validation"
FORGE = Path.home() / ".foundry" / "bin" / "forge.exe"
DIRS = ["huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap", "huntx_edge_logs_gap2"]
MAX_SWAPS = 300
N_CASES = int(os.environ.get("HUNTX_CASES", "6"))


def load_pool(pid, metas):
    parts = [np.load(ROOT / d / f"{pid}.npy") for d in DIRS if (ROOT / d / f"{pid}.npy").exists()]
    a = np.concatenate(parts)
    _, first = np.unique(a[:, 0] * 1e6 + a[:, 1], return_index=True)
    a = a[np.sort(first)]
    return S.Pool(pid, metas[pid], a[np.lexsort((a[:, 1], a[:, 0]))])


def main():
    metas = {}
    for d in DIRS:
        metas.update(json.loads((ROOT / d / "meta.json").read_text())["pools"])
    bounds = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    state = json.load(gzip.open(ROOT / "huntx_edge_state_panel.json.gz", "rt"))
    mods = json.load(gzip.open(ROOT / "huntx_lp_population" / "modify.json.gz", "rt"))["rows"]
    mod_blocks = {}
    for r in mods:
        mod_blocks.setdefault(r[2], []).append(r[0])
    for v in mod_blocks.values():
        v.sort()
    cands = []
    for r in json.load(gzip.open(ROOT / "huntx_edge_oos_ledger.json.gz", "rt"))["outcomes"]["H3"]:
        if r.get("fees_usd", 0) > 0.2:
            cands.append(("bid", r["pool_id"], r["day"]))
    for u in json.load(gzip.open(ROOT / "huntx_harvester_clone_ledger.json.gz", "rt"))["units"]:
        if u.get("fees_usd", 0) > 1:
            cands.append(("centered", u["pool_id"], u["day"]))
    if os.environ.get("HUNTX_SOURCE") == "stock":
        u = json.load(gzip.open(ROOT / "huntx_stock_mgmt_confirm_units.json.gz", "rt"))["selected"]
        kind_s = os.environ.get("HUNTX_KIND", "stock25")
        cands = [(kind_s, r["pool_id"], r["day"]) for r in u if r.get("fees_usd", 0) > 0.5]
    random.Random(4).shuffle(cands)
    only = os.environ.get("HUNTX_KIND")
    if only:
        cands = [c for c in cands if c[0] == only]
    cases, model = [], []
    seen = set()
    for kind, pid, day in cands:
        if len(cases) >= N_CASES:
            break
        m = metas.get(pid)
        if not m or m["hooks"] != S.NATIVE or m["currency0"] == S.NATIVE or (pid, day) in seen:
            continue
        pool = load_pool(pid, metas)
        A = bounds[day]
        s = pool.sqrt_before(A)
        if s is None:
            continue
        V = 100e6 if pool.quote == S.USDG else 100 / 2600 * 1e18
        if kind == "stock10":
            sa, sb, ta, tb = __import__("huntx_edge_engine").snap_range(s, 1 / 1.01, 1.01, pool.spacing, pool.q1)
        elif kind == "stock25":
            sa, sb, ta, tb = __import__("huntx_edge_engine").snap_range(s, 1 / 1.025, 1.025, pool.spacing, pool.q1)
        elif kind == "bid":
            sa, sb, ta, tb = S.bid_range(pool, s, *S.BID_RANGE)
        else:
            sa, sb, ta, tb = __import__("huntx_edge_engine").snap_range(s, *C.RANGE, pool.spacing, pool.q1)
        u0, u1 = amounts(1.0, s, sa, sb)
        L = int(V / value_in_quote(u0, u1, s, pool.q1))
        i0 = pool.idx(A)
        # window end: stop before the next foreign liquidity change or after MAX_SWAPS
        blocks = mod_blocks.get(pid, [])
        nxt = next((b for b in blocks if b >= A), None)
        i1 = min(i0 + MAX_SWAPS, len(pool.blk))
        if nxt is not None:
            i1 = min(i1, int(np.searchsorted(pool.blk, nxt, side="left")))
        if i1 - i0 < 10:
            continue
        path = pool.sq[i0:i1]
        if not ((path >= sa) & (path <= sb)).any():
            continue                                   # price never entered the range: nothing to validate
        z = (pool.a0[i0:i1] < 0).tolist()
        amt = [int(-a0) if a0 < 0 else int(-a1) for a0, a1 in zip(pool.a0[i0:i1], pool.a1[i0:i1])]
        end_block = int(pool.blk[i1 - 1]) + 1
        rec = state["state"].get(pid, {}).get(day, {})
        p = rec.get("proto", 0)
        f0, f1, _, _ = pool.fees(A, end_block, sa, sb, float(L), p & 0xFFF, p >> 12, s)
        d0, d1 = amounts(float(L), s, sa, sb)
        # worst running shortfall per token over the replay (outputs are received back), + deposit + buffer
        c0 = np.cumsum(pool.a0[i0:i1]); c1 = np.cumsum(pool.a1[i0:i1])
        short0, short1 = max(0.0, -float(c0.min())), max(0.0, -float(c1.min()))
        gross0 = sum(a for a, zz in zip(amt, z) if zz)
        gross1 = sum(a for a, zz in zip(amt, z) if not zz)
        need0 = int((d0 + short0) * 1.3 + 0.05 * gross0) + 1
        need1 = int((d1 + short1) * 1.3 + 0.05 * gross1) + 1
        cases.append({"kind": kind, "pool_id": pid, "day": day, "fork_block": A - 1, "need0": need0, "need1": need1,
                      "c0": m["currency0"], "c1": m["currency1"], "fee": m["fee"], "spacing": m["tick_spacing"],
                      "tick_lower": ta, "tick_upper": tb, "liquidity": L,
                      "zero_for_one": z, "amount_in": amt})
        model.append({"kind": kind, "pool_id": pid, "day": day, "model_fee0": f0, "model_fee1": f1,
                      "swaps": i1 - i0, "end_sqrt": float(pool.sq[i1 - 1]), "q1": pool.q1})
        seen.add((pid, day))
    (PROJ / "cases.json").write_text(json.dumps({"n": len(cases), "cases": cases}))
    print("cases", len(cases), [(c["kind"], c["pool_id"][:8], len(c["amount_in"])) for c in cases], flush=True)
    env = dict(os.environ, HUNTX_FORK_RPC=fx.ENDPOINT)
    proc = subprocess.run([str(FORGE), "test", "--match-test", "test_replay", "-vv",
                           "--rpc-url", fx.ENDPOINT, "--compute-units-per-second", "600", "--fork-retries", "10", "--fork-retry-backoff", "1500"],
                          cwd=PROJ, env=env,
                          capture_output=True, text=True, timeout=5400)
    tail = (proc.stdout + proc.stderr)[-3000:].replace(fx.ENDPOINT, "<rpc>")
    print(tail, flush=True)
    rows = []
    res = (PROJ / "results.csv").read_text().strip().splitlines() if (PROJ / "results.csv").exists() else []
    for line in res:
        i, a0, a1, failed, n = (int(x) for x in line.split(","))
        mdl = model[i]
        s_end = mdl["end_sqrt"]
        actual_v = value_in_quote(a0, a1, s_end, mdl["q1"])
        model_v = value_in_quote(mdl["model_fee0"], mdl["model_fee1"], s_end, mdl["q1"])
        rows.append({**mdl, "fork_fee0": a0, "fork_fee1": a1, "failed_swaps": failed, "replayed": n,
                     "ratio_model_to_fork": (model_v / actual_v) if actual_v > 0 else None})
    out = {"method": __doc__.strip(), "cases": rows}
    tag = os.environ.get("HUNTX_KIND", "mixed")
    (ROOT / f"huntx_fork_fee_validation_{tag}.json").write_text(json.dumps(out, indent=1))
    for r in rows:
        print(r["kind"], r["pool_id"][:10], "swaps", r["swaps"], "failed", r["failed_swaps"],
              "model/fork", None if r["ratio_model_to_fork"] is None else round(r["ratio_model_to_fork"], 4))
    ok = [r["ratio_model_to_fork"] for r in rows if r["ratio_model_to_fork"]]
    if ok:
        print("median model/fork", round(sorted(ok)[len(ok) // 2], 4), "range", round(min(ok), 4), round(max(ok), 4))


if __name__ == "__main__":
    main()
