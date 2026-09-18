"""Hardening: anti-brick redeem, thin-pool bind, curator extract, dust claims."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "contracts" / "HoodxIndex.sol").read_text()
SWAP = (ROOT / "contracts" / "HoodxSwap.sol").read_text()
STORAGE = (ROOT / "contracts" / "HoodxStorage.sol").read_text()
LOOKUP = (ROOT / "lib" / "lookup.ts").read_text()
EJECT = (ROOT / "lib" / "eject.ts").read_text()
SOL = INDEX + SWAP + STORAGE


class RedeemableNavTest(unittest.TestCase):
    def test_withdraw_skips_unliquidatable(self):
        priced = INDEX.split("function _assertPriced()")[1].split("function _assertCashFloor")[0]
        self.assertIn("if (!_canLiquidate(t)) continue", priced)

    def test_position_and_preview_use_redeemable(self):
        pos = INDEX.split("function position(")[1].split("function previewDeposit")[0]
        self.assertIn("redeemableAssets()", pos)
        prev = INDEX.split("function previewWithdraw")[1].split("function previewBuy")[0]
        self.assertIn("redeemableAssets()", prev)

    def test_withdraw_never_bricks_on_failed_name(self):
        body = INDEX.split("function withdraw(uint256 shares, uint256 minEthOut)")[1].split("function setTargets")[0]
        self.assertIn("if (net == 0) revert NeedBuffer()", body)
        self.assertIn("if (net < minEthOut) revert Slippage()", body)
        self.assertNotIn("previewSell(shares)", body)
        self.assertNotIn("if (net < minOut) revert Slippage()", body)

    def test_claim_dust_pays_shareholder_not_owner(self):
        body = INDEX.split("function claimDust(address token)")[1].split("function rebindToken")[0]
        self.assertIn("claimDustRaw", body)
        swap_claim = SWAP.split("function claimDustRaw")[1].split("function rebindTokenRaw")[0]
        self.assertIn("strandedClaimed[token][msg.sender]", swap_claim)
        self.assertIn("IERC20(token).transfer(msg.sender, amt)", swap_claim)
        self.assertNotIn("transfer(owner", swap_claim)


class BindGuardTest(unittest.TestCase):
    def test_v3_depth_and_v4_hooks(self):
        self.assertIn("revert ThinPool()", SWAP)
        self.assertIn("revert HookedPool()", SWAP)
        self.assertIn("getLiquidity(poolId) == 0", SWAP)
        self.assertIn("MIN_POOL_WETH", STORAGE)
        self.assertIn("MIN_CASH_BPS = 2000", STORAGE)

    def test_new_name_cannot_be_bought_immediately(self):
        self.assertIn("BUY_UNLOCK_DELAY", SWAP)
        self.assertIn("listedAt[token] = live == 0 ? uint64(1) : uint64(block.timestamp)", SWAP)
        self.assertIn("_guardBuy(tokenOut, amountIn)", SWAP)

    def test_floors_cannot_drop_to_ten_percent(self):
        floors = INDEX.split("function setFloors")[1].split("function setPaused")[0]
        self.assertIn("MIN_CASH_BPS", floors)
        self.assertNotIn("cashBps_ < 1000", floors)

    def test_strand_rejects_liquid_names(self):
        body = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("v4Key[token].hooks == address(0)", body)
        self.assertIn("revert BadPool()", body)

    def test_ui_rejects_thin_and_hooked_in_plain_language(self):
        self.assertIn("too small to add safely", LOOKUP)
        self.assertIn("MIN_V3_WETH", LOOKUP)
        self.assertIn("can’t be added safely", LOOKUP)
        self.assertIn("thinpool", EJECT)
        self.assertIn("toosoon", EJECT)
        self.assertIn("alreadyclaimed", EJECT)


class ExtractAttackSurfaceTest(unittest.TestCase):
    """The RescueTok path must fail on bind depth or buy cap."""

    def test_buy_capped_versus_pool_and_idle_weth(self):
        guard = SWAP.split("function _guardBuy")[1].split("function _bindV4")[0]
        self.assertIn("MAX_POOL_TAKE_BPS", guard)
        self.assertIn("MAX_NEW_BUY_BPS", guard)
        self.assertIn("IERC20(weth).balanceOf(pool)", guard)
        self.assertIn("IUniV3Pool(pool).liquidity() == 0", guard)

    def test_no_curator_escape_to_eoa(self):
        self.assertNotIn("function emergencyWithdraw", SOL)
        self.assertNotIn("function rescueTo", SOL)
        claim = SWAP.split("function claimDustRaw")[1].split("function rebindTokenRaw")[0]
        self.assertIn("msg.sender", claim)
        strand = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("hooks == address(0)", strand)


if __name__ == "__main__":
    unittest.main()
