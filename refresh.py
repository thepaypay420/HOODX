#!/usr/bin/env python3
"""Look-only Dexscreener refresh for universe.json. No swaps. No vault."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import NATIVE, QUOTE_ETH, UNIVERSE_PATH, USDG, WETH
from weights import as_float, hops

DEX_TOKENS = "https://api.dexscreener.com/tokens/v1/robinhood/"
DEX_PAIRS = "https://api.dexscreener.com/token-pairs/v1/robinhood/"
UA = "Mozilla/5.0 (compatible; rh-index/0.1; +https://github.com/thepaypay420/other-bot)"


def _get(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def _pairs_for(token: str) -> list[dict]:
    seen: dict[str, dict] = {}
    for url in (DEX_TOKENS + token, DEX_PAIRS + token):
        try:
            raw = _get(url)
        except Exception:
            continue
        rows = raw if isinstance(raw, list) else (raw.get("pairs") or [] if isinstance(raw, dict) else [])
        for p in rows:
            if not isinstance(p, dict):
                continue
            addr = str(p.get("pairAddress") or "").lower()
            if addr:
                seen[addr] = p
    return list(seen.values())


def _pick_buy(pairs: list[dict], token: str) -> dict | None:
    token = token.lower()
    scored: list[tuple[float, float, float, dict]] = []
    for p in pairs:
        if str(p.get("chainId") or "").lower() != "robinhood":
            continue
        labels = {str(x).lower() for x in (p.get("labels") or [])}
        base = (p.get("baseToken") or {}).get("address") or ""
        quote = p.get("quoteToken") or {}
        qaddr = str(quote.get("address") or "").lower()
        qsym = str(quote.get("symbol") or "").upper()
        if base.lower() != token:
            continue
        tvl = as_float((p.get("liquidity") or {}).get("usd"))
        if tvl <= 0:
            continue
        vol = as_float((p.get("volume") or {}).get("h24"))
        dex = str(p.get("dexId") or "").lower()
        prefer = 0.0
        eth_like = qaddr == WETH.lower() or qsym in QUOTE_ETH or qaddr == NATIVE
        if eth_like:
            prefer += 10
        elif qaddr == USDG.lower() or qsym == "USDG":
            prefer += 2
        if "v2" in labels:
            prefer -= 1
        if dex in {"uniswap", "uniswapv3", "ramses"}:
            prefer += 0.5
        scored.append((prefer, tvl, vol, p))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    # Prefer a deep WETH/ETH book; if that book is thin, sit the deepest pool
    # (SHROOM/MU, BOW/SPY, PROMETHEUS/SPCX) rather than a fake 1-hop stub.
    eth = [s for s in scored if s[0] >= 10]
    if eth and eth[0][1] >= 80_000:
        return eth[0][3]
    deepest = max(scored, key=lambda s: s[1])
    return deepest[3]


def enrich(row: dict) -> dict:
    token = str(row.get("token") or "")
    out = dict(row)
    if not (token.startswith("0x") and len(token) == 42):
        out["refreshError"] = "bad_token"
        return out
    try:
        pairs = _pairs_for(token)
    except Exception as exc:  # noqa: BLE001
        out["refreshError"] = type(exc).__name__
        return out
    buy = _pick_buy(pairs, token)
    if not buy:
        out["refreshError"] = "no_pool"
        return out
    quote = buy.get("quoteToken") or {}
    out["mcapUsd"] = as_float(buy.get("marketCap") or buy.get("fdv") or row.get("listedMcapUsd"))
    out["priceUsd"] = as_float(buy.get("priceUsd"))
    out["buyPool"] = str(buy.get("pairAddress") or "").lower()
    out["buyDex"] = buy.get("dexId")
    out["buyLabels"] = buy.get("labels")
    out["buyQuote"] = quote.get("symbol")
    out["buyQuoteAddr"] = str(quote.get("address") or "").lower()
    out["buyTvlUsd"] = as_float((buy.get("liquidity") or {}).get("usd"))
    out["vol24Usd"] = as_float((buy.get("volume") or {}).get("h24"))
    out["hops"] = 1 if str(out.get("buyQuote") or "").upper() in QUOTE_ETH else hops(out)
    out.pop("refreshError", None)
    return out


def main() -> int:
    uni = json.loads(UNIVERSE_PATH.read_text())
    tokens = [enrich(t) if isinstance(t, dict) else t for t in uni.get("tokens") or []]
    uni["tokens"] = tokens
    UNIVERSE_PATH.write_text(json.dumps(uni, indent=2) + "\n")
    ok = sum(1 for t in tokens if isinstance(t, dict) and t.get("buyPool"))
    print(f"rh-index refresh {ok}/{len(tokens)} pools → {UNIVERSE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
