"""RH stock registry + generalized quote bind."""

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STOCKS = json.loads((ROOT / "public" / "rh_stocks.json").read_text())
BRIDGES = json.loads((ROOT / "public" / "rh_bridges.json").read_text())
SOL = (ROOT / "contracts" / "HoodxIndex.sol").read_text()


class RhStockRegistryTest(unittest.TestCase):
    def test_catalog_has_canonical_stocks(self):
        tokens = STOCKS.get("tokens") or []
        syms = {t["symbol"] for t in tokens}
        for sym in ("SPY", "SPCX", "NVDA", "QQQ", "TSLA", "GME", "MU"):
            self.assertIn(sym, syms)

    def test_bridges_are_weth_v3(self):
        bridges = BRIDGES.get("bridges") or {}
        self.assertGreaterEqual(len(bridges), 15)
        for sym, row in bridges.items():
            self.assertEqual(len(row["bridge"]), 42, sym)
            self.assertEqual(len(row["token"]), 42, sym)

    def test_contract_seeds_bridges_and_setter(self):
        self.assertIn("function setQuoteBridge(address quote, address v3Bridge)", SOL)
        self.assertIn("event QuoteBridgeSet(address indexed quote, address indexed v3Bridge)", SOL)
        self.assertIn("_seedQuoteBridge(", SOL)
        self.assertIn("// NVDA", SOL)
        self.assertIn("// SPY", SOL)
        self.assertIn("// SPCX", SOL)


class RhQuoteCatalogTest(unittest.TestCase):
    def test_catalog_accepts_any_rh_stock_quote(self):
        from tests.test_bind_pool import is_v4_quote_pool

        row = {
            "buyPool": "0x" + "ab" * 32,
            "buyQuote": "NVDA",
            "buyQuoteAddr": "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
            "buyLabels": ["v4"],
        }
        self.assertTrue(is_v4_quote_pool(row))

    def test_naked_spy_is_v3_weth(self):
        from tests.test_bind_pool import is_v3_weth_pool

        row = {
            "token": "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
            "buyPool": "0xddcbba3666f578e3f09516f21ff85bfee859ab5e",
            "buyQuote": "WETH",
            "buyLabels": ["v3"],
        }
        self.assertTrue(is_v3_weth_pool(row))


if __name__ == "__main__":
    unittest.main()
