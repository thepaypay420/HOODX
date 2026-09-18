#!/usr/bin/env python3
"""Refresh public/rh_bridges.json from Dexscreener. Look-only."""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STOCKS_PATH = ROOT / "public" / "rh_stocks.json"
OUT = ROOT / "public" / "rh_bridges.json"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
NATIVE = "0x0000000000000000000000000000000000000000"
MIN_TVL = 5_000.0
UA = "Mozilla/5.0 (compatible; hoodx/0.1)"


def _get(url: str) -> list:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = json.loads(resp.read().decode())
    return raw if isinstance(raw, list) else []


def _pairs(token: str) -> list:
    seen: dict[str, dict] = {}
    for url in (
        f"https://api.dexscreener.com/tokens/v1/robinhood/{token}",
        f"https://api.dexscreener.com/token-pairs/v1/robinhood/{token}",
    ):
        try:
            for p in _get(url):
                addr = str(p.get("pairAddress") or "").lower()
                if addr:
                    seen[addr] = p
        except Exception:
            pass
    return list(seen.values())


def _v3_pool(token: str, pairs: list, quote: str) -> tuple[str | None, float]:
    token = token.lower()
    quote = quote.lower()
    best = None
    best_tvl = 0.0
    for p in pairs:
        if str(p.get("chainId") or "").lower() != "robinhood":
            continue
        pool = str(p.get("pairAddress") or "").lower()
        labels = [str(x).lower() for x in (p.get("labels") or [])]
        if len(pool) != 42 or "v3" not in labels:
            continue
        base = str((p.get("baseToken") or {}).get("address") or "").lower()
        q = str((p.get("quoteToken") or {}).get("address") or "").lower()
        qsym = str((p.get("quoteToken") or {}).get("symbol") or "").upper()
        bsym = str((p.get("baseToken") or {}).get("symbol") or "").upper()
        tvl = float((p.get("liquidity") or {}).get("usd") or 0)
        ok = (base == token and q == quote) or (q == token and base == quote)
        if not ok and quote == WETH:
            eth = {"WETH", "ETH"}
            ok = (base == token and (q == WETH or qsym in eth or q == NATIVE)) or (
                q == token and (base == WETH or bsym in eth or base == NATIVE)
            )
        if ok and tvl > best_tvl:
            best, best_tvl = pool, tvl
    return best, best_tvl


def _best_bind(token: str, pairs: list) -> tuple[str | None, str | None, float]:
    """Return (bindPool, bindQuote, tvlUsd) preferring deepest WETH or USDG V3."""
    weth, weth_tvl = _v3_pool(token, pairs, WETH)
    usdg, usdg_tvl = _v3_pool(token, pairs, USDG)
    if usdg_tvl > weth_tvl and usdg:
        return usdg, "USDG", usdg_tvl
    if weth:
        return weth, "WETH", weth_tvl
    if usdg:
        return usdg, "USDG", usdg_tvl
    return None, None, 0.0


def main() -> int:
    rows = json.loads(STOCKS_PATH.read_text()).get("tokens") or []
    bridges: dict[str, dict] = {}
    for row in rows:
        sym = str(row.get("symbol") or "")
        token = str(row.get("token") or "").lower()
        if not sym or not token.startswith("0x"):
            continue
        pairs = _pairs(token)
        bridge, bridge_tvl = _v3_pool(token, pairs, WETH)
        bind, bind_quote, bind_tvl = _best_bind(token, pairs)
        entry: dict = {"token": token}
        if bridge and bridge_tvl >= MIN_TVL:
            entry["bridge"] = bridge
            entry["bridgeTvlUsd"] = round(bridge_tvl, 2)
        if bind and bind_tvl >= MIN_TVL:
            entry["bindPool"] = bind
            entry["bindQuote"] = bind_quote
            entry["bindTvlUsd"] = round(bind_tvl, 2)
        if "bridge" in entry or "bindPool" in entry:
            bridges[sym] = entry
        time.sleep(0.12)
    OUT.write_text(
        json.dumps(
            {
                "chainId": 4663,
                "minTvlUsd": MIN_TVL,
                "usdg": USDG,
                "wethUsdgBridge": "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca",
                "bridges": bridges,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"rh bridges {len(bridges)}/{len(rows)} → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
