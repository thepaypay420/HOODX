"""Amendment A1 prefilter from the state panel (offline, zero RPC).

Per pool and UTC day: upper-bound fee yield per $ of a range position that
stays in range all day = global fee-growth delta x liquidity-per-$. A pool is
sent to the complete-log stage if, on any scorable decision day D:
    3 * mean(bound[D-3..D-1]) >= 0.9 * pool_fee      (H1/H3/H5/H6 necessary)
 or bound[D-1] >= 0.9 * pool_fee                    (H2 necessary)
Every pool/day decision and rejection reason is written out.
"""

from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

from huntx_edge_chain import Q128, USDG, WETH
from huntx_edge_engine import amounts, snap_range, value_in_quote

ROOT = Path(__file__).parent
STATE = ROOT / "huntx_edge_state_panel.json.gz"
OUT = ROOT / "huntx_edge_prefilter.json"
NATIVE = "0x" + "0" * 40
MAJORS = {USDG, WETH, NATIVE}
PASS_MULT = 0.9


def quote_side(meta):
    c0, c1 = meta["currency0"], meta["currency1"]
    quote = USDG if USDG in (c0, c1) else WETH if WETH in (c0, c1) else NATIVE
    return quote, c1 == quote, (c0 if c1 == quote else c1)


def main():
    src = json.load(gzip.open(STATE, "rt", encoding="utf-8"))
    bounds = src["day_bounds"]
    days = sorted(d for d in bounds)
    out_pools = {}
    passed = []
    for pid, meta in src["pools"].items():
        st = src["state"].get(pid, {})
        quote, q1, token = quote_side(meta)
        major = token in MAJORS
        lo, hi = (1 / 1.05, 1.05) if major else (1 / 1.25, 1.25)
        daily = {}
        have = sorted(d for d in st if "g0" in st[d] and "sqrt" in st[d] and int(st[d]["sqrt"]) > 0)
        for a, b in zip(have, have[1:]):
            if days.index(b) - days.index(a) != 1:
                continue
            s0, s1 = int(st[a]["sqrt"]) / 2**96, int(st[b]["sqrt"]) / 2**96
            dg0 = ((int(st[b]["g0"]) - int(st[a]["g0"])) % 2**256) / Q128
            dg1 = ((int(st[b]["g1"]) - int(st[a]["g1"])) % 2**256) / Q128
            sa, sb, _, _ = snap_range(s0, lo, hi, meta["tick_spacing"], q1)
            u0, u1 = amounts(1.0, s0, sa, sb)
            uval = value_in_quote(u0, u1, s0, q1)
            fee_val = value_in_quote(dg0, dg1, s1, q1)
            if uval > 0 and math.isfinite(fee_val / uval):
                daily[a] = {"bound": fee_val / uval,
                            "price_ratio": (s1 / s0) ** (2 if q1 else -2)}
        fee = meta["fee"] / 1e6
        verdicts = {}
        for d_idx in range(3, len(days)):
            d = days[d_idx]
            if meta["fee"] == 0:
                verdicts[d] = "zero LP fee: cannot pay an LP"
                continue
            trail = [days[d_idx - k] for k in (3, 2, 1)]
            if not all(t in daily for t in trail):
                verdicts[d] = "no 3d state history"
                continue
            b = [daily[t]["bound"] for t in trail]
            h1 = 3 * sum(b) / 3 >= PASS_MULT * fee
            h2 = b[-1] >= PASS_MULT * fee
            verdicts[d] = "pass" if (h1 or h2) else (
                f"fee bound 3d {sum(b):.4f} and 1d {b[-1]:.4f} < {PASS_MULT} x fee {fee:.4f}")
        out_pools[pid] = {"quote": quote, "token": token, "fee": meta["fee"], "major": major,
                          "est_day_volume": meta.get("est_day_volume"), "daily_bound": daily,
                          "verdicts": verdicts}
        if any(v == "pass" for v in verdicts.values()):
            passed.append(pid)
    OUT.write_text(json.dumps({"method": __doc__.strip(), "pools_evaluated": len(out_pools),
                               "passed": passed, "rejected_hooked": src["rejected_hooked"],
                               "pools": out_pools}, indent=1))
    per_day = {}
    for p in out_pools.values():
        for d, v in p["verdicts"].items():
            per_day.setdefault(d, [0, 0])[v == "pass"] += 1
    print(json.dumps({"pools": len(out_pools), "passed_any_day": len(passed),
                      "per_day_[fail,pass]": per_day}, indent=1))


if __name__ == "__main__":
    main()
