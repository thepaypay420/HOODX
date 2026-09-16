"""Capped sqrt-mcap weights with liquidity + hop haircuts.

696's list is 18 niches. Raw mcap puts ~83% in PONS/AI/CASHCAT.
Sqrt compresses that; a 10% cap keeps every name a real sleeve;
a 3% floor keeps the tail from going to dust; dead/thin books drop.
"""

from __future__ import annotations

import json
import math
from typing import Any

from config import (
    CAP,
    CASH_TARGET,
    DEAD_VOL24_USD,
    FLOOR,
    HOP2_HAIRCUT,
    ISSUE_FEE_BPS,
    LIQ_REF_USD,
    MIN_BUY_TVL_USD,
    MIN_SLEEVE_USD,
    MIN_VOL24_USD,
    QUOTE_ETH,
    REDEEM_FEE_BPS,
    UNIVERSE_PATH,
)


def as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return float(default)
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def load_universe(path: Any = None) -> dict[str, Any]:
    raw = json.loads((path or UNIVERSE_PATH).read_text())
    if not isinstance(raw, dict) or not isinstance(raw.get("tokens"), list):
        raise ValueError("universe.json missing tokens[]")
    return raw


def buy_tvl(row: dict[str, Any]) -> float:
    live = as_float(row.get("buyTvlUsd"))
    if live > 0:
        return live
    return as_float(row.get("tvlUsd"))


def mcap(row: dict[str, Any]) -> float:
    live = as_float(row.get("mcapUsd"))
    if live > 0:
        return live
    return as_float(row.get("listedMcapUsd"))


def hops(row: dict[str, Any]) -> int:
    quote = str(row.get("buyQuote") or row.get("listedQuote") or "").upper()
    if quote in QUOTE_ETH:
        return 1
    if quote:
        return 2
    n = int(row.get("hops") or 0)
    return n if n else 1


def exclude_reason(row: dict[str, Any]) -> str | None:
    if row.get("refreshError"):
        return str(row["refreshError"])
    tvl = buy_tvl(row)
    vol = as_float(row.get("vol24Usd"))
    mc = mcap(row)
    if mc <= 0:
        return "no_mcap"
    live = "buyTvlUsd" in row or "buyPool" in row
    if live and tvl < MIN_BUY_TVL_USD:
        return "thin_pool"
    if vol and vol < DEAD_VOL24_USD:
        return "dead_volume"
    if vol and 0 < vol < MIN_VOL24_USD and tvl < 100_000:
        return "illiquid_tape"
    return None


def _score(row: dict[str, Any]) -> float:
    mc = max(mcap(row), 1.0)
    tvl = buy_tvl(row) or LIQ_REF_USD
    liq = min(1.0, tvl / LIQ_REF_USD)
    hop = HOP2_HAIRCUT if hops(row) >= 2 else 1.0
    return math.sqrt(mc) * liq * hop


def _cap_floor(weights: dict[str, float], *, cap: float, floor: float) -> dict[str, float]:
    names = list(weights)
    n = len(names)
    if n == 0:
        return {}
    cap_use = max(float(cap), 1.0 / n)
    floor_use = min(float(floor), 0.99 / n)
    if floor_use * n > 1.0 - 1e-9:
        floor_use = 0.0
    cap = cap_use
    w = dict(weights)

    def renormalize(current: dict[str, float]) -> dict[str, float]:
        s = sum(current.values())
        if s <= 0:
            eq = 1.0 / len(current)
            return {k: eq for k in current}
        return {k: v / s for k, v in current.items()}

    w = renormalize(w)
    for _ in range(8):
        overflow = 0.0
        flexible = []
        for k in names:
            if w[k] > cap + 1e-12:
                overflow += w[k] - cap
                w[k] = cap
            elif w[k] < cap - 1e-9:
                flexible.append(k)
        if overflow > 0 and flexible:
            room = sum(max(0.0, cap - w[k]) for k in flexible)
            if room > 0:
                for k in flexible:
                    w[k] += overflow * max(0.0, cap - w[k]) / room
        w = renormalize(w)

        deficit = 0.0
        donors = []
        for k in names:
            if w[k] + 1e-12 < floor_use:
                deficit += floor_use - w[k]
                w[k] = floor_use
            elif w[k] > floor_use + 1e-9:
                donors.append(k)
        if deficit > 0 and donors:
            pool = sum(max(0.0, w[k] - floor_use) for k in donors)
            if pool > 0:
                take = min(deficit, pool)
                for k in donors:
                    share = max(0.0, w[k] - floor_use) / pool
                    w[k] -= take * share
        w = renormalize(w)
        if all(floor_use - 1e-9 <= w[k] <= cap + 1e-9 for k in names):
            break
    return renormalize(w)


