"""State panel (Amendment A1): slot0 + feeGrowthGlobals at every UTC boundary.

For every unhooked pool nominated by the activity screen (pre-registered volume
rule), read archive state at block (boundary - 1) for each day from pool
initialization on. Batched JSON-RPC throttled under the 50 req/s provider cap.
Output feeds the conservative log-stage prefilter and the C0 control; it is
not an outcome.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import time
from pathlib import Path

import requests
from eth_abi import decode, encode
from web3 import Web3

import feex_next_day_check as fx
from huntx_edge_chain import Q128, STATE_VIEW, USDG, WETH

ROOT = Path(__file__).parent
SCREEN = ROOT / "huntx_edge_activity_screen.json"
OUT = ROOT / "huntx_edge_state_panel.json.gz"
CHECKPOINT = ROOT / "huntx_edge_state_panel.partial.json.gz"
NATIVE = "0x" + "0" * 40
USD_FLOOR = float(os.environ.get("HUNTX_USD_FLOOR", "5000"))   # A1 default; A2 lean = 20000
ETH_FLOOR = float(os.environ.get("HUNTX_ETH_FLOOR", "1.5"))    # A2 lean = 6
FIRST_DAY = os.environ.get("HUNTX_FIRST_DAY", "")               # A2 pilot slice, e.g. 2026-09-16
LAST_DAY = os.environ.get("HUNTX_LAST_DAY", "")                 # A3 early window end
S0_MODE = os.environ.get("HUNTX_S0_MODE", "all")                # A3 "ends": slot0 at first/last day only
DRY_RUN = os.environ.get("HUNTX_DRY_RUN") == "1"
RATE = int(os.environ.get("HUNTX_RPC_RATE", "40"))  # calls/s; keep ~80% of the endpoint cap
SEL_S0 = Web3.keccak(text="getSlot0(bytes32)")[:4].hex().removeprefix("0x")
SEL_FG = Web3.keccak(text="getFeeGrowthGlobals(bytes32)")[:4].hex().removeprefix("0x")


def panel_rule(screen):
    b = screen["day_bounds"]
    keys = sorted(b)
    frac = screen["window_blocks"] * 6 / ((b[keys[-1]] - b[keys[0]]) / (len(keys) - 1))
    chosen = []
    for p in screen["pools"]:
        # "estimated day volume" = mean sampled volume per active sampled day / sampling fraction
        est = p["sampled_quote_volume"] / p["active_days"] / frac
        floor = USD_FLOOR if p["quote"] == "USDG" else ETH_FLOOR
        if p["active_days"] >= 3 and est >= floor:
            chosen.append({**p, "est_day_volume": est})
    return chosen


def batch_call(calls):
    """calls: list of (id, data, block). Returns {id: hex}. Retries missing ids."""
    out = {}
    pending = calls
    for attempt in range(6):
        if not pending:
            break
        payload = [{"jsonrpc": "2.0", "id": i, "method": "eth_call",
                    "params": [{"to": STATE_VIEW, "data": data}, hex(block)]} for i, data, block in pending]
        t0 = time.time()
        try:
            resp = requests.post(fx.ENDPOINT, json=payload, timeout=60, verify=fx.TLS_VERIFY).json()
        except (requests.RequestException, ValueError):
            resp = []
        for item in resp if isinstance(resp, list) else []:
            if "result" in item:
                out[item["id"]] = item["result"]
        pending = [c for c in pending if c[0] not in out]
        time.sleep(max(0.0, len(payload) / RATE - (time.time() - t0)) + (attempt * 0.5 if pending else 0))
    if pending:
        raise RuntimeError(f"{len(pending)} state reads failed after retries")
    return out


def main():
    screen = json.loads(SCREEN.read_text())
    bounds = screen["day_bounds"]
    days = sorted(bounds)
    pools = panel_rule(screen)
    unhooked = [p for p in pools if p["hooks"] == NATIVE]
    rejected = [{"pool_id": p["pool_id"], "quote": p["quote"], "reason": "G2 hooked pool: UNVERIFIED",
                 "hooks": p["hooks"], "est_day_volume": p["est_day_volume"]} for p in pools if p["hooks"] != NATIVE]
    calls, index = [], {}
    n = 0
    for p in unhooked:
        pid = bytes.fromhex(p["pool_id"][2:])
        for d in days:
            if (FIRST_DAY and d < FIRST_DAY) or (LAST_DAY and d > LAST_DAY):
                continue
            blk = bounds[d] - 1
            if blk < p["init_block"]:
                continue
            first_live = max(FIRST_DAY or days[0], min(x for x in days if bounds[x] - 1 >= p["init_block"]))
            s0_here = S0_MODE != "ends" or d in (first_live, LAST_DAY or days[-1])
            for kind, sel in ((("s0", SEL_S0),) if s0_here else ()) + (("fg", SEL_FG),):
                calls.append((n, "0x" + sel + encode(["bytes32"], [pid]).hex(), blk))
                index[n] = (p["pool_id"], d, kind)
                n += 1
    print(json.dumps({"panel": len(pools), "unhooked": len(unhooked), "hooked_rejected": len(rejected),
                      "calls": len(calls), "eta_min": round(len(calls) / RATE / 60, 1)}), flush=True)
    # Checkpointed: reads already paid for are never repeated. Hard request budget per run.
    budget = int(os.environ.get("HUNTX_RPC_BUDGET", "0"))
    state = {p["pool_id"]: {} for p in unhooked}
    if CHECKPOINT.exists():
        for pid, recs in json.load(gzip.open(CHECKPOINT, "rt", encoding="utf-8")).items():
            if pid in state:
                state[pid] = recs
    have = lambda c: index[c[0]][2] in ("s0", "fg") and (
        ("sqrt" if index[c[0]][2] == "s0" else "g0") in state[index[c[0]][0]].get(index[c[0]][1], {}))
    calls = [c for c in calls if not have(c)]
    if budget:
        calls = calls[:budget]
    print(json.dumps({"remaining_this_run": len(calls), "budget": budget or None}), flush=True)
    if DRY_RUN:
        return
    step = RATE
    t_start = time.time()

    def checkpoint():
        with gzip.open(CHECKPOINT, "wt", encoding="utf-8") as fh:
            json.dump(state, fh, separators=(",", ":"))
    for k in range(0, len(calls), step):
        res = batch_call(calls[k:k + step])
        for i, raw in res.items():
            pid, d, kind = index[i]
            data = bytes.fromhex(raw[2:])
            rec = state[pid].setdefault(d, {})
            if kind == "s0":
                s, tick, proto, lp = decode(["uint160", "int24", "uint24", "uint24"], data)
                rec.update(sqrt=str(s), tick=tick, proto=proto, lp_fee=lp)
            else:
                g0, g1 = decode(["uint256", "uint256"], data)
                rec.update(g0=str(g0), g1=str(g1))
        if (k // step) % 50 == 0:
            checkpoint()
            print(f"{k + step}/{len(calls)} {round((time.time() - t_start) / 60, 1)} min", flush=True)
    checkpoint()
    payload = {"method": __doc__.strip(), "day_bounds": bounds, "pools": {p["pool_id"]: p for p in unhooked},
               "rejected_hooked": rejected, "state": state}
    with gzip.open(OUT, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print("done", len(unhooked), flush=True)


if __name__ == "__main__":
    main()
