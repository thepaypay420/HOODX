"""Catalog bind pool: display pool vs vault bind pool."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROMETHEUS = "0x20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261"
ETH_POOL = "0x772ef02913f35fa465064aad59fd89eed9d0b2c845fb0b0df330e79837f6a53b"
SPCX_POOL = "0x627c2c78063757b8e85ef1eae046df8ad0695a1ebd3dbb6b62aec2ee516de2e8"
RH_STOCKS = {
    str(t.get("token") or "").lower()
    for t in json.loads((ROOT / "public" / "rh_stocks.json").read_text()).get("tokens") or []
}
RH_SYMBOLS = {
    str(t.get("symbol") or "").upper()
    for t in json.loads((ROOT / "public" / "rh_stocks.json").read_text()).get("tokens") or []
}


def is_bytes32(pool: str) -> bool:
    return pool.startswith("0x") and len(pool) == 66


def is_address(pool: str) -> bool:
    return pool.startswith("0x") and len(pool) == 42


def is_v3_weth_pool(row: dict) -> bool:
    pool = str(row.get("buyPool") or "")
    quote = str(row.get("buyQuote") or "").upper()
    labels = [str(x).lower() for x in (row.get("buyLabels") or [])]
    return is_address(pool) and quote == "WETH" and (not labels or "v3" in labels)


def is_v4_eth_weth(row: dict) -> bool:
    pool = str(row.get("buyPool") or "")
    quote = str(row.get("buyQuote") or "").upper()
    labels = [str(x).lower() for x in (row.get("buyLabels") or [])]
    return is_bytes32(pool) and quote in ("ETH", "WETH") and "v4" in labels


def is_v4_quote_pool(row: dict) -> bool:
    pool = str(row.get("buyPool") or "")
    quote = str(row.get("buyQuote") or "").upper()
    quote_addr = str(row.get("buyQuoteAddr") or "").lower()
    labels = [str(x).lower() for x in (row.get("buyLabels") or [])]
    rh = quote_addr in RH_STOCKS or quote in RH_SYMBOLS
    return is_bytes32(pool) and rh and "v4" in labels


class BindPoolTest(unittest.TestCase):
    def test_prometheus_catalog_is_display_only(self):
        raw = json.loads((ROOT / "universe.json").read_text())
        row = next(t for t in raw["tokens"] if t["id"] == "PROMETHEUS")
        self.assertEqual(row["buyQuote"], "SPCX")
        self.assertEqual(row["buyPool"], SPCX_POOL)
        self.assertFalse(is_v4_eth_weth(row))

    def test_prometheus_spcx_is_bindable(self):
        bind = {
            "buyPool": SPCX_POOL,
            "buyQuote": "SPCX",
            "buyQuoteAddr": "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
            "buyLabels": ["v4"],
        }
        self.assertTrue(is_v4_quote_pool(bind))

    def test_bow_spy_is_bindable(self):
        bind = {
            "buyPool": "0x" + "cd" * 32,
            "buyQuote": "SPY",
            "buyQuoteAddr": "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
            "buyLabels": ["v4"],
        }
        self.assertTrue(is_v4_quote_pool(bind))


if __name__ == "__main__":
    unittest.main()
