"""Out-of-sample PONS V1 concentrated-liquidity study.

The ranking week and evaluation week are disjoint. Raw archive observations are
kept outside version control; this script emits compact, reviewable evidence.
No transaction is signed or broadcast.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

Q96 = 2**96
FEE_RATE = 0.01
# The canonical PONS V1 pools currently expose feeProtocol=0x66. Each token
# therefore sends one sixth of swap fees to the Uniswap protocol, leaving five
# sixths for active liquidity. Historical feeGrowthGlobal deltas independently
# matched this haircut within the expected tick-crossing approximation error.
LP_FEE_FRACTION = 5 / 6
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"


def load_json_gz(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def price_from_sqrt(raw: int) -> float:
    return (raw / Q96) ** 2


def amounts_for_liquidity(liquidity: float, sqrt_price: float, sqrt_lower: float, sqrt_upper: float) -> tuple[float, float]:
    if sqrt_price <= sqrt_lower:
        return liquidity * (sqrt_upper - sqrt_lower) / (sqrt_lower * sqrt_upper), 0.0
    if sqrt_price >= sqrt_upper:
        return 0.0, liquidity * (sqrt_upper - sqrt_lower)
    return (
        liquidity * (sqrt_upper - sqrt_price) / (sqrt_price * sqrt_upper),
        liquidity * (sqrt_price - sqrt_lower),
    )


def weth_value(amount0: float, amount1: float, price_1_per_0: float, weth_is_token0: bool) -> float:
    if weth_is_token0:
        return amount0 + amount1 / price_1_per_0
    return amount1 + amount0 * price_1_per_0


def simulate_static(swaps: list[dict], weth_is_token0: bool, width: float, capital: float, action_cost: float) -> dict:
    if len(swaps) < 2:
        return {}
    entry_price = price_from_sqrt(int(swaps[0]["sqrt_price_x96"]))
    sqrt_entry = math.sqrt(entry_price)
    sqrt_lower = math.sqrt(entry_price / (1 + width))
    sqrt_upper = math.sqrt(entry_price * (1 + width))
    unit0, unit1 = amounts_for_liquidity(1.0, sqrt_entry, sqrt_lower, sqrt_upper)
    unit_value = weth_value(unit0, unit1, entry_price, weth_is_token0)
    if unit_value <= 0:
        return {}
    liquidity_units = capital / unit_value
    liquidity_raw = liquidity_units * 1e18
    fee0 = fee1 = 0.0
    in_range_swaps = 0
    for swap in swaps:
        sqrt_price = int(swap["sqrt_price_x96"]) / Q96
        if not (sqrt_lower <= sqrt_price <= sqrt_upper):
            continue
        base_liquidity = max(0, int(swap["liquidity"]))
        share = liquidity_raw / (base_liquidity + liquidity_raw) if base_liquidity + liquidity_raw else 0.0
        amount0 = int(swap["amount0"]) / 1e18
        amount1 = int(swap["amount1"]) / 1e18
        if amount0 > 0:
            fee0 += amount0 * FEE_RATE * LP_FEE_FRACTION * share
        if amount1 > 0:
            fee1 += amount1 * FEE_RATE * LP_FEE_FRACTION * share
        in_range_swaps += 1
    final_price = price_from_sqrt(int(swaps[-1]["sqrt_price_x96"]))
    final_sqrt = math.sqrt(final_price)
    amount0, amount1 = amounts_for_liquidity(liquidity_units, final_sqrt, sqrt_lower, sqrt_upper)
    inventory_value = weth_value(amount0, amount1, final_price, weth_is_token0)
    fee_value = weth_value(fee0, fee1, final_price, weth_is_token0)
    # Entering and exiting requires swapping roughly half of the position in a
    # 1% pool. Two position-manager actions are charged separately.
    execution_cost = capital * FEE_RATE + action_cost * 2
    final_value = inventory_value + fee_value - execution_cost
    return {
        "entry_price": entry_price,
        "final_price": final_price,
        "price_return_pct": (final_price / entry_price - 1) * 100,
        "inventory_return_pct": (inventory_value / capital - 1) * 100,
        "gross_fee_return_pct": fee_value / capital * 100,
        "execution_cost_pct": execution_cost / capital * 100,
        "net_return_pct": (final_value / capital - 1) * 100,
        "in_range_swap_share": in_range_swaps / len(swaps),
        "in_range_swaps": in_range_swaps,
        "total_swaps": len(swaps),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--launches", type=Path, required=True)
    parser.add_argument("--ranking-summary", type=Path, required=True)
    parser.add_argument("--ranking-swaps", type=Path, required=True)
    parser.add_argument("--evaluation-swaps", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--capital-per-position", type=float, default=0.01)
    parser.add_argument("--action-cost", type=float, default=0.000025)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    launches = load_json_gz(args.launches)["launches"]
    launch_by_pool = {row["pool"]: row for row in launches}
    ranking = list(csv.DictReader(args.ranking_summary.open(encoding="utf-8")))
    ranking_swaps = load_json_gz(args.ranking_swaps)["swaps"]
    evaluation_swaps = load_json_gz(args.evaluation_swaps)["swaps"]

    prior_senders: dict[str, Counter] = defaultdict(Counter)
    prior_directions = defaultdict(Counter)
    for swap in ranking_swaps:
        pool = swap["pool"]
        prior_senders[pool][swap["sender"]] += 1
        launch = launch_by_pool[pool]
        weth_is_token0 = min(launch["token"], WETH) == WETH
        weth_amount = int(swap["amount0"] if weth_is_token0 else swap["amount1"])
        prior_directions[pool]["weth_in" if weth_amount > 0 else "weth_out"] += 1

    eligible = []
    seen_deployers = set()
    for row in ranking:
        pool = row["pool"]
        swaps = int(row["swaps_7d"])
        senders = int(row["unique_senders_7d"])
        volume = float(row["volume_weth_7d"])
        top_share = prior_senders[pool].most_common(1)[0][1] / swaps if swaps else 1.0
        directions = prior_directions[pool]
        direction_min = min(directions["weth_in"], directions["weth_out"]) / swaps if swaps else 0.0
        deployer = launch_by_pool[pool]["deployer"]
        if volume < 5 or swaps < 250 or senders < 25 or top_share > 0.60 or direction_min < 0.08:
            continue
        if deployer in seen_deployers:
            continue
        seen_deployers.add(deployer)
        eligible.append({**row, "top_sender_share": top_share, "minor_direction_share": direction_min})

    eval_by_pool = defaultdict(list)
    eligible_pools = {row["pool"] for row in eligible[:100]}
    for swap in evaluation_swaps:
        if swap["pool"] in eligible_pools:
            eval_by_pool[swap["pool"]].append(swap)
    for swaps in eval_by_pool.values():
        swaps.sort(key=lambda row: (int(row["block"]), int(row["log_index"])))

    outcomes = []
    for rank, selected in enumerate(eligible[:100], 1):
        pool = selected["pool"]
        launch = launch_by_pool[pool]
        weth_is_token0 = min(launch["token"], WETH) == WETH
        for width in (0.10, 0.25, 0.50, 1.00, 2.00):
            result = simulate_static(
                eval_by_pool.get(pool, []), weth_is_token0, width, args.capital_per_position, args.action_cost
            )
            if not result:
                continue
            outcomes.append(
                {
                    "rank": rank,
                    "pool": pool,
                    "token": launch["token"],
                    "deployer": launch["deployer"],
                    "width": width,
                    "ranking_volume_weth": float(selected["volume_weth_7d"]),
                    "ranking_swaps": int(selected["swaps_7d"]),
                    "ranking_unique_senders": int(selected["unique_senders_7d"]),
                    "ranking_top_sender_share": selected["top_sender_share"],
                    "ranking_minor_direction_share": selected["minor_direction_share"],
                    **result,
                }
            )

    with (args.output / "pons_v3_static_outcomes.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(outcomes[0]) if outcomes else ["pool"])
        writer.writeheader()
        writer.writerows(outcomes)

    summaries = []
    for width in (0.10, 0.25, 0.50, 1.00, 2.00):
        width_rows = [row for row in outcomes if row["width"] == width]
        for count in (1, 3, 5, 10, 20):
            chosen = [row for row in width_rows if row["rank"] <= count]
            if not chosen:
                continue
            values = [row["net_return_pct"] for row in chosen]
            fee_values = [row["gross_fee_return_pct"] for row in chosen]
            summaries.append(
                {
                    "width": width,
                    "top_n": count,
                    "positions": len(chosen),
                    "weekly_return_pct": sum(values) / len(values),
                    "median_position_return_pct": sorted(values)[len(values) // 2],
                    "worst_position_return_pct": min(values),
                    "best_position_return_pct": max(values),
                    "gross_fee_return_pct": sum(fee_values) / len(fee_values),
                    "positive_position_share": sum(value > 0 for value in values) / len(values),
                    "annualized_simple_apr_pct": (sum(values) / len(values)) * 52,
                }
            )
    summaries.sort(key=lambda row: row["weekly_return_pct"], reverse=True)
    with (args.output / "pons_v3_static_summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summaries[0]) if summaries else ["width"])
        writer.writeheader()
        writer.writerows(summaries)
    (args.output / "pons_v3_manifest.json").write_text(
        json.dumps(
            {
                "launches": len(launches),
                "ranking_active_pools": len(ranking),
                "eligible_after_frozen_gates": len(eligible),
                "evaluated_pools": len({row["pool"] for row in outcomes}),
                "capital_per_position_weth": args.capital_per_position,
                "action_cost_weth": args.action_cost,
                "selection": "prior-week volume with sender, direction, and creator-cluster gates",
                "decision": "research only; no transaction sent",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"eligible": len(eligible), "evaluated": len({row['pool'] for row in outcomes}), "top": summaries[:10]}, indent=2))


if __name__ == "__main__":
    main()
