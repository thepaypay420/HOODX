import unittest
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import CASH_TARGET, CREATOR_FEE_BPS, ISSUE_FEE_BPS, MIN_FIRST_ETH, MIN_SLEEVE_USD, PROTOCOL_FEE_BPS
from vault_math import (
    DEAD,
    MAX_GENESIS_ETH,
    MIN_GENESIS_ETH,
    USD_PER_SHARE,
    VIRTUAL_ASSETS,
    ZERO,
    can_accept_ownership,
    can_exit,
    can_set_creator_cut,
    deploy_sleeves,
    genesis_eth_per_share,
    issue_split,
    issue_split_parts,
    min_shares_floor,
    mint_at_price,
    mint_from_credited,
    mint_nav,
    mint_shares,
    ok_curator,
    ok_genesis,
    ok_pay_to,
    ok_slug,
    ok_user_slug,
    redeem_split,
    redeem_value,
    roi,
    share_price,
    shift_cost,
    v4_mint_px,
    vault_perf,
    virtual_shares,
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
        shares = mint_shares(net, assets_before=0, supply=0, genesis=10**18)
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

    def test_rebalance_moves_redeem_value_not_share_count(self):
        owner = 199 * 10**14
        supply = owner
        before = redeem_value(owner, 199 * 10**14, supply)
        after = redeem_value(owner, 198 * 10**14, supply)
        self.assertEqual(before, owner)
        self.assertLess(after, before)

    def test_joiner_after_markdown_pays_the_new_nav(self):
        supply = 199 * 10**14
        assets = 198 * 10**14
        net, _ = issue_split(2 * 10**16)
        shares = mint_shares(net, assets, supply)
        self.assertGreater(shares, net)
        new_supply = supply + shares
        new_assets = assets + net
        owner_out = redeem_value(supply, new_assets, new_supply)
        self.assertLess(abs(owner_out - assets) / assets, 0.002)

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
        shares = mint_shares(net_in, 0, 0, genesis=10**18)
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

    def test_protocol_cut_on_user_indexes_even_if_creator_takes_zero(self):
        net, proto, creat = issue_split_parts(10**18, protocol_bps=10, creator_bps=0)
        self.assertEqual(proto, 10**18 * 10 // 10_000)
        self.assertEqual(creat, 0)
        self.assertEqual(net + proto, 10**18)

    def test_first_mint_buys_the_book_not_idle_cash(self):
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        names, kept = deploy_sleeves(net, n=14)
        self.assertEqual(names, 14)
        self.assertGreater(kept, 0)
        # Tiny join cannot clear the 0.004 ETH sleeve floor across 14 names.
        tiny, _ = issue_split(2 * 10**16)
        n2, kept2 = deploy_sleeves(tiny, n=14)
        self.assertEqual(n2, 0)
        self.assertEqual(kept2, tiny)
        # 3-name probe at 0.02 clears the floor.
        n3, _ = deploy_sleeves(tiny, n=3)
        self.assertEqual(n3, 3)

    def test_one_failed_sleeve_stays_cash_shares_still_at_nav(self):
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        names, kept = deploy_sleeves(net, n=14)
        sleeve = (net * ((10_000 - 2500) // 14)) // 10_000
        names_ok, kept_fail = names - 1, kept + sleeve
        self.assertEqual(names_ok, 13)
        gen = genesis_eth_per_share(2500)
        shares = mint_shares(net, assets_before=0, supply=0, genesis=gen)
        self.assertEqual(share_price(net, shares, genesis=gen), gen)
        self.assertEqual(redeem_value(shares, net, shares), net)
        self.assertLess(redeem_value(shares, net - sleeve, shares), net)

    def test_hundred_dollar_share_and_fractional_slip(self):
        gen = genesis_eth_per_share(2500)
        self.assertEqual(gen, 4 * 10**16)
        self.assertEqual(share_price(0, 0), gen)
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        # 0.08 ETH after fee is ~$199 at $2500 → just under 2 shares.
        shares = mint_at_price(net, gen)
        self.assertGreater(shares, 10**18)
        self.assertLess(shares, 2 * 10**18)
        # $100 of ETH with 2% slip mints 0.98 shares. Fractions are the point.
        credited = int(0.04 * 0.98 * 10**18)
        slipped = mint_at_price(credited, gen)
        self.assertEqual(slipped, 98 * 10**16)

    def test_enter_at_live_share_price(self):
        self.assertEqual(share_price(0, 0), genesis_eth_per_share(2500))
        price = share_price(12 * 10**16, 8 * 10**16)
        self.assertEqual(price, 15 * 10**17)
        self.assertEqual(mint_at_price(3 * 10**16, price), 2 * 10**16)
        self.assertEqual(mint_shares(3 * 10**16, 12 * 10**16, 8 * 10**16), 2 * 10**16)

    def test_roi_tracks_cost_basis_not_share_count(self):
        cost = 8 * 10**16
        shares = 8 * 10**16
        value_up = redeem_value(shares, 10 * 10**16, shares)
        self.assertGreater(roi(value_up, cost), 0)
        value_down = redeem_value(shares, 7 * 10**16, shares)
        self.assertLess(roi(value_down, cost), 0)
        cut, left = shift_cost(cost, shares // 2, shares)
        self.assertEqual(cut, cost // 2)
        self.assertEqual(left, cost // 2)

    def test_redeem_cannot_exceed_vault_nav(self):
        assets = 19 * 10**16
        supply = 20 * 10**16
        out = redeem_value(supply, assets, supply)
        self.assertEqual(out, assets)
        self.assertLess(redeem_value(supply // 2, assets, supply), assets)

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

    def test_markup_cannot_mint_more_shares_than_net(self):
        gen = genesis_eth_per_share(2500)
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        honest = mint_from_credited(net, gen, net)
        greedy = mint_from_credited(net * 2, gen, net)
        self.assertEqual(honest, greedy)
        self.assertEqual(greedy, mint_at_price(net, gen))
        preview = mint_at_price(net, gen)
        slipped = mint_from_credited(int(net * 0.98), gen, net)
        self.assertLess(slipped, preview)
        self.assertGreater(slipped, 0)

    def test_erc4626_inflation_cannot_zero_out_min_join(self):
        gen = genesis_eth_per_share(2500)
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        supply = mint_at_price(net, gen)
        assets = net + 10**21  # donate 1000 ETH after first mint
        price = share_price(assets, supply)
        victim_net, _ = issue_split(2 * 10**16)
        victim = mint_at_price(victim_net, price)
        self.assertGreater(victim, 0)
        # 1-wei first mint is how the classic attack gets 0 victim shares.
        self.assertGreaterEqual(int(MIN_FIRST_ETH * 10**18), MIN_GENESIS_ETH)

    def test_mark_down_does_not_let_joiner_steal_nav(self):
        supply = 2 * 10**18
        assets = 8 * 10**16  # book dumped 50% vs $100 genesis on ~2 shares
        net, _ = issue_split(2 * 10**16)
        shares = mint_shares(net, assets, supply)
        new_supply = supply + shares
        new_assets = assets + net
        old_out = redeem_value(supply, new_assets, new_supply)
        self.assertLess(abs(old_out - assets) / assets, 0.002)

    def test_joiner_cannot_redeem_more_than_pro_rata_nav(self):
        assets = 19 * 10**16
        supply = 20 * 10**16
        attacker = supply // 2
        out = redeem_value(attacker, assets, supply)
        self.assertEqual(out, assets // 2)
        self.assertLess(out, attacker)

    def test_genesis_bounds_reject_ticket_and_dust_pegs(self):
        self.assertTrue(ok_genesis(genesis_eth_per_share(2500)))
        self.assertTrue(ok_genesis(MIN_GENESIS_ETH))
        self.assertTrue(ok_genesis(MAX_GENESIS_ETH))
        self.assertFalse(ok_genesis(10**15))  # 0.001 ETH — $2.50 share
        self.assertFalse(ok_genesis(10**18))  # 1 ETH / share
        self.assertFalse(ok_genesis(0))

    def test_live_tape_not_a_stale_2400_ref(self):
        live = genesis_eth_per_share(2430)
        stale = genesis_eth_per_share(2400)
        self.assertNotEqual(live, stale)
        self.assertEqual(USD_PER_SHARE, 100)
        # 0.08 ETH share count comes from on-chain ETH, not 2400.
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        self.assertNotEqual(mint_at_price(net, live), mint_at_price(net, stale))
        # HUD genesisEthWei uses the same 8 dp integer tape.
        px = int(round(2430 * 1e8))
        js = (100 * 10**18 * 10**8) // px
        self.assertEqual(live, js)

    def test_preview_is_strict_upper_bound(self):
        gen = genesis_eth_per_share(2429.88)
        gross = int(MIN_FIRST_ETH * 10**18)
        net, _ = issue_split(gross)
        preview = mint_at_price(net, gen)
        for drag in (0.0, 0.02, 0.05):
            got = mint_from_credited(int(net * (1 - drag)), gen, net)
            self.assertLessEqual(got, preview)
        self.assertGreater(preview, 10**18)
        self.assertLess(preview, 2 * 10**18)

    def test_fractional_shares_always_ok(self):
        gen = genesis_eth_per_share(2500)
        dust = mint_at_price(10**15, gen)  # 0.001 ETH
        self.assertGreater(dust, 0)
        self.assertLess(dust, 10**18)

    def test_cost_shift_cannot_create_basis(self):
        cut, left = shift_cost(8 * 10**16, 8 * 10**16, 8 * 10**16)
        self.assertEqual(cut + left, 8 * 10**16)
        cut2, left2 = shift_cost(8 * 10**16, 1, 8 * 10**16)
        self.assertEqual(cut2 + left2, 8 * 10**16)
        self.assertEqual(shift_cost(8 * 10**16, 0, 8 * 10**16), (0, 8 * 10**16))

    def test_nav_is_sum_of_every_sleeve_not_first_token(self):
        weth = 10**16
        sleeves = [(10**18, 10**16), (10**18, 2 * 10**16), (10**18, 3 * 10**16)]
        nav = mint_nav(weth, sleeves)
        first_only = weth + sleeves[0][0] * sleeves[0][1] // 10**18
        self.assertGreater(nav, first_only)
        self.assertEqual(nav, weth + 10**16 + 2 * 10**16 + 3 * 10**16)

    def test_v4_spot_dump_cannot_cheapen_mint(self):
        last = 10**16
        dumped = 10**15
        self.assertEqual(v4_mint_px(dumped, last), last)
        self.assertEqual(v4_mint_px(2 * 10**16, last), 2 * 10**16)
        self.assertEqual(v4_mint_px(dumped, 0), dumped)

    def test_min_shares_rejects_sandwich_below_preview(self):
        preview = 2 * 10**18
        floor = min_shares_floor(preview)
        sandwiched = preview * 90 // 100
        self.assertGreater(floor, sandwiched)
        self.assertLess(floor, preview)
        self.assertEqual(min_shares_floor(0), 1)

    def test_donation_before_first_mint_inflates_entry_not_genesis(self):
        gen = genesis_eth_per_share(2500)
        dead = virtual_shares(gen)
        donated = 10**18
        inflated = donated * 10**18 // dead
        self.assertGreater(inflated, gen)
        net, _ = issue_split(int(MIN_FIRST_ETH * 10**18))
        got = mint_at_price(net, inflated)
        honest = mint_at_price(net, gen)
        self.assertLess(got, honest)
        self.assertGreater(min_shares_floor(honest), got)

    def test_dead_shares_are_dust_not_a_ticket(self):
        gen = genesis_eth_per_share(2500)
        dead = virtual_shares(gen)
        self.assertEqual(DEAD.lower(), "0x000000000000000000000000000000000000dead")
        self.assertEqual(dead * gen // 10**18, VIRTUAL_ASSETS)
        self.assertLess(VIRTUAL_ASSETS, 10**15)

    def test_index_pack_includes_v4_eth_weth(self):
        raw = json.loads((Path(__file__).resolve().parents[1] / "universe.json").read_text())
        indexable = []
        skipped = []
        v4 = []
        for t in raw["tokens"]:
            pool = str(t.get("buyPool") or "")
            quote = str(t.get("buyQuote") or "").upper()
            labels = [str(x).lower() for x in (t.get("buyLabels") or [])]
            is_v3 = pool.startswith("0x") and len(pool) == 42 and quote == "WETH"
            is_v4 = pool.startswith("0x") and len(pool) == 66 and quote in ("ETH", "WETH") and "v4" in labels
            if is_v3 or is_v4:
                indexable.append(t["id"])
                if is_v4:
                    v4.append(t["id"])
            else:
                skipped.append(t["id"])
        self.assertIn("PONS", indexable)
        self.assertIn("STONKBROKER", indexable)
        self.assertIn("STONKBROKER", v4)
        self.assertIn("HOOKR", v4)
        self.assertIn("NET", v4)
        self.assertIn("QUOTRON", v4)
        self.assertIn("HARMONIC", v4)
        self.assertIn("NET", v4)  # 9 decimals — wire/HUD skip; bind requires wad
        self.assertEqual(len(v4), 5)
        self.assertIn("SHROOM", skipped)
        self.assertIn("BOW", skipped)
        self.assertIn("PROMETHEUS", skipped)
        self.assertLess(len(indexable), len(raw["tokens"]))


class CuratorHandoffTest(unittest.TestCase):
    """Two-step book vs creator-only cut. Addresses are RH live ids, policy-only."""

    CTX = {
        "owner": "0x134d468b0bcaea6df127916f951f7938c06a37c6",
        "vault": "0x010cf76ab172ea9db59b4548f9bf56cf9c0db39c",
        "weth": "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
        "factory": "0xcec65e26c593cfc94f3e6a803268a1a9585eb7e7",
        "router": "0xcaf681a66d020601342297493863e78c959e5cb2",
        "v4_manager": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
        "v4_state": "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
        "v4_posm": "0x58daec3116aae6d93017baaea7749052e8a04fa7",
    }
    SIX96 = "0x6969696969696969696969696969696969696969"
    CREATOR = "0x134d468b0bcaea6df127916f951f7938c06a37c6"

    def test_reject_zero_vault_weth_dead_self_routers(self):
        ctx = self.CTX
        self.assertFalse(ok_curator(ZERO, **ctx))
        self.assertFalse(ok_curator("0x0000000000000000000000000000000000000000", **ctx))
        self.assertFalse(ok_curator(ctx["vault"], **ctx))
        self.assertFalse(ok_curator(ctx["weth"], **ctx))
        self.assertFalse(ok_curator(DEAD, **ctx))
        self.assertFalse(ok_curator(ctx["owner"], **ctx))
        self.assertFalse(ok_curator(ctx["factory"], **ctx))
        self.assertFalse(ok_curator(ctx["router"], **ctx))
        self.assertFalse(ok_curator(ctx["v4_manager"], **ctx))
        self.assertFalse(ok_curator(ctx["v4_state"], **ctx))
        self.assertFalse(ok_curator(ctx["v4_posm"], **ctx))
        self.assertTrue(ok_curator(self.SIX96, **ctx))

    def test_fee_sink_allows_new_curator_not_vault(self):
        ctx = {k: v for k, v in self.CTX.items() if k != "owner"}
        self.assertTrue(ok_pay_to(self.SIX96, **ctx))
        self.assertTrue(ok_pay_to(self.CTX["owner"], **ctx))
        self.assertFalse(ok_pay_to(ZERO, **ctx))
        self.assertFalse(ok_pay_to(self.CTX["vault"], **ctx))
        self.assertFalse(ok_pay_to(DEAD, **ctx))

    def test_only_pending_can_accept(self):
        self.assertFalse(can_accept_ownership(self.SIX96, ZERO))
        self.assertFalse(can_accept_ownership(self.SIX96, self.CTX["owner"]))
        self.assertTrue(can_accept_ownership(self.SIX96, self.SIX96))
        self.assertFalse(can_accept_ownership(self.CTX["owner"], self.SIX96))

    def test_new_curator_cannot_steal_or_zero_the_cut(self):
        self.assertTrue(can_set_creator_cut(self.CREATOR, self.CREATOR))
        self.assertFalse(can_set_creator_cut(self.SIX96, self.CREATOR))
        self.assertFalse(can_set_creator_cut(ZERO, self.CREATOR))

    def test_sol_locks_two_step_and_creator_cut(self):
        here = Path(__file__).resolve().parents[1]
        src = (
            (here / "contracts" / "HoodxIndex.sol").read_text()
            + (here / "contracts" / "HoodxStorage.sol").read_text()
        )
        self.assertIn("address public pendingOwner", src)
        self.assertIn("function acceptOwnership()", src)
        self.assertIn("function cancelOwnershipTransfer()", src)
        self.assertEqual(src.count("if (msg.sender != creator) revert NotCreator();"), 2)
        self.assertIn("_assertPayTo(next, true)", src)
        self.assertNotIn("msg.sender != creator && msg.sender != owner", src)


class LiveFundsTest(unittest.TestCase):
    """Live 696x must stay redeemable. Harnesses cannot lock users or the curator."""

    LIVE = "0x6350f9e8e630785abf09fd1127366998ad821e33"
    OTHER = "0x010cf76ab172ea9db59b4548f9bf56cf9c0db39c"

    def test_pause_does_not_trap_exits(self):
        from live_funds import pause_traps_exits

        self.assertFalse(pause_traps_exits())
        src = (Path(__file__).resolve().parents[1] / "contracts" / "HoodxIndex.sol").read_text()
        withdraw = src.split("function withdraw(uint256 shares, uint256 minEthOut)")[1].split("function ")[0]
        self.assertNotIn("if (paused)", withdraw)
        self.assertIn("Exits stay open when paused", src)

    def test_unpriced_held_name_closes_exit(self):
        from live_funds import exit_open

        self.assertTrue(exit_open(can_withdraw=True, min_eth_out=1, held_priced=True))
        self.assertFalse(exit_open(can_withdraw=True, min_eth_out=0, held_priced=True))
        self.assertFalse(exit_open(can_withdraw=False, min_eth_out=1, held_priced=True))
        self.assertFalse(exit_open(can_withdraw=True, min_eth_out=1, held_priced=False))

    def test_refuse_lockout_live_only(self):
        from live_funds import lockout_fn, refuse_lockout, refuse_retarget, refuse_unwind_live

        self.assertEqual(lockout_fn("setFloors_ui_0.02"), "setFloors")
        self.assertEqual(lockout_fn("redeem_stale_owner"), None)
        with self.assertRaises(SystemExit):
            refuse_lockout(self.LIVE, "setPaused")
        with self.assertRaises(SystemExit):
            refuse_lockout(self.LIVE, "setFloors_test_0.02")
        with self.assertRaises(SystemExit):
            refuse_unwind_live(self.LIVE)
        refuse_lockout(self.OTHER, "setPaused")
        refuse_unwind_live(self.OTHER)
        with self.assertRaises(SystemExit):
            refuse_retarget(self.OTHER)
        refuse_retarget(self.LIVE)

    def test_live_supply_ignores_dead(self):
        from live_funds import live_supply

        self.assertEqual(live_supply(10**18 + 10**12, 10**12), 10**18)
        self.assertEqual(live_supply(10**12, 10**12), 0)

    @unittest.skipUnless(
        (Path(__file__).resolve().parents[1] / "wire_ui.py").is_file(),
        "operator harnesses are not shipped in the HOODX product repo",
    )
    def test_harnesses_call_the_guard(self):
        here = Path(__file__).resolve().parents[1]
        ui = (here / "wire_ui.py").read_text()
        self.assertIn("refuse_unwind_live", ui)
        self.assertIn("skip 696x HUD join/redeem", ui)
        self.assertIn("FINALLY skip 696x unwind/floors", ui)
        live = (here / "wire_live.py").read_text()
        self.assertIn("refuse_fn(fn)", live)
        self.assertIn("refuse_tx(", live)
        self.assertIn("refuse_redeploy()", live)
        self.assertIn("refuse_retarget(vault)", live)


class VaultPerfTest(unittest.TestCase):
    def test_genesis_is_flat(self):
        g = genesis_eth_per_share(2438.95)
        self.assertEqual(vault_perf(g, g), 0.0)

    def test_share_mark_up_is_vault_not_user_roi(self):
        g = genesis_eth_per_share(2500)
        now = int(g * 1.01)
        self.assertAlmostEqual(vault_perf(now, g) or 0, 0.01, places=8)
        # Joiner still pays 50 bps; their slice can lag the vault.
        net, fee = issue_split(8 * 10**16)
        self.assertGreater(fee, 0)
        self.assertLess(roi(net, 8 * 10**16), 0)
        self.assertGreater(vault_perf(now, g) or 0, roi(net, 8 * 10**16))

    def test_bad_genesis(self):
        self.assertIsNone(vault_perf(10**18, 0))


if __name__ == "__main__":
    unittest.main()
