"""Adversarial tests: dust claims, emergency eject, ERC4626-style sniping, curator theft."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "contracts" / "HoodxIndex.sol").read_text()
SWAP = (ROOT / "contracts" / "HoodxSwap.sol").read_text()
STORAGE = (ROOT / "contracts" / "HoodxStorage.sol").read_text()
SOL = INDEX + SWAP + STORAGE


class DustSnipingTest(unittest.TestCase):
    """Dividend-sniping / post-strand share inflation (Balancer-style reward attacks)."""

    def test_unpause_blocked_while_dust_outstanding(self):
        body = SWAP.split("function setPausedRaw")[1].split("function claimDustRaw")[0]
        self.assertIn("if (!v && dustLock) revert Paused()", body)

    def test_strand_keeps_vault_paused_until_claims(self):
        """While dustLock is set, curator cannot unpause — deposits/transfers stay frozen via paused."""
        strand = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("if (!paused) revert Paused()", strand)

    def test_strand_sets_dust_lock(self):
        body = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("dustLock = true", body)
        self.assertIn("strandedSupply[token] = live", body)

    def test_strand_requires_pause(self):
        body = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("if (!paused) revert Paused()", body)
        self.assertNotIn("hooks == address(0)", body)

    def test_claim_tracks_paid_total(self):
        claim = SWAP.split("function claimDustRaw")[1].split("function rebindTokenRaw")[0]
        self.assertIn("strandedPaid[token]", claim)
        self.assertIn("bag > paid", claim)

    def test_claim_clears_dust_lock_when_bag_empty(self):
        claim = SWAP.split("function claimDustRaw")[1].split("function rebindTokenRaw")[0]
        self.assertIn("dustStrands", claim)
        self.assertIn("dustLock = false", claim)


class CuratorTheftTest(unittest.TestCase):
    """Rug-style emergencyWithdraw / rescue paths must not exist."""

    def test_no_curator_drain_functions(self):
        for bad in (
            "function emergencyWithdraw",
            "function rescueTo",
            "function skim(",
            "function sweep(",
            "transfer(owner",
        ):
            self.assertNotIn(bad, SOL, msg=f"found {bad}")

    def test_claim_pays_caller_not_owner(self):
        claim = SWAP.split("function claimDustRaw")[1].split("function rebindTokenRaw")[0]
        self.assertIn("transfer(msg.sender", claim)
        self.assertNotIn("transfer(owner", claim)

    def test_weth_cannot_be_stranded(self):
        body = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("token == weth", body)

    def test_double_strand_same_token_blocked(self):
        body = SWAP.split("function _strandToken")[1].split("function _dropToken")[0]
        self.assertIn("strandedBag[token] != 0", body)


class Erc4626InflationTest(unittest.TestCase):
    """OpenZeppelin ERC4626 inflation / first-depositor donation attacks."""

    def test_virtual_shares_on_first_mint(self):
        dep = INDEX.split("function deposit(uint256 minShares)")[1].split("function withdraw")[0]
        self.assertIn("_virtualShares()", dep)
        self.assertIn("balanceOf[DEAD]", dep)

    def test_min_shares_required_on_deposit(self):
        dep = INDEX.split("function deposit(uint256 minShares)")[1].split("function withdraw")[0]
        self.assertIn("if (minShares == 0) revert TooSmall()", dep)
        self.assertIn("shares < minShares) revert Slippage()", dep)

    def test_virtual_assets_constant(self):
        self.assertIn("VIRTUAL_ASSETS = 1e12", STORAGE)


class WithdrawTrapTest(unittest.TestCase):
    """Curator cannot trap ETH while stranding names."""

    def test_withdraw_open_when_paused(self):
        body = INDEX.split("function withdraw(uint256 shares, uint256 minEthOut)")[1].split(
            "function setTargets"
        )[0]
        self.assertNotIn("if (paused) revert", body)

    def test_withdraw_skips_unliquidatable(self):
        liq = INDEX.split("function _liquidate")[1].split("function _swapOrSkip")[0]
        self.assertIn("if (!_canLiquidate(t)) continue", liq)


if __name__ == "__main__":
    unittest.main()
