#!/usr/bin/env python3
"""Print 696 watchlist weights + smart floor. Look-only. Does not spend ETH."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import CASH_TARGET, ISSUE_FEE_BPS, MIN_SLEEVE_USD
from weights import active_book, allocate, usd_sleeves


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="696 RH index weights")
    parser.add_argument("--nav", type=float, default=200.0, help="USD to size sleeves")
    parser.add_argument("--min-sleeve", type=float, default=MIN_SLEEVE_USD)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--write-web",
        action="store_true",
        help="Write public/sleeves.json for the HUD 696-list column",
    )
    args = parser.parse_args(argv)
    plan = allocate()
    book = active_book(args.nav, min_sleeve_usd=args.min_sleeve, plan=plan)
    if args.write_web:
        out = _ROOT / "public" / "sleeves.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            **plan,
            "dropped": plan.get("skipped") or [],
            "book": book,
            "policySleeves": usd_sleeves(args.nav, plan),
        }
        out.write_text(json.dumps(payload, indent=2))
        print(f"wrote {out}")
        return 0
    if args.json:
        print(json.dumps({**plan, **book, "sleeves": usd_sleeves(args.nav, plan)}, indent=2))
        return 0
    print(
        f"policy={plan['policy']} cap={plan['cap']:.0%} floor={plan['floor']:.0%} "
        f"tradeable={plan['nTradeable']}/{plan['nListed']} sum={plan['weightSum']:.4f}"
    )
    for skip in plan["skipped"]:
        print(f"  skip {skip['id']}: {skip['reason']}")
    print(
        f"NAV ${args.nav:.0f}  minSleeve ${args.min_sleeve:.0f}  "
        f"cash {book['cashWeight']*100:.1f}% (${book['cashUsd']:.2f})  "
        f"issue {ISSUE_FEE_BPS} bps  cashTarget {CASH_TARGET:.0%}"
    )
    print(f"{'id':<14} {'w%':>6} {'usd':>9}  status")
    for s in book["active"]:
        print(f"{s['id']:<14} {s['weight']*100:6.2f} {s['usd']:9.2f}  HOLD")
    for s in book["skipped"]:
        print(f"{s['id']:<14} {s['policyWeight']*100:6.2f} {s['policyUsd']:9.2f}  FLOOR→WETH")
    print("Look-only. 696X + factory. Users ape ETH; dust stays cash; Uni pool later.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
