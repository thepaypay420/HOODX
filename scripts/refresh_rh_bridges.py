#!/usr/bin/env python3
"""Refresh public/rh_bridges.json from Dexscreener WETH V3 pools. Look-only."""

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
NATIVE = "0x0000000000000000000000000000000000000000"
MIN_TVL = 5_000.0
UA = "Mozilla/5.0 (compatible; hoodx/0.1)"


def _get(url: str) -> list:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = json.loads(resp.read().decode())
    return raw if isinstance(raw, list) else []


def _weth_bridge(token: str) -> tuple[str | None, float]:
    token = token.lower()
    best = None
    best_tvl = 0.0
    for p in _get(f"https://api.dexscreener.com/token-pairs/v1/robinhood/{token}"):
        if str(p.get("chainId") or "").lower() != "robinhood":
            continue
        pool = str(p.get("pairAddress") or "").lower()
        labels = [str(x).lower() for x in (p.get("labels") or [])]
        if len(pool) != 42 or "v3" not in labels:
            continue
        base = str((p.get("baseToken") or {}).get("address") or "").lower()
        quote = str((p.get("quoteToken") or {}).get("address") or "").lower()
        qsym = str((p.get("quoteToken") or {}).get("symbol") or "").upper()
        bsym = str((p.get("baseToken") or {}).get("symbol") or "").upper()
        tvl = float((p.get("liquidity") or {}).get("usd") or 0)
        eth = {"WETH", "ETH"}
        ok = (base == token and (quote == WETH or qsym in eth or quote == NATIVE)) or (
            quote == token and (base == WETH or bsym in eth or base == NATIVE)
        )
        if ok and tvl > best_tvl:
            best, best_tvl = pool, tvl
    return best, best_tvl


def main() -> int:
    rows = json.loads(STOCKS_PATH.read_text()).get("tokens") or []
    bridges: dict[str, dict] = {}
    for row in rows:
        sym = str(row.get("symbol") or "")
        token = str(row.get("token") or "").lower()
        if not sym or not token.startswith("0x"):
            continue
        pool, tvl = _weth_bridge(token)
        if pool and tvl >= MIN_TVL:
            bridges[sym] = {"token": token, "bridge": pool, "tvlUsd": round(tvl, 2)}
        time.sleep(0.12)
    OUT.write_text(json.dumps({"chainId": 4663, "minTvlUsd": MIN_TVL, "bridges": bridges}, indent=2) + "\n")
    print(f"rh bridges {len(bridges)}/{len(rows)} → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
