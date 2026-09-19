"""USDG quote bind — V3 naked stocks + V4 memes."""

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOL = (
    (ROOT / "contracts" / "HoodxIndex.sol").read_text()
    + (ROOT / "contracts" / "HoodxSwap.sol").read_text()
    + (ROOT / "contracts" / "HoodxStorage.sol").read_text()
)
AMZN = "0x12f190a9f9d7d37a250758b26824b97ce941bf54"
AMZN_USDG_V3 = "0x8ac92da74ab5f3b1d024dc1943ad7e15dc4179ef"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
WETH_USDG = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"


def is_v3_usdg(row: dict) -> bool:
    pool = str(row.get("buyPool") or "")
    quote = str(row.get("buyQuote") or "").upper()
    labels = [str(x).lower() for x in (row.get("buyLabels") or [])]
    return pool.startswith("0x") and len(pool) == 42 and quote == "USDG" and (not labels or "v3" in labels)


def is_v4_usdg(row: dict) -> bool:
    pool = str(row.get("buyPool") or "")
    quote = str(row.get("buyQuote") or "").upper()
    labels = [str(x).lower() for x in (row.get("buyLabels") or [])]
    return pool.startswith("0x") and len(pool) == 66 and quote == "USDG" and "v4" in labels


class UsdgContractTest(unittest.TestCase):
    def test_usdg_constants_and_seed(self):
        self.assertIn("USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", SOL)
        self.assertIn("WETH_USDG_V3 = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca", SOL)
        self.assertIn("_seedQuoteBridge(USDG, WETH_USDG_V3)", SOL)

    def test_quote_unit_and_v3_bind(self):
        self.assertIn("function _quoteUnit(address token)", SOL)
        self.assertIn("if (token == USDG) return 1e6", SOL)
        bind = SOL.split("function _bindPool")[1].split("function _bindV4")[0]
        self.assertIn("USDG == t1", bind)
        self.assertIn("quoteOf[token] = USDG", bind)

    def test_usdg_swap_helpers(self):
        self.assertIn("function _swapV3Exact(", SOL)
        buy = SOL.split("function _swapQuotedBuy")[1].split("function _swapQuotedSell")[0]
        sell = SOL.split("function _swapQuotedSell")[1]
        self.assertIn("_quoteUnit(quote)", buy)
        self.assertIn("_swapV3Exact(quote, token, poolOf[token]", buy)
        self.assertIn("IUniTwapOracle(twapOracle).quotePerBase(pool, token, quote", sell)
        self.assertIn("_swapV3Exact(token, quote, pool", sell)
        self.assertIn("IERC20(quote).balanceOf(address(this))", sell)

    def test_uniswap_decimal_safe(self):
        unit = (ROOT / "contracts" / "UniTwap.sol").read_text()
        self.assertIn("function quotePerBase(", unit)
        self.assertIn("uint256 tokenUnit", unit)


class UsdgCatalogTest(unittest.TestCase):
    def test_amzn_usdg_v3_is_bindable(self):
        row = {
            "token": AMZN,
            "buyPool": AMZN_USDG_V3,
            "buyQuote": "USDG",
            "buyLabels": ["v3"],
        }
        self.assertTrue(is_v3_usdg(row))

    def test_meme_usdg_v4_is_bindable(self):
        row = {
            "buyPool": "0x" + "ab" * 32,
            "buyQuote": "USDG",
            "buyLabels": ["v4"],
        }
        self.assertTrue(is_v4_usdg(row))

    def test_rh_stocks_has_amzn(self):
        stocks = json.loads((ROOT / "public" / "rh_stocks.json").read_text()).get("tokens") or []
        syms = {t["symbol"] for t in stocks}
        self.assertIn("AMZN", syms)


if __name__ == "__main__":
    unittest.main()
