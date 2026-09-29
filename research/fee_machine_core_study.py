"""Conservative WETH/USDG ballast-sleeve backtest.

Reads exact historical pool state at each weekly boundary and deliberately gives
the sleeve zero fee income. This produces a reproducible lower bound for the
four-sleeve pilot without a costly full swap-log replay. Read-only: no transaction
is signed or broadcast. LAUNCH_HUNTER_RPC_URL must be supplied by the private runner.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
from pathlib import Path

from eth_abi import decode

from launch_hunter_multicohort_study import rpc

Q96 = 2**96
POOL = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"
SLOT0_SELECTOR = "0x3850c7bd"
FEE_RATE = 0.0001


def amounts_for_liquidity(liquidity: float, sqrt_price: float, sqrt_lower: float, sqrt_upper: float) -> tuple[float, float]:
    if sqrt_price <= sqrt_lower:
        return liquidity * (sqrt_upper - sqrt_lower) / (sqrt_lower * sqrt_upper), 0.0
    if sqrt_price >= sqrt_upper:
        return 0.0, liquidity * (sqrt_upper - sqrt_lower)
    return (
        liquidity * (sqrt_upper - sqrt_price) / (sqrt_price * sqrt_upper),
        liquidity * (sqrt_price - sqrt_lower),
    )


def weth_value(raw0: float, raw1: float, raw_price: float) -> float:
    return raw0 / 1e18 + (raw1 / 1e6) / (raw_price * 1e12)


def slot0(block: int) -> tuple[int, int]:
    raw = rpc("eth_call", [{"to": POOL, "data": SLOT0_SELECTOR}, hex(block)])
    sqrt_price, tick, *_ = decode(
        ["uint160", "int24", "uint16", "uint16", "uint16", "uint8", "bool"], bytes.fromhex(raw[2:])
    )
    return sqrt_price, tick


def simulate(start_block: int, end_block: int, capital_weth: float, action_cost_weth: float) -> dict:
    entry_raw, entry_tick = slot0(start_block)
    final_raw, final_tick = slot0(end_block)
    entry_sqrt = entry_raw / Q96
    final_sqrt = final_raw / Q96
    center = entry_tick
    lower = math.sqrt(1.0001 ** (center - 2_000))
    upper = math.sqrt(1.0001 ** (center + 2_000))
    entry_price = entry_sqrt**2
    unit0, unit1 = amounts_for_liquidity(1.0, entry_sqrt, lower, upper)
    liquidity = capital_weth / weth_value(unit0, unit1, entry_price)
    final0, final1 = amounts_for_liquidity(liquidity, final_sqrt, lower, upper)
    inventory_value = weth_value(final0, final1, final_sqrt**2)
    execution_cost = capital_weth * FEE_RATE + action_cost_weth * 2
    final_value = inventory_value - execution_cost
    return {
        "start_block": start_block,
        "end_block": end_block,
        "entry_tick": entry_tick,
        "final_tick": final_tick,
        "inventory_return_pct": (inventory_value / capital_weth - 1) * 100,
        "gross_fee_return_pct": 0,
        "execution_cost_pct": execution_cost / capital_weth * 100,
        "net_return_lower_bound_pct": (final_value / capital_weth - 1) * 100,
        "method": "historical endpoint inventory with zero fee income",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", type=Path, nargs="+", required=True)
    parser.add_argument("--labels", nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--capital-weth", type=float, default=0.0074)
    parser.add_argument("--action-cost-weth", type=float, default=0.000025)
    args = parser.parse_args()
    if len(args.weeks) != len(args.labels):
        raise SystemExit("weeks and labels must have equal length")
    rows = []
    for path, label in zip(args.weeks, args.labels, strict=True):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            boundaries = json.load(handle)
        rows.append(
            {
                "week": label,
                **simulate(boundaries["from_block"], boundaries["to_block"], args.capital_weth, args.action_cost_weth),
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