def allocate(universe: dict[str, Any] | None = None) -> dict[str, Any]:
    uni = universe or load_universe()
    rows = [dict(t) for t in uni.get("tokens") or [] if isinstance(t, dict)]
    skipped = []
    live = []
    for row in rows:
        why = exclude_reason(row)
        if why:
            skipped.append({"id": row.get("id") or row.get("symbol"), "reason": why})
        else:
            live.append(row)
    if not live:
        raise ValueError("no tradeable names")
    scores = {str(r.get("id") or r.get("symbol")): _score(r) for r in live}
    raw = {k: v / sum(scores.values()) for k, v in scores.items()}
    capped = _cap_floor(raw, cap=CAP, floor=FLOOR)
    sleeves = []
    for row in live:
        key = str(row.get("id") or row.get("symbol"))
        sleeves.append(
            {
                "id": key,
                "symbol": row.get("symbol"),
                "token": str(row.get("token") or "").lower(),
                "weight": round(capped[key], 6),
                "rawSqrt": round(raw[key], 6),
                "mcapUsd": round(mcap(row), 0),
                "buyTvlUsd": round(buy_tvl(row), 0),
                "vol24Usd": round(as_float(row.get("vol24Usd")), 0),
                "hops": hops(row),
                "buyDex": row.get("buyDex"),
                "buyPool": row.get("buyPool"),
                "buyQuote": row.get("buyQuote"),
            }
        )
    sleeves.sort(key=lambda s: s["weight"], reverse=True)
    return {
        "policy": uni.get("policy") or "capped_sqrt",
        "cap": CAP,
        "floor": FLOOR,
        "nListed": len(rows),
        "nTradeable": len(live),
        "skipped": skipped,
        "sleeves": sleeves,
        "weightSum": round(sum(s["weight"] for s in sleeves), 6),
    }


def usd_sleeves(nav_usd: float, plan: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    plan = plan or allocate()
    out = []
    for s in plan["sleeves"]:
        out.append({**s, "usd": round(float(nav_usd) * float(s["weight"]), 2)})
    return out


def active_book(
    nav_usd: float,
    min_sleeve_usd: float | None = None,
    cash_target: float | None = None,
    plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Drop names whose policy sleeve is dust; park that weight in WETH.

    Do not redistribute skipped weight onto PONS. When NAV grows, the tail
    is bought from the cash buffer instead of minting $6 PROMETHEUS bags.

    If every remaining name still clears the floor, keep `cash_target` (default
    25%) so redemptions pay ETH without selling 17 legs.
    """
    plan = plan or allocate()
    nav = float(nav_usd)
    floor_usd = MIN_SLEEVE_USD if min_sleeve_usd is None else float(min_sleeve_usd)
    cash_tgt = CASH_TARGET if cash_target is None else float(cash_target)
    held: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for s in plan["sleeves"]:
        policy_w = float(s["weight"])
        policy_usd = nav * policy_w
        row = {**s, "policyWeight": policy_w, "policyUsd": round(policy_usd, 2)}
        if floor_usd > 0 and policy_usd + 1e-12 < floor_usd:
            skipped.append({**row, "weight": 0.0, "usd": 0.0, "reason": "below_floor"})
        else:
            held.append({**row, "weight": policy_w, "usd": round(policy_usd, 2)})
    held_w = sum(float(s["weight"]) for s in held)
    cash_w = 1.0 - held_w
    scaled = False
    if held and cash_w + 1e-12 < cash_tgt:
        scale = (1.0 - cash_tgt) / held_w
        for s in held:
            s["weight"] = float(s["weight"]) * scale
            s["usd"] = round(nav * float(s["weight"]), 2)
        cash_w = cash_tgt
        scaled = True
        held_w = 1.0 - cash_w
    if held:
        dust = [s for s in held if float(s["usd"]) + 1e-12 < floor_usd]
        if dust:
            # Scaling to keep cash should never re-introduce dust; if it did,
            # park those names too (defensive).
            for s in dust:
                skipped.append({**s, "weight": 0.0, "usd": 0.0, "reason": "below_floor_after_cash"})
            held = [s for s in held if float(s["usd"]) + 1e-12 >= floor_usd]
            held_w = sum(float(s["weight"]) for s in held)
            cash_w = 1.0 - held_w
    for s in held:
        s["weight"] = round(float(s["weight"]), 6)
        s["usd"] = round(float(s["usd"]), 2)
    return {
        "navUsd": round(nav, 2),
        "minSleeveUsd": floor_usd,
        "cashTarget": cash_tgt,
        "cashWeight": round(cash_w, 6),
        "cashUsd": round(nav * cash_w, 2),
        "nActive": len(held),
        "nSkipped": len(skipped),
        "scaledForCash": scaled,
        "active": held,
        "skipped": skipped,
        "activeWeightSum": round(held_w, 6),
        "issueFeeBps": ISSUE_FEE_BPS,
        "redeemFeeBps": REDEEM_FEE_BPS,
    }
