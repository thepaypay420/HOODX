// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {TestWethV2, TestTokenV2, TestExecutorV2} from "../v2/VaultV2.t.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {HoodxProportionalPolicyV3} from "../../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxProportionalFactoryV3} from "../../contracts/v3/HoodxProportionalFactoryV3.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";

contract RefundRejectorV3 {
    receive() external payable {
        revert("reject refund");
    }

    function join(HoodxProportionalV3 v, uint256 shares, uint256[] calldata amounts) external payable {
        v.depositExactShares{value: msg.value}(shares, amounts, amounts, v.planNonce(), block.timestamp + 300);
    }

    function claim(HoodxProportionalV3 v, address recipient_) external {
        v.claim(address(0), recipient_);
    }
}

abstract contract ProportionalV3Fixture is Test {
    TestWethV2 w;
    TestTokenV2 a;
    TestTokenV2 b;
    TestExecutorV2 ex;
    HoodxProportionalPolicyV3 policy;
    HoodxProportionalV3 vault;
    address alice = address(0xa11ce);
    address treasury = address(0x777);
    address recipient = address(0x888);
    receive() external payable {}

    function route(address token, bool buy) internal view returns (bytes memory) {
        return route(address(token), buy, 3000);
    }

    function route(address token, bool buy, uint24 fee) internal view returns (bytes memory) {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 3;
        h[0].fee = fee;
        h[0].tokenIn = buy ? address(w) : token;
        h[0].tokenOut = buy ? token : address(w);
        return abi.encode(h);
    }

    function taxRoute(address token, bool buy, uint256 taxBps) internal view returns (bytes memory) {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 6;
        h[0].tokenIn = buy ? address(w) : token;
        h[0].tokenOut = buy ? token : address(w);
        h[0].hookData = abi.encode(taxBps);
        return abi.encode(h);
    }

    function setUp() public virtual {
        w = new TestWethV2();
        a = new TestTokenV2("A");
        b = new TestTokenV2("B");
        ex = new TestExecutorV2(address(w));
        policy = new HoodxProportionalPolicyV3(address(this), address(ex));
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = policy.approveRoute(address(a), route(address(a), true), route(address(a), false), bytes32(uint256(1)));
        ids[1] = policy.approveRoute(address(b), route(address(b), true), route(address(b), false), bytes32(uint256(2)));
        HoodxFeeModelV3 fee = new HoodxFeeModelV3(address(ex), address(0), address(0));
        HoodxProportionalV3 impl = new HoodxProportionalV3(address(policy), address(fee));
        HoodxProportionalFactoryV3 factory = new HoodxProportionalFactoryV3(address(this), treasury, address(impl));
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init(
            address(this), address(this), recipient, treasury, "Basket", "BASK", 40, 10, 2500, 0.02 ether, ""
        );
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        vault = HoodxProportionalV3(payable(factory.create("research", init, ids, weights)));
        vm.deal(address(this), 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(address(w), 1000 ether);
    }

    function seed() internal {
        uint256[] memory floors = new uint256[](2);
        floors[0] = 0.037 ether;
        floors[1] = 0.037 ether;
        vault.bootstrap{value: 0.1 ether}(floors, vault.planNonce(), block.timestamp + 300);
    }

    function join(uint256 shares, uint256 surplus, uint256 maxEth) internal returns (uint256) {
        (, uint256[] memory amounts) = vault.requiredContributions(shares);
        uint256[] memory budgets = new uint256[](2);
        budgets[0] = amounts[0] + surplus;
        budgets[1] = amounts[1] + surplus;
        uint256 nonce = vault.planNonce();
        vm.prank(alice);
        return vault.depositExactShares{value: maxEth}(shares, budgets, amounts, nonce, block.timestamp + 300);
    }

    function exit(address who, uint256 shares) internal {
        uint256[] memory floors = new uint256[](2);
        floors[0] = 1;
        floors[1] = 1;
        uint256 nonce = vault.planNonce();
        vm.prank(who);
        vault.withdraw(shares, 1, floors, nonce, block.timestamp + 300);
    }

    function rejectJoin(uint256 shares, uint256 maxEth) internal {
        (, uint256[] memory amounts) = vault.requiredContributions(shares);
        uint256 nonce = vault.planNonce();
        vm.prank(alice);
        vm.expectRevert();
        vault.depositExactShares{value: maxEth}(shares, amounts, amounts, nonce, block.timestamp + 300);
    }
}

contract ProportionalV3Test is ProportionalV3Fixture {
    function testApprovedFallbackRouteHealsBuyAndWithdrawal() public {
        bytes memory buyFallback = route(address(a), true, 500);
        bytes memory sellFallback = route(address(a), false, 500);
        bytes32 fallbackId = policy.approveRoute(address(a), buyFallback, sellFallback, bytes32(uint256(99)));
        bytes32[] memory candidates = policy.configsFor(address(a));
        assertEq(candidates.length, 2);
        assertEq(candidates[1], fallbackId);

        ex.setBrokenRoute(route(address(a), true));
        seed();
        assertGt(vault.freeBalance(address(a)), 0);

        ex.setBrokenRoute(route(address(a), false));
        uint256 shares = vault.balanceOf(address(this));
        uint256[] memory floors = new uint256[](2);
        floors[0] = 1;
        floors[1] = 1;
        vault.withdraw(shares, 1, floors, vault.planNonce(), block.timestamp + 300);
        assertEq(vault.balanceOf(address(this)), 0);
        assertEq(a.allowance(address(vault), address(ex)), 0);
    }

    function testAllFallbacksFailAtomically() public {
        policy.approveRoute(
            address(a), route(address(a), true, 500), route(address(a), false, 500), bytes32(uint256(99))
        );
        seed();
        uint256 shares = vault.balanceOf(address(this));
        uint256 tokenBefore = vault.freeBalance(address(a));
        uint256 cashBefore = vault.freeBalance(address(w));
        ex.setBroken(true);
        uint256[] memory floors = new uint256[](2);
        floors[0] = 1;
        floors[1] = 1;
        uint256 nonce = vault.planNonce();
        vm.expectRevert(HoodxProportionalV3.RoutesUnavailable.selector);
        vault.withdraw(shares, 1, floors, nonce, block.timestamp + 300);
        assertEq(vault.balanceOf(address(this)), shares);
        assertEq(vault.freeBalance(address(a)), tokenBefore);
        assertEq(vault.freeBalance(address(w)), cashBefore);
        assertEq(a.allowance(address(vault), address(ex)), 0);
    }

    function testFallbackCannotBypassSignedMinimum() public {
        policy.approveRoute(
            address(a), route(address(a), true, 500), route(address(a), false, 500), bytes32(uint256(99))
        );
        seed();
        ex.setOutput(5000);
        uint256[] memory floors = new uint256[](2);
        floors[0] = vault.freeBalance(address(a));
        floors[1] = 1;
        uint256 nonce = vault.planNonce();
        uint256 shares = vault.balanceOf(address(this));
        vm.expectRevert(HoodxProportionalV3.RoutesUnavailable.selector);
        vault.withdraw(shares, 1, floors, nonce, block.timestamp + 300);
    }

    function testRouteCandidatesAreBounded() public {
        policy.approveRoute(
            address(a), route(address(a), true, 500), route(address(a), false, 500), bytes32(uint256(10))
        );
        policy.approveRoute(
            address(a), route(address(a), true, 501), route(address(a), false, 501), bytes32(uint256(11))
        );
        policy.approveRoute(
            address(a), route(address(a), true, 502), route(address(a), false, 502), bytes32(uint256(12))
        );
        bytes32 fifth = policy.approveRoute(
            address(a), route(address(a), true, 503), route(address(a), false, 503), bytes32(uint256(13))
        );
        bytes32[] memory active = policy.configsFor(address(a));
        assertEq(active.length, 4);
        bytes32[] memory replacement = new bytes32[](2);
        replacement[0] = active[0];
        replacement[1] = fifth;
        policy.setActiveRoutes(address(a), replacement);
        active = policy.configsFor(address(a));
        assertEq(active.length, 2);
        assertEq(active[1], fifth);
    }

    function testGasBurningPreferredRouteCannotBlockHealthyFallback() public {
        policy.approveRoute(
            address(a), route(address(a), true, 500), route(address(a), false, 500), bytes32(uint256(99))
        );
        ex.setGasBurnRoute(route(address(a), true));
        seed();
        assertGt(vault.freeBalance(address(a)), 0);

        ex.setGasBurnRoute(route(address(a), false));
        uint256[] memory floors = new uint256[](2);
        floors[0] = 1;
        floors[1] = 1;
        vault.withdraw(vault.balanceOf(address(this)), 1, floors, vault.planNonce(), block.timestamp + 300);
        assertEq(vault.balanceOf(address(this)), 0);
        assertEq(a.allowance(address(vault), address(ex)), 0);
    }

    function testFallbackCannotSilentlyWeakenClaimTransferProtection() public {
        policy.approveRoute(
            address(a), taxRoute(address(a), true, 1000), taxRoute(address(a), false, 1000), bytes32(uint256(99))
        );
        ex.setBrokenRoute(route(address(a), true));
        uint256[] memory floors = new uint256[](2);
        floors[0] = 0.037 ether;
        floors[1] = 0.037 ether;
        uint256 nonce = vault.planNonce();
        vm.expectRevert(HoodxProportionalV3.RoutesUnavailable.selector);
        vault.bootstrap{value: 0.1 ether}(floors, nonce, block.timestamp + 300);
    }

    function testExternalRouteCannotForgeSuccessfulQuote() public {
        seed();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 0.01 ether;
        amounts[1] = 0.01 ether;
        vm.mockCallRevert(
            address(ex),
            abi.encodeWithSelector(ex.execute.selector),
            abi.encodeWithSelector(HoodxProportionalV3.BuyQuote.selector, amounts)
        );
        vm.expectRevert(HoodxProportionalV3.QuoteUnavailable.selector);
        vault.quoteBuys{value: 0.02 ether}(amounts);
        uint256 shares = vault.totalSupply();
        vm.mockCallRevert(
            address(ex),
            abi.encodeWithSelector(ex.execute.selector),
            abi.encodeWithSelector(HoodxProportionalV3.WithdrawalQuote.selector, 1 ether, amounts)
        );
        vm.expectRevert(HoodxProportionalV3.QuoteUnavailable.selector);
        vault.quoteWithdrawal(shares);
    }

    function testBuyQuoteAlwaysRollsBackFundsAndApprovals() public {
        seed();
        uint256[] memory budgets = new uint256[](2);
        budgets[0] = 0.01 ether;
        budgets[1] = 0.02 ether;
        uint256 beforeA = vault.freeBalance(address(a));
        uint256 beforeW = vault.freeBalance(address(w));
        uint256 beforeETH = address(this).balance;
        uint256 supply = vault.totalSupply();
        vm.expectRevert(abi.encodeWithSelector(HoodxProportionalV3.BuyQuote.selector, budgets));
        vault.quoteBuys{value: 0.03 ether}(budgets);
        assertEq(address(this).balance, beforeETH);
        assertEq(vault.freeBalance(address(a)), beforeA);
        assertEq(vault.freeBalance(address(w)), beforeW);
        assertEq(vault.totalSupply(), supply);
        assertEq(w.allowance(address(vault), address(ex)), 0);
    }

    function testWithdrawalQuoteRollsBackAndWorksWhilePaused() public {
        seed();
        vault.setPaused(true);
        uint256 supply = vault.totalSupply();
        uint256[] memory outputs = new uint256[](2);
        outputs[0] = 0.0373125 ether;
        outputs[1] = outputs[0];
        vm.expectRevert(abi.encodeWithSelector(HoodxProportionalV3.WithdrawalQuote.selector, 0.024875 ether, outputs));
        vault.quoteWithdrawal(supply);
        assertEq(vault.totalSupply(), supply);
        assertEq(vault.freeBalance(address(a)), outputs[0]);
        assertEq(vault.freeBalance(address(w)), 0.024875 ether);
        assertEq(a.allowance(address(vault), address(ex)), 0);
    }

    function testQuoteCannotSpendExistingCashAndProbesArePrivate() public {
        seed();
        uint256[] memory budgets = new uint256[](2);
        budgets[0] = 0.01 ether;
        vm.expectRevert(HoodxProportionalV3.QuoteUnavailable.selector);
        vault.quoteBuys{value: 1}(budgets);
        vm.expectRevert(HoodxProportionalV3.OnlySelf.selector);
        vault.probeBuys(budgets, 0.01 ether);
        vm.expectRevert(HoodxProportionalV3.OnlySelf.selector);
        vault.probeWithdrawal(address(this), 1);
        vm.prank(alice);
        vm.expectRevert(HoodxProportionalV3.QuoteUnavailable.selector);
        vault.quoteWithdrawal(1);
    }

    function testRejectedETHRefundCanBeClaimedElsewhere() public {
        seed();
        RefundRejectorV3 user = new RefundRejectorV3();
        uint256 shares = vault.totalSupply() / 2;
        (, uint256[] memory amounts) = vault.requiredContributions(shares);
        user.join{value: 0.08 ether}(vault, shares, amounts);
        assertEq(vault.claimable(address(user), address(0)), 0.03 ether);
        uint256 beforeEth = alice.balance;
        user.claim(vault, alice);
        assertEq(alice.balance, beforeEth + 0.03 ether);
        assertEq(vault.reserved(address(0)), 0);
    }

    function testReservedSurplusNeverFundsAnotherJoin() public {
        seed();
        a.setBlocked(true);
        join(vault.totalSupply() / 2, 0.001 ether, 0.08 ether);
        uint256 reservedBefore = vault.reserved(address(a));
        uint256 backing = vault.freeBalance(address(a));
        uint256 supply = vault.totalSupply();
        join(supply / 2, 0, 0.1 ether);
        assertEq(vault.reserved(address(a)), reservedBefore);
        assertGe(vault.freeBalance(address(a)) * supply, backing * vault.totalSupply());
    }

    function testBootstrapDonationsBelongToTreasuryClaims() public {
        a.mint(address(vault), 5 ether);
        w.mint(address(vault), 2 ether);
        vm.deal(address(vault), 1 ether);
        seed();
        assertEq(vault.claimable(treasury, address(a)), 5 ether);
        assertEq(vault.claimable(treasury, address(0)), 1 ether);
        assertEq(vault.claimable(treasury, address(w)), 2.0001 ether);
        assertEq(vault.freeBalance(address(a)), 0.0373125 ether);
    }

    function testDonationBetweenPlanAndJoinCannotDiluteHolder() public {
        seed();
        uint256 shares = vault.totalSupply() / 2;
        uint256 nonce = vault.planNonce();
        (, uint256[] memory amounts) = vault.requiredContributions(shares);
        a.mint(address(vault), 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        vault.depositExactShares{value: 0.08 ether}(shares, amounts, amounts, nonce, block.timestamp + 300);
        assertEq(vault.balanceOf(alice), 0);
    }

    function testExpiredAndOverlongPlansRejected() public {
        seed();
        uint256 shares = vault.totalSupply() / 2;
        uint256 nonce = vault.planNonce();
        (, uint256[] memory amounts) = vault.requiredContributions(shares);
        vm.expectRevert();
        vault.depositExactShares{value: 0.08 ether}(shares, amounts, amounts, nonce, block.timestamp + 301);
        vm.expectRevert();
        vault.depositExactShares{value: 0.08 ether}(shares, amounts, amounts, nonce, block.timestamp - 1);
    }

    function testBootstrapCannotBeRepeatedWithLiveShares() public {
        seed();
        uint256 nonce = vault.planNonce();
        uint256[] memory floors = new uint256[](2);
        floors[0] = 1;
        floors[1] = 1;
        vm.expectRevert();
        vault.bootstrap{value: 0.1 ether}(floors, nonce, block.timestamp + 300);
    }

    function testBootstrapFeesAndGenesis() public {
        seed();
        assertEq(vault.totalSupply(), 2.4875 ether);
        assertEq(vault.claimable(treasury, address(w)), 0.0001 ether);
        assertEq(vault.claimable(recipient, address(w)), 0.0004 ether);
        assertEq(vault.freeBalance(address(w)), 0.024875 ether);
    }

    function testUnauthorizedBootstrapRejected() public {
        uint256[] memory f = new uint256[](2);
        f[0] = 1;
        f[1] = 1;
        uint256 nonce = vault.planNonce();
        vm.prank(alice);
        vm.expectRevert();
        vault.bootstrap{value: 0.1 ether}(f, nonce, block.timestamp + 300);
    }

    function testRefundsSurplusAndChargesSpentETHOnly() public {
        seed();
        uint256 s = vault.totalSupply() / 2;
        uint256 beforeEth = alice.balance;
        uint256 refund = join(s, 0.001 ether, 0.08 ether);
        assertEq(alice.balance, beforeEth - 0.08 ether + refund);
        assertEq(vault.balanceOf(alice), s);
        assertEq(a.balanceOf(alice), 0.001 ether);
        assertEq(b.balanceOf(alice), 0.001 ether);
        assertEq(vault.freeBalance(address(a)), 0.0373125 ether * 3 / 2);
        assertEq(vault.reserved(address(a)), 0);
        assertEq(w.allowance(address(vault), address(ex)), 0);
        assertEq(refund, 0.08 ether - ((uint256(0.05175 ether) * 10000 + 9949) / 9950));
    }

    function testDepositCannotUseOldCashForFees() public {
        seed();
        uint256 supply = vault.totalSupply();
        rejectJoin(supply, 0.0995 ether);
        assertEq(vault.totalSupply(), supply);
    }

    function testRoundTripAndReopenExcludesOldClaimsAndDonations() public {
        seed();
        join(vault.totalSupply() / 2, 0, 0.08 ether);
        exit(alice, vault.balanceOf(alice));
        exit(address(this), vault.balanceOf(address(this)));
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.freeBalance(address(w)), 0);
        uint256 feeClaims = vault.reserved(address(w));
        assertGt(feeClaims, 0);
        a.mint(address(vault), 1 ether);
        seed();
        assertEq(vault.claimable(treasury, address(a)), 1 ether);
        assertEq(vault.freeBalance(address(a)), 0.0373125 ether);
        assertGt(vault.reserved(address(w)), feeClaims);
    }

    function testPausedRejectsJoinButAllowsExit() public {
        seed();
        join(vault.totalSupply() / 2, 0, 0.08 ether);
        vault.setPaused(true);
        rejectJoin(1 ether, 0.08 ether);
        exit(alice, vault.balanceOf(alice));
        assertEq(vault.balanceOf(alice), 0);
    }

    function testOldPlanRejectedAfterEconomicsChange() public {
        seed();
        uint256 old = vault.planNonce();
        uint256 shares = vault.totalSupply() / 2;
        (, uint256[] memory amounts) = vault.requiredContributions(shares);
        vault.setCreatorEconomics(recipient, 30);
        vm.prank(alice);
        vm.expectRevert();
        vault.depositExactShares{value: 0.08 ether}(shares, amounts, amounts, old, block.timestamp + 300);
    }

    function testDishonestExecutorCannotMint() public {
        seed();
        ex.setLie(true);
        rejectJoin(vault.totalSupply() / 2, 0.08 ether);
        assertEq(vault.balanceOf(alice), 0);
    }

    function testBlockedSurplusTransferRemainsClaimable() public {
        seed();
        a.setBlocked(true);
        join(vault.totalSupply() / 2, 0.001 ether, 0.08 ether);
        assertEq(vault.claimable(alice, address(a)), 0.001 ether);
        assertEq(vault.reserved(address(a)), 0.001 ether);
        a.setBlocked(false);
        vm.prank(alice);
        vault.claim(address(a), alice);
        assertEq(a.balanceOf(alice), 0.001 ether);
    }

    function testInKindUnavailableTokenDoesNotBlockOthers() public {
        seed();
        a.setBlocked(true);
        vault.emergencyRedeemInKind(vault.balanceOf(address(this)), address(this));
        assertEq(vault.totalSupply(), 0);
        assertGt(vault.claimable(address(this), address(a)), 0);
        assertEq(vault.claimable(address(this), address(b)), 0);
        assertEq(vault.freeBalance(address(a)), 0);
    }

    function testCreatorFeesClaimableOnlyByRecipient() public {
        seed();
        vm.prank(alice);
        vm.expectRevert();
        vault.claim(address(w), alice);
        vm.prank(recipient);
        vault.claim(address(w), recipient);
        assertEq(w.balanceOf(recipient), 0.0004 ether);
    }

    function testCuratorOnlyRebalanceAndMinimumCash() public {
        seed();
        uint256 n = vault.planNonce();
        vm.prank(alice);
        vm.expectRevert();
        vault.rebalance(address(a), true, 0.001 ether, 1, 0, n, block.timestamp + 300);
        vm.expectRevert();
        vault.rebalance(address(a), true, 0.001 ether, 1, 1 ether, n, block.timestamp + 300);
        uint256 nonce = vault.planNonce();
        vault.rebalance(address(a), true, 0.001 ether, 0.001 ether, 0.02 ether, nonce, block.timestamp + 300);
        assertGt(vault.planNonce(), nonce);
    }

    function testFuzzJoinMaintainsAllBacking(uint96 raw) public {
        seed();
        uint256 shares = bound(uint256(raw), 0.5 ether, 5 ether);
        uint256 supply = vault.totalSupply();
        uint256 beforeA = vault.freeBalance(address(a));
        uint256 beforeW = vault.freeBalance(address(w));
        join(shares, 100, 1 ether);
        assertGe(vault.freeBalance(address(a)) * supply, beforeA * vault.totalSupply());
        assertGe(vault.freeBalance(address(w)) * supply, beforeW * vault.totalSupply());
    }
}
