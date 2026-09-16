import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import CASH_TARGET, CREATOR_FEE_BPS, ISSUE_FEE_BPS, MIN_FIRST_ETH, MIN_SLEEVE_USD, PROTOCOL_FEE_BPS
from vault_math import (
    can_exit,
    issue_split,
    issue_split_parts,
    mint_shares,
    ok_slug,
    ok_user_slug,
    redeem_split,
    redeem_value,
)
from weights import active_book, allocate


def _uni(*rows):
    return {"policy": "capped_sqrt", "tokens": list(rows)}


class FloorTest(unittest.TestCase):
    def test_below_floor_parks_in_cash_not_pons(self):
        rows = [
            {"id": "PONS", "listedMcapUsd": 412_300_000, "listedQuote": "WETH", "buyTvlUsd": 5_000_000, "vol24Usd": 1_000_000},
            {"id": "AI", "listedMcapUsd": 268_800_000, "listedQuote": "WETH", "buyTvlUsd": 4_000_000, "vol24Usd": 1_000_000},
            {"id": "CASHCAT", "listedMcapUsd": 151_300_000, "listedQuote": "WETH", "buyTvlUsd": 4_000_000, "vol24Usd": 1_000_000},
        ]
        for i in range(12):
            rows.append(
                {
                    "id": f"T{i}",
                    "listedMcapUsd": 5_000_000,
                    "listedQuote": "WETH",
                    "buyTvlUsd": 200_000,
                    "vol24Usd": 50_000,
                }
            )
        plan = allocate(_uni(*rows))
        by = {s["id"]: s["weight"] for s in plan["sleeves"]}
        # 10% of $150 is $15 (held); ~5.8% tail is $8.75 (floor).
        nav = 150.0
        self.assertLess(nav * by["T0"], 10.0)
        self.assertGreaterEqual(nav * by["PONS"], 10.0)
        book = active_book(nav, min_sleeve_usd=10.0, cash_target=0.25, plan=plan)
        ids = {s["id"] for s in book["active"]}
        skip = {s["id"] for s in book["skipped"]}
        self.assertNotIn("T0", ids)
        self.assertIn("T0", skip)
        pons = next(s for s in book["active"] if s["id"] == "PONS")
        # Skipped weight stays cash. Do not pile it onto PONS.
        self.assertAlmostEqual(pons["weight"], by["PONS"], places=5)
        self.assertGreaterEqual(book["cashWeight"], by["T0"] - 1e-9)

    def test_every_active_sleeve_clears_the_floor(self):
        book = active_book(200, min_sleeve_usd=MIN_SLEEVE_USD)
        self.assertGreaterEqual(book["nActive"], 8)
        for s in book["active"]:
            self.assertGreaterEqual(s["usd"], MIN_SLEEVE_USD - 1e-6)
        for s in book["skipped"]:
            self.assertEqual(s["usd"], 0.0)
            self.assertLess(s["policyUsd"], MIN_SLEEVE_USD)

    def test_cash_target_scales_when_all_names_clear(self):
        book = active_book(2000, min_sleeve_usd=10.0, cash_target=0.25)
        self.assertGreaterEqual(book["nActive"], 15)
        self.assertAlmostEqual(book["cashWeight"], CASH_TARGET, places=5)
        self.assertTrue(book["scaledForCash"])
        self.assertAlmostEqual(book["activeWeightSum"] + book["cashWeight"], 1.0, places=5)
        for s in book["active"]:
            self.assertGreaterEqual(s["usd"], 10.0)

    def test_tiny_nav_is_all_cash(self):
        book = active_book(1.0, min_sleeve_usd=10.0)
        self.assertEqual(book["nActive"], 0)
        self.assertAlmostEqual(book["cashWeight"], 1.0, places=5)


class VaultMathTest(unittest.TestCase):
    def test_half_percent_issue_fee(self):
        net, fee = issue_split(10**18)
        self.assertEqual(ISSUE_FEE_BPS, 50)
        self.assertEqual(fee, 10**18 * 50 // 10_000)
        self.assertEqual(net + fee, 10**18)
        self.assertEqual(net, 995 * 10**15)

    def test_first_mint_is_one_to_one_after_fee(self):
        gross = int(MIN_FIRST_ETH * 10**18)
        net, fee = issue_split(gross)
        shares = mint_shares(net, assets_before=0, supply=0)
        self.assertEqual(shares, net)
        self.assertGreater(fee, 0)

    def test_second_joiner_buys_pro_rata(self):
        # $200 seed already in: 0.08 ETH net → 0.08 shares. Joiner adds 0.02 ETH.
        assets = 8 * 10**16
        supply = 8 * 10**16
        net, fee = issue_split(2 * 10**16)
        shares = mint_shares(net, assets, supply)
        self.assertEqual(shares, net)  # 1:1 while share price is 1 WETH
        self.assertEqual(fee, 2 * 10**16 * 50 // 10_000)

    def test_mark_up_does_not_gift_the_joiner(self):
        # Basket marked from 0.08 to 0.12 ETH. Joiner 0.03 net must get 0.02 shares.
        shares = mint_shares(3 * 10**16, assets_before=12 * 10**16, supply=8 * 10**16)
        self.assertEqual(shares, 2 * 10**16)

    def test_redeem_is_free_by_default_and_needs_buffer(self):
        value = redeem_value(1 * 10**16, assets=8 * 10**16, supply=8 * 10**16)
        net, fee = redeem_split(value)
        self.assertEqual(fee, 0)
        self.assertEqual(net, 1 * 10**16)
        self.assertTrue(can_exit(net, weth_buffer=2 * 10**16))
        self.assertFalse(can_exit(net, weth_buffer=1 * 10**15))

    def test_round_trip_fee_is_only_the_join(self):
        gross = 10**18
        net_in, fee_in = issue_split(gross)
        shares = mint_shares(net_in, 0, 0)
        value = redeem_value(shares, net_in, shares)
        net_out, fee_out = redeem_split(value)
        self.assertEqual(fee_out, 0)
        self.assertEqual(net_out, net_in)
        self.assertEqual(fee_in, gross - net_out)

    def test_creator_takes_the_bulk_protocol_keeps_a_cut(self):
        self.assertEqual(PROTOCOL_FEE_BPS, 10)
        self.assertEqual(CREATOR_FEE_BPS, 40)
        self.assertEqual(ISSUE_FEE_BPS, 50)
        net, proto, creat = issue_split_parts(10**18)
        self.assertEqual(proto, 10**18 * 10 // 10_000)
        self.assertEqual(creat, 10**18 * 40 // 10_000)
        self.assertEqual(net + proto + creat, 10**18)
        # Same total as the old 50 bps maintenance fee.
        _, total = issue_split(10**18)
        self.assertEqual(proto + creat, total)

    def test_share_slug_rules(self):
        self.assertTrue(ok_slug("hoodx"))
        self.assertTrue(ok_slug("696x"))
        self.assertTrue(ok_slug("cats4ever"))
        self.assertFalse(ok_slug("HOODX"))
        self.assertFalse(ok_slug("ab"))
        self.assertFalse(ok_slug("create"))
        self.assertFalse(ok_slug("has_under"))
        self.assertTrue(ok_user_slug("catsx"))
        self.assertFalse(ok_user_slug("696x"))
        self.assertFalse(ok_user_slug("hoodx"))


if __name__ == "__main__":
    unittest.main()
