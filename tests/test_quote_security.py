"""Quote-bind must preserve the live 696X security model (funds-safe baseline)."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "contracts" / "HoodxIndex.sol").read_text()
SWAP = (ROOT / "contracts" / "HoodxSwap.sol").read_text()
STORAGE = (ROOT / "contracts" / "HoodxStorage.sol").read_text()
SOL = INDEX + SWAP + STORAGE


class QuoteBindSecurityTest(unittest.TestCase):
    def test_carries_funds_safe_hardening(self):
        for needle in (
            "uint256 public constant VIRTUAL_ASSETS = 1e12",
            "address public constant DEAD = 0x000000000000000000000000000000000000dEaD",
            "address public pendingOwner",
            "mapping(address => uint256) public lastPxWad",
            "function mintAssets() public view returns (uint256)",
            "if (last > px) px = last",
            "function deposit(uint256 minShares)",
            "if (minShares == 0) revert TooSmall()",
            "function withdraw(uint256 shares, uint256 minEthOut)",
            "Exits stay open when paused",
            "if (msg.sender != creator) revert NotCreator()",
            "_assertPayTo(",
            "function acceptOwnership()",
            "function cancelOwnershipTransfer()",
            "if (isV4[token]) revert BadPool()",
            "uint256 floor = minOutFloor(quoteOut(tokenIn, tokenOut, amountIn))",
            "try this.execSwap(",
            "if (msg.sender != address(this)) revert OnlySelf()",
            "_liveSupply()",
        ):
            self.assertIn(needle, SOL, msg=f"missing hardening: {needle}")

    def test_quote_bind_is_whitelisted_and_two_hop(self):
        for needle in (
            "mapping(address => address) public quoteOf",
            "mapping(address => bool) public allowedQuote",
            "mapping(address => address) public quoteBridgeV3",
            "function rebindToken(address token, bytes32 poolRef)",
            "if (IERC20(token).balanceOf(address(this)) != 0) revert NeedBuffer()",
            "function _swapQuotedBuy(",
            "function _swapQuotedSell(",
            "function _swapV3Exact(",
            "function _quoteUnit(address token)",
            "amountOutMinimum: minOut",
            "if (wethFloor < minWethOut) revert Slippage()",
            "function setQuoteBridge(address quote, address v3Bridge)",
            "_seedQuoteBridge(USDG, WETH_USDG_V3)",
            "function setImageURI(string calldata uri)",
            "function contractURI() external view returns (string memory)",
            "// SPCX",
            "// NVDA",
        ):
            self.assertIn(needle, SOL, msg=f"missing quote bind: {needle}")

    def test_v4_mint_nav_uses_last_px_on_quoted_names(self):
        body = SOL.split("function _nav(bool mintPx)")[1].split("function _liveSupply")[0]
        self.assertIn("if (mintPx && isV4[t])", body)
        self.assertIn("lastPxWad[t]", body)

    def test_rebind_and_remove_clear_stale_marks(self):
        self.assertIn("delete lastPxWad[token]", SOL)
        rebind = SOL.split("function rebindTokenRaw")[1].split("function initQuotes")[0]
        remove = SOL.split("function _removeToken")[1].split("function _clearBind")[0]
        self.assertIn("_clearBind(token)", rebind)
        self.assertIn("_clearBind(token)", remove)

    def test_hooked_v4_blocked_and_redemptions_skip(self):
        for needle in (
            "function strandToken(address token)",
            "function _canLiquidate(address token)",
            "if (!_canLiquidate(t)) continue",
            "if (!_swapOrSkip(t, weth, amt, floor)) continue",
            "if (hooks != address(0)) revert HookedPool()",
            "if (IUniV3Pool(pool).liquidity() == 0) revert ThinPool()",
            "MIN_POOL_WETH",
            "BUY_UNLOCK_DELAY",
            "function redeemableAssets()",
            "function claimDust(address token)",
            "MIN_CASH_BPS",
            "event TokenStranded(address indexed token, uint256 balance)",
            "function clearBindRaw(address token)",
            "strandedBag[token] = bag",
            "function _guardBuy(address token, uint256 amountIn)",
        ):
            self.assertIn(needle, SOL, msg=f"missing hook guard: {needle}")


if __name__ == "__main__":
    unittest.main()
