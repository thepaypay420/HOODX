"""Validate the event-based fee model against on-chain V4 fee growth (read-only).

For each of the six cached pools and each complete UTC day, compare
  (a) sum over Swap logs of LP_fee_in_token / active_liquidity  (Q128 units)
  (b) StateView.getFeeGrowthGlobals delta between the day's boundary blocks.
Two sign conventions are tested: fees taken from the NEGATIVE amount (V4
caller-perspective delta: caller pays) versus the POSITIVE amount (what the
cached replay `krystal_multi_pool_lp_replay.py` used). The convention whose
prediction matches (b) is the correct decoding. Protocol fee comes from slot0.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from huntx_edge_chain import Q128, fee_growth_globals, pool_key, slot0
from krystal_multi_pool_flow import POOLS

ROOT = Path(__file__).parent
SRC = ROOT / "krystal_multi_pool_swaps_7d.json.gz"
OUT = ROOT / "huntx_edge_fee_validation.json"


def predicted(swaps, proto0, proto1, convention):
    g0 = g1 = 0
    for s in swaps:
        a0, a1, fee, liq = s["amount0"], s["amount1"], s["fee_ppm"], s["liquidity"]
        if liq == 0:
            continue
        # Input token: caller-perspective negative delta ("neg") or positive ("pos").
        zero_in = (a0 < 0) if convention == "neg" else (a0 > 0)
        gross = abs(a0) if zero_in else abs(a1)
        if convention == "pos":
            gross = a0 if zero_in else a1
        proto = proto0 if zero_in else proto1
        lp_fee = gross * max(fee - proto, 0) // 1_000_000
        if zero_in:
            g0 += lp_fee * Q128 // liq
        else:
            g1 += lp_fee * Q128 // liq
    return g0, g1


def main():
    src = json.load(gzip.open(SRC, "rt", encoding="utf-8"))
    bounds = src["boundaries"]
    out = {"method": __doc__.strip(), "pools": {}}
    for name, (pid, _) in POOLS.items():
        key = pool_key(pid)
        s0 = slot0(pid, bounds[0] - 1)
        swaps = src["pools"][name]
        rows = []
        for d in range(7):
            day = [s for s in swaps if s["day_index"] == d]
            a = fee_growth_globals(pid, bounds[d] - 1)
            b = fee_growth_globals(pid, bounds[d + 1] - 1)
            actual = ((b[0] - a[0]) % 2**256, (b[1] - a[1]) % 2**256)
            row = {"day": d, "swaps": len(day), "actual_q128": [str(x) for x in actual]}
            for conv in ("neg", "pos"):
                p = predicted(day, s0["protocol_fee_0for1"], s0["protocol_fee_1for0"], conv)
                row[conv + "_ratio"] = [round(p[i] / actual[i], 4) if actual[i] else None for i in (0, 1)]
            rows.append(row)
        out["pools"][name] = {"pool_key": key, "slot0_at_start": s0, "days": rows}
        print(name, key["fee"], hex(key["fee"]), key["tick_spacing"], key["hooks"][:12],
              "proto", s0["protocol_fee_0for1"], s0["protocol_fee_1for0"], "lpFee", s0["lp_fee"])
        for r in rows:
            print("   day", r["day"], r["swaps"], "neg", r["neg_ratio"], "pos", r["pos_ratio"])
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
