// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodxBoostVaultV1} from "../../contracts/boost/HoodxBoostVaultV1.sol";
import {HoodxBoostSignalV1} from "../../contracts/boost/HoodxBoostSignalV1.sol";
import {IMorphoOracle, IUniswapV3PoolLike} from "../../contracts/boost/BoostTypes.sol";
import {BoostForkBase, IMorphoSupply} from "./BoostForkBase.sol";

/// @dev Moves the WETH/USDG pool to an exact price with its own funds (an attacker or a large trader).
contract PoolPusher {
    address immutable pool;

    constructor(address p) {
        pool = p;
    }

    function push(bool wethIn, uint160 limit) external {
        IUniswapV3PoolLike(pool).swap(address(this), wethIn, type(int128).max, limit, "");
    }

    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata) external {
        if (a0 > 0) IERC20(IUniswapV3PoolLike(pool).token0()).transfer(pool, uint256(a0));
        if (a1 > 0) IERC20(IUniswapV3PoolLike(pool).token1()).transfer(pool, uint256(a1));
    }
}

/// @notice Adversarial fork tests: price manipulation around rebalances, exhausted borrow liquidity, an illiquid dollar
///         vault, price shocks at full leverage, and the real on-chain signal driving the vault end to end.
contract BoostVaultAdversarialTest is BoostForkBase {
    function _pushPoolBy(int256 bps) internal {
        PoolPusher p = new PoolPusher(POOL);
        deal(USDG, address(p), 200_000_000e6);
        deal(WETH, address(p), 100_000 ether);
        (uint160 sp,,,,,,) = IUniswapV3PoolLike(POOL).slot0();
        // price ~ sqrtP^2: a move of `bps` needs sqrtP * sqrt(1 + bps/1e4)
        uint256 f = Math.sqrt(uint256(int256(10_000 + bps)) * 1e36 / 10_000);
        p.push(bps < 0, uint160(uint256(sp) * f / 1e18));
    }

    /// An attacker who pushes the pool before a rebalance can cost the vault at most the swap bound (0.5% of one slice);
    /// a bigger push makes the rebalance revert instead of trading.
    function test_sandwichIsBoundedBySlippage() public {
        _deposit(alice, 10 ether);
        sig.set(1.8e18, true);
        uint256 nav0 = vault.state().nav;
        _pushPoolBy(30); // +0.30%: the vault now buys WETH dear
        vault.rebalance();
        HoodxBoostVaultV1.State memory s = vault.state();
        uint256 traded = s.debt; // dollars spent buying WETH
        assertGt(traded, 0);
        assertGe(s.nav, nav0 - traded * 60 / 10_000, "loss bounded by the 0.5% swap bound plus the pool fee");
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        sig.set(0, true);
        _pushPoolBy(-100); // from +0.3% to about -0.7% vs the oracle: inside the 1% band, beyond the 0.5% swap bound
        vm.expectRevert(HoodxBoostVaultV1.Slippage.selector);
        vault.rebalance();
    }

    function test_manipulatedPoolBlocksDeposits() public {
        _pushPoolBy(150); // beyond the 1% oracle band
        vm.prank(alice);
        vm.expectRevert(HoodxBoostVaultV1.Divergence.selector);
        vault.deposit{value: 1 ether}(alice, 0, vm.getBlockTimestamp() + 60);
    }

    function _drainBorrowLiquidity() internal {
        vm.prank(lender);
        IMorphoSupply(MORPHO).withdraw(_mp(), 1_990_000e6, 0, lender, lender);
        (uint128 tsa,, uint128 tba,,,) = IMorphoSupply(MORPHO).market(MARKET);
        uint256 free = uint256(tsa) - uint256(tba);
        address whale = makeAddr("whale");
        deal(WETH, whale, 10_000 ether);
        vm.startPrank(whale);
        IERC20(WETH).approve(MORPHO, type(uint256).max);
        IMorphoSupply(MORPHO).supplyCollateral(_mp(), 10_000 ether, whale, "");
        IMorphoSupply(MORPHO).borrow(_mp(), free, 0, whale, whale);
        vm.stopPrank();
    }

    /// With no USDG left to borrow, deposits still work fairly at lower leverage and exits always work.
    function test_noBorrowLiquidityDegradesGracefully() public {
        _deposit(alice, 5 ether);
        _drainBorrowLiquidity();
        sig.set(1.8e18, true);
        vm.expectRevert(HoodxBoostVaultV1.Illiquid.selector); // nothing to borrow and no dollars on hand
        vault.rebalance();
        uint256 nps = vault.navPerShare();
        _deposit(bob, 3 ether);
        assertGe(vault.navPerShare(), nps - nps / 1e9);
        assertApproxEqAbs(vault.state().leverage, 1e18, 0.01e18);
        uint256 sh = vault.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(sh, payable(alice), 1, vm.getBlockTimestamp() + 60);
    }

    /// If the dollar vault cannot pay out, the ETH withdrawal reverts but the in-kind exit still works.
    function test_illiquidDollarVaultStillAllowsInKindExit() public {
        uint256 sh = _deposit(alice, 5 ether);
        _rebalanceTo(0);
        vm.mockCallRevert(CASH, abi.encodeWithSelector(IERC4626.redeem.selector), "illiquid");
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(sh, payable(alice), 1, vm.getBlockTimestamp() + 60);
        vm.prank(alice);
        (, uint256 cashOut,) = vault.exitInKind(sh, alice);
        assertGt(cashOut, 0);
        assertEq(IERC20(CASH).balanceOf(alice), cashOut);
    }

    /// Successive price shocks at full leverage with a stale keeper signal: emergency cuts keep the vault under its own
    /// LTV ceiling and far from Morpho's 77% liquidation line.
    function test_priceShocksStayFarFromLiquidation() public {
        _deposit(alice, 8 ether);
        _rebalanceTo(2e18);
        uint256 p = IMorphoOracle(ORACLE).price();
        sig.set(2e18, false);
        for (uint256 i = 1; i <= 4; ++i) {
            uint256 shocked = p * (100 - 3 * i) / 100; // -3%, -6%, -9%, -12%
            vm.mockCall(ORACLE, abi.encodeWithSelector(IMorphoOracle.price.selector), abi.encode(shocked));
            (bool ready, bool emergency,,,) = vault.rebalanceStatus();
            if (ready && emergency) vault.rebalance();
            HoodxBoostVaultV1.State memory s = vault.state();
            uint256 ltv = s.debt * 1e18 / (s.collateral * s.price / 1e36);
            assertLt(ltv, 0.5625e18, "below the vault's own LTV ceiling");
            assertLt(ltv, 0.77e18 * 3 / 4, "far from Morpho's 77% liquidation line");
        }
    }

    /// Dead-man switch: a signal silent for 24h lets anyone step leverage down to 1x, but never up.
    function test_deadSignalOnlyDeRisks() public {
        _deposit(alice, 5 ether);
        _rebalanceTo(1.9e18);
        sig.set(1.9e18, false); // signal stops updating
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        vm.expectRevert(HoodxBoostVaultV1.Stale.selector); // stale but not yet dead
        vault.rebalance();
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        (bool ready,,, uint256 t,) = vault.rebalanceStatus();
        assertTrue(ready);
        assertEq(t, 1e18);
        vm.prank(bob);
        vault.rebalance();
        assertApproxEqAbs(vault.state().leverage, 1e18, 0.1e18);
        // at 1x a dead signal cannot push leverage anywhere
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(HoodxBoostVaultV1.Stale.selector);
        vault.rebalance();
    }

    /// The real signal, seeded from deployments/boost-eth-seed.json and reading the live Chainlink feeds, drives a vault.
    function test_realSignalEndToEnd() public {
        string memory j = vm.readFile("deployments/boost-eth-seed.json");
        uint128[8] memory ee;
        uint128[8] memory be;
        string[] memory es = vm.parseJsonStringArray(j, ".ethEma");
        string[] memory bs = vm.parseJsonStringArray(j, ".btcEma");
        for (uint256 i; i < 8; ++i) {
            ee[i] = uint128(vm.parseUint(es[i]));
            be[i] = uint128(vm.parseUint(bs[i]));
        }
        HoodxBoostSignalV1 real = new HoodxBoostSignalV1(
            0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9, 0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251, 25 hours, 25 hours,
            ee, be, uint8(vm.parseJsonUint(j, ".ethFlags")), uint8(vm.parseJsonUint(j, ".btcFlags")),
            vm.parseUint(vm.parseJsonString(j, ".ethVar")), vm.parseUint(vm.parseJsonString(j, ".ethLast")),
            vm.parseUint(vm.parseJsonString(j, ".btcLast"))
        );
        HoodxBoostVaultV1 v = new HoodxBoostVaultV1(curator, _config(address(real)), "HOODX Boosted ETH", "BOOSTX");
        vm.prank(curator);
        v.bootstrap{value: 2 ether}(curator);
        vm.warp((vm.getBlockTimestamp() / 1 hours + 1) * 1 hours + 5);
        uint256 t = real.poke();
        assertLe(t, 2e18);
        (bool ready,,,,) = v.rebalanceStatus();
        if (ready) v.rebalance();
        uint256 lev = v.state().leverage;
        uint256 gap = lev > t ? lev - t : t - lev;
        assertLe(gap, v.BAND() + 0.02e18, "the vault follows the live signal");
    }
}
