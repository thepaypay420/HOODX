// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxBoostVaultV1} from "../../contracts/boost/HoodxBoostVaultV1.sol";
import {IMorphoOracle} from "../../contracts/boost/BoostTypes.sol";
import {BoostForkBase} from "./BoostForkBase.sol";

/// @notice Core fork tests: accounting, fairness in every regime, rebalancing, exits, fees, access control.
///         Run: FOUNDRY_PROFILE=boost forge test (ROBINHOOD_RPC_URL optional). Nothing is broadcast.
contract BoostVaultForkTest is BoostForkBase {
    // ------------------------------------------------------------------ setup and accounting

    function test_bootstrapState() public view {
        HoodxBoostVaultV1.State memory s = vault.state();
        assertEq(vault.totalSupply(), s.nav * 1e12); // 1 share = 1 USDG at launch
        assertEq(vault.balanceOf(address(0xdead)), vault.DEAD_SHARES());
        assertApproxEqRel(s.leverage, 1e18, 1e15);
        assertEq(s.debt, 0);
        assertEq(vault.highWaterMark(), vault.navPerShare());
        assertGt(vault.launchEthPrice(), 0);
        assertTrue(vault.bootstrapped());
    }

    function test_constructorRejectsWrongMarketOrPool() public {
        HoodxBoostVaultV1.Config memory c = _config(address(sig));
        c.marketId = bytes32(uint256(1));
        vm.expectRevert();
        new HoodxBoostVaultV1(curator, c, "x", "x");
        c = _config(address(sig));
        c.maxSlipBps = 0;
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        new HoodxBoostVaultV1(curator, c, "x", "x");
        c = _config(address(sig));
        c.minInterval = 1 minutes;
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        new HoodxBoostVaultV1(curator, c, "x", "x");
    }

    function test_bootstrapOnlyOnceAndOnlyOwner() public {
        vm.prank(curator);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.bootstrap{value: 1 ether}(curator);
        vm.prank(alice);
        vm.expectRevert();
        vault.bootstrap{value: 1 ether}(alice);
    }

    // ------------------------------------------------------------------ deposits are fair in every regime

    function _depositFairness(uint256 t) internal {
        if (t != 1e18) _rebalanceTo(t);
        uint256 before = vault.navPerShare();
        uint256 levBefore = _lev();
        _deposit(alice, 5 ether);
        uint256 afterNps = vault.navPerShare();
        assertGe(afterNps, before - before / 1e9, "existing holders never lose to a deposit (beyond 1e-9 rounding)");
        assertApproxEqAbs(_lev(), levBefore, 0.02e18, "deposit keeps the vault's shape");
        // the depositor's value is the deposit minus its own entry costs (well under 1% at this size)
        HoodxBoostVaultV1.State memory s = vault.state();
        uint256 aliceValue = s.nav * vault.balanceOf(alice) / vault.totalSupply();
        uint256 depositValue = 5 ether * s.price / 1e36;
        assertGt(aliceValue, depositValue * 99 / 100);
        assertLe(aliceValue, depositValue * 101 / 100); // the pool may pay up to the 1% oracle band above the oracle
    }

    function test_depositAtOneX() public {
        _depositFairness(1e18);
    }

    function test_depositAtBoosted() public {
        _depositFairness(1.8e18);
    }

    function test_depositInDollars() public {
        _depositFairness(0);
    }

    function test_depositPartlyInDollars() public {
        _depositFairness(0.5e18);
    }

    function test_depositGuards() public {
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.deposit{value: 0.001 ether}(alice, 0, vm.getBlockTimestamp() + 60); // below minimum
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Stale.selector);
        vault.deposit{value: 1 ether}(alice, 0, vm.getBlockTimestamp() + 1 hours);
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.deposit{value: 1 ether}(address(vault), 0, vm.getBlockTimestamp() + 60);
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Slippage.selector);
        vault.deposit{value: 1 ether}(alice, type(uint256).max, vm.getBlockTimestamp() + 60);
    }

    function test_depositRejectedWhenOracleAndPoolDisagree() public {
        uint256 p = IMorphoOracle(ORACLE).price();
        vm.mockCall(ORACLE, abi.encodeWithSelector(IMorphoOracle.price.selector), abi.encode(p * 103 / 100));
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Divergence.selector);
        vault.deposit{value: 1 ether}(alice, 0, vm.getBlockTimestamp() + 60);
    }

    function test_tvlCap() public {
        vm.deal(alice, 1_000 ether);
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.CapExceeded.selector);
        vault.deposit{value: 400 ether}(alice, 0, vm.getBlockTimestamp() + 60);
    }

    function test_pauseStopsDepositsNotExits() public {
        uint256 sh = _deposit(alice, 2 ether);
        vm.prank(curator);
        vault.setDepositsPaused(true);
        vm.prank(bob);
        vm.expectRevert(HoodxBoostVaultV1.Paused.selector);
        vault.deposit{value: 1 ether}(bob, 0, vm.getBlockTimestamp() + 60);
        vm.prank(alice);
        vault.withdraw(sh, payable(alice), 1, vm.getBlockTimestamp() + 60);
        vm.prank(alice);
        vm.expectRevert();
        vault.setDepositsPaused(false);
    }

    // ------------------------------------------------------------------ rebalancing

    function test_rebalanceUpToBoostAndBack() public {
        _deposit(alice, 5 ether);
        _rebalanceTo(1.8e18);
        assertApproxEqAbs(_lev(), 1.8e18, 0.1e18);
        HoodxBoostVaultV1.State memory s = vault.state();
        assertGt(s.debt, 0);
        assertLe(s.debt * 1e18, s.collateral * s.price / 1e36 * 0.5625e18);
        _rebalanceTo(0.5e18);
        s = vault.state();
        assertApproxEqAbs(s.leverage, 0.5e18, 0.1e18);
        assertEq(s.debt, 0, "no debt below 1x");
        assertGt(s.cashUsdg, 0, "dollars earn in the dollar vault");
        _rebalanceTo(0);
        s = vault.state();
        assertLt(s.leverage, 0.1e18);
        _rebalanceTo(1e18);
        assertApproxEqAbs(_lev(), 1e18, 0.1e18);
    }

    function test_rebalanceCostIsSmall() public {
        _deposit(alice, 5 ether);
        uint256 nps0 = vault.navPerShare();
        _rebalanceTo(1.8e18);
        _rebalanceTo(0);
        _rebalanceTo(1e18);
        // three full swings: the round-trip costs (0.01% pool fee + impact) stay well under 1%
        assertGt(vault.navPerShare(), nps0 * 99 / 100);
    }

    function test_rebalanceGuards() public {
        sig.set(1e18, true);
        vm.expectRevert(HoodxBoostVaultV1.NotNeeded.selector); // inside the band
        vault.rebalance();
        sig.set(1.8e18, false);
        vm.expectRevert(HoodxBoostVaultV1.Stale.selector); // stale signal
        vault.rebalance();
        sig.set(1.8e18, true);
        vault.rebalance();
        sig.set(0, true);
        vm.expectRevert(HoodxBoostVaultV1.NotNeeded.selector); // min interval
        vault.rebalance();
        vm.warp(vm.getBlockTimestamp() + 56 minutes);
        uint256 p = IMorphoOracle(ORACLE).price();
        vm.mockCall(ORACLE, abi.encodeWithSelector(IMorphoOracle.price.selector), abi.encode(p * 102 / 100));
        vm.expectRevert(HoodxBoostVaultV1.Divergence.selector); // pool disagrees with oracle
        vault.rebalance();
    }

    function test_rebalanceIsSliced() public {
        vm.deal(alice, 200 ether);
        _deposit(alice, 150 ether); // ~$400k vault
        sig.set(2e18, true);
        vault.rebalance();
        HoodxBoostVaultV1.State memory s = vault.state();
        // one call moves at most maxSlice ($100k) of exposure
        assertLt(s.debt, 101_000e6);
        assertLt(s.leverage, 1.3e18);
    }

    function test_emergencyDeleverEvenWithStaleSignal() public {
        _deposit(alice, 5 ether);
        _rebalanceTo(2e18);
        uint256 p = IMorphoOracle(ORACLE).price();
        vm.mockCall(ORACLE, abi.encodeWithSelector(IMorphoOracle.price.selector), abi.encode(p * 96 / 100));
        assertGt(_lev(), vault.HARD_CAP());
        sig.set(2e18, false); // keeper's signal is stale; anyone may still cut
        (bool ready, bool emergency,,,) = vault.rebalanceStatus();
        assertTrue(ready && emergency);
        vm.prank(bob);
        vault.rebalance();
        assertLe(_lev(), 2.02e18);
    }

    // ------------------------------------------------------------------ withdrawals

    function _withdrawFairness(uint256 t) internal {
        uint256 sh = _deposit(alice, 5 ether);
        _deposit(bob, 3 ether);
        if (t != 1e18) _rebalanceTo(t);
        uint256 npsBefore = vault.navPerShare();
        HoodxBoostVaultV1.State memory s = vault.state();
        uint256 fair = s.nav * (sh / 2) / vault.totalSupply(); // USDG value of the slice
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        uint256 out = vault.withdraw(sh / 2, payable(alice), 1, vm.getBlockTimestamp() + 60);
        assertEq(alice.balance - balBefore, out);
        uint256 outValue = out * s.price / 1e36;
        assertGt(outValue, fair * 99 / 100, "withdrawer gets its slice minus its own exit costs");
        assertLe(outValue, fair * 101 / 100); // the pool may pay up to the 1% oracle band above the oracle
        assertGe(vault.navPerShare(), npsBefore - npsBefore / 1e9, "remaining holders never lose to a withdrawal (beyond 1e-9 rounding)");
    }

    function test_withdrawAtOneX() public {
        _withdrawFairness(1e18);
    }

    function test_withdrawBoostedUsesFlashLoan() public {
        _withdrawFairness(1.8e18);
    }

    function test_withdrawFromDollars() public {
        _withdrawFairness(0);
    }

    function test_withdrawPartlyDollars() public {
        _withdrawFairness(0.5e18);
    }

    function test_withdrawGuards() public {
        uint256 sh = _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.withdraw(sh + 1, payable(alice), 1, vm.getBlockTimestamp() + 60);
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Slippage.selector);
        vault.withdraw(sh, payable(alice), 100 ether, vm.getBlockTimestamp() + 60);
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.withdraw(sh, payable(alice), 0, vm.getBlockTimestamp() + 60);
    }

    function test_fullExitOfAllNonDeadShares() public {
        uint256 sh = _deposit(alice, 4 ether);
        _rebalanceTo(1.9e18);
        vm.prank(alice);
        vault.withdraw(sh, payable(alice), 1, vm.getBlockTimestamp() + 60);
        uint256 cs = vault.balanceOf(curator);
        vm.prank(curator);
        vault.withdraw(cs, payable(curator), 1, vm.getBlockTimestamp() + 60);
        HoodxBoostVaultV1.State memory s = vault.state();
        assertEq(vault.totalSupply(), vault.DEAD_SHARES());
        assertLt(s.nav, 5e6, "only dust stays behind the dead shares");
    }

    // ------------------------------------------------------------------ in-kind exit (no swaps)

    function test_exitInKindWithDebt() public {
        uint256 sh = _deposit(alice, 5 ether);
        _rebalanceTo(1.8e18);
        (uint256 wethOut, uint256 usdgIn, uint256 cashOut,) = vault.previewExitInKind(sh);
        assertGt(usdgIn, 0);
        deal(USDG, alice, usdgIn);
        uint256 npsBefore = vault.navPerShare();
        vm.startPrank(alice);
        IERC20(USDG).approve(address(vault), usdgIn);
        (uint256 w,, uint256 repaid) = vault.exitInKind(sh, alice);
        vm.stopPrank();
        assertEq(w, wethOut);
        assertEq(IERC20(WETH).balanceOf(alice), wethOut);
        assertEq(IERC20(CASH).balanceOf(alice), cashOut);
        assertLe(repaid, usdgIn);
        assertGe(vault.navPerShare(), npsBefore - npsBefore / 1e9);
    }

    function test_exitInKindFromDollars() public {
        uint256 sh = _deposit(alice, 5 ether);
        _rebalanceTo(0);
        (, uint256 usdgIn, uint256 cashOut,) = vault.previewExitInKind(sh);
        assertEq(usdgIn, 0);
        vm.prank(alice);
        vault.exitInKind(sh, alice);
        assertEq(IERC20(CASH).balanceOf(alice), cashOut);
        assertGt(cashOut, 0);
    }

    // ------------------------------------------------------------------ fees

    function test_performanceFeeAboveHighWaterMark() public {
        _deposit(alice, 5 ether);
        vm.expectRevert(HoodxBoostVaultV1.NotNeeded.selector); // not before 30 days
        vault.crystalliseFees();
        vm.warp(vm.getBlockTimestamp() + 31 days);
        uint256 p = IMorphoOracle(ORACLE).price();
        vm.mockCall(ORACLE, abi.encodeWithSelector(IMorphoOracle.price.selector), abi.encode(p * 120 / 100));
        uint256 hwm = vault.highWaterMark();
        uint256 nps = vault.navPerShare();
        uint256 supply = vault.totalSupply();
        uint256 nav = vault.state().nav;
        uint256 feeShares = vault.crystalliseFees();
        uint256 feeValue = nav * feeShares / (supply + feeShares);
        uint256 gain = (nps - hwm) * supply / 1e36;
        assertApproxEqRel(feeValue, gain / 10, 1e15, "10% of the gain");
        assertEq(vault.balanceOf(fees), feeShares);
        assertGt(vault.highWaterMark(), hwm);
        // no fee again until NAV per share beats the new mark
        vm.warp(vm.getBlockTimestamp() + 31 days);
        assertEq(vault.crystalliseFees(), 0);
    }

    // ------------------------------------------------------------------ access control and plumbing

    function test_callbacksRejectStrangers() public {
        vm.expectRevert(HoodxBoostVaultV1.Unauthorized.selector);
        vault.uniswapV3SwapCallback(1, 1, "");
        vm.expectRevert(HoodxBoostVaultV1.Unauthorized.selector);
        vault.onMorphoFlashLoan(1, "");
        vm.prank(POOL);
        vm.expectRevert(HoodxBoostVaultV1.Unauthorized.selector); // pool, but not during a vault swap
        vault.uniswapV3SwapCallback(1, 1, "");
        vm.prank(MORPHO);
        vm.expectRevert(HoodxBoostVaultV1.Unauthorized.selector);
        vault.onMorphoFlashLoan(1, "");
    }

    function test_curatorPowersAreBounded() public {
        vm.startPrank(curator);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.rescueUnexpectedToken(WETH, curator, 1);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.rescueUnexpectedToken(USDG, curator, 1);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.rescueUnexpectedToken(CASH, curator, 1);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.renounceOwnership();
        vm.stopPrank();
        vm.expectRevert();
        vault.setDepositsPaused(true);
    }

    function test_shareTransfers() public {
        uint256 sh = _deposit(alice, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.transfer(address(vault), 1);
        vm.expectRevert(HoodxBoostVaultV1.Invalid.selector);
        vault.transfer(address(0xdead), 1);
        vault.transfer(bob, sh);
        vm.stopPrank();
        assertEq(vault.balanceOf(bob), sh);
    }

    function test_rejectsStrayEth() public {
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------------ fuzz: holders are never diluted

    /// forge-config: boost.fuzz.runs = 40
    function testFuzz_depositsAndWithdrawalsNeverDilute(uint256 seed) public {
        uint256 bobShares = _deposit(bob, 3 ether);
        uint256 targetSeed = seed % 4;
        _rebalanceTo(targetSeed == 0 ? 0 : targetSeed == 1 ? 0.6e18 : targetSeed == 2 ? 1.3e18 : 1.95e18);
        uint256 nps = vault.navPerShare();
        uint256 aliceShares;
        for (uint256 i; i < 4; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            if (seed % 2 == 0 || aliceShares == 0) {
                aliceShares += _deposit(alice, 0.01 ether + seed % 20 ether);
            } else {
                uint256 sh = 1 + seed % aliceShares;
                vm.prank(alice);
                vault.withdraw(sh, payable(alice), 1, vm.getBlockTimestamp() + 60);
                aliceShares -= sh;
            }
            uint256 n = vault.navPerShare();
            assertGe(n, nps - nps / 1e9, "NAV per share never falls on deposits or withdrawals (beyond 1e-9 rounding)");
            nps = n > nps ? n : nps;
        }
        assertEq(vault.balanceOf(bob), bobShares);
    }
}
