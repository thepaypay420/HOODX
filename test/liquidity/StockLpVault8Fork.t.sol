// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodxLiquiditySleeveV4} from "../../contracts/liquidity/v4/HoodxLiquiditySleeveV4.sol";
import {HoodxStockLpControllerV1} from "../../contracts/liquidity/v4/HoodxStockLpControllerV1.sol";
import {HoodxStockLpVaultV1} from "../../contracts/liquidity/v4/HoodxStockLpVaultV1.sol";
import {IV4StateView, PoolKey} from "../../contracts/liquidity/v4/V4Types.sol";
import {MockPriceRef} from "./StockLpV4Fork.t.sol";

/// @notice Maximum-basket (8 sleeves) lifecycle on a current-state fork: seed, bootstrap, $10 minimum,
///         ETH entry, partial and full ETH exit, paused in-kind recovery, measured gas. Nothing is broadcast.
/// @dev Run with HOODX_FORK_TEST=true ROBINHOOD_RPC_URL=<rpc>. Pools: each stock's cheapest measured
///      route (research/huntx_route_costs.json, block 76,917,183), used as both LP and swap pool.
contract StockLpVault8ForkTest is Test {
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    uint256 constant BLOCK = 76_917_183;
    uint24 constant ETH_FEE = 100;
    int24 constant ETH_SPACING = 1;
    uint256 constant N = 8;

    address curator = address(0xC0FFEE);
    address treasury = address(0x7EA5);
    address seedHolder = address(0x5EED);
    address alice = address(0xA11CE);
    HoodxStockLpVaultV1 vault;
    HoodxStockLpControllerV1 controller;
    HoodxLiquiditySleeveV4[N] sleeves;
    PoolKey[N] keys;
    address[N] stock;
    MockPriceRef ref;
    bool live;

    function _keys() internal pure returns (PoolKey[N] memory k, address[N] memory s) {
        s[0] = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC; // NVDA
        s[1] = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35; // META
        s[2] = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C; // SPY
        s[3] = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa; // SPCX
        s[4] = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A; // PLTR
        s[5] = 0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4; // BABA
        s[6] = 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344; // USO
        s[7] = 0xec262a75e413fAfD0dF80480274532C79D42da09; // MSTR
        uint24[N] memory fee = [uint24(100), 310, 500, 250, 1030, 1000, 1200, 2400];
        int24[N] memory sp = [int24(1), 3, 5, 3, 10, 10, 15, 24];
        for (uint256 i; i < N; ++i) {
            (address c0, address c1) = s[i] < USDG ? (s[i], USDG) : (USDG, s[i]);
            k[i] = PoolKey(c0, c1, fee[i], sp[i], address(0));
        }
    }

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) return;
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envOr("HOODX_FORK_BLOCK", BLOCK));
        live = true;
        (keys, stock) = _keys();
        ref = new MockPriceRef();
        address[] memory sl = new address[](N);
        PoolKey[] memory swapKeys = new PoolKey[](N);
        HoodxStockLpControllerV1.Policy[] memory pol = new HoodxStockLpControllerV1.Policy[](N);
        for (uint256 i; i < N; ++i) {
            (, int24 t, uint24 protocolFee,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
            int24 sp = keys[i].tickSpacing;
            int24 half = _roundUp(100, sp); // ≈ ±1%
            int24 c = _floor(t, sp);
            sleeves[i] = new HoodxLiquiditySleeveV4(
                address(this), PM, STATE_VIEW, keys[i], protocolFee, c - half, c + half, treasury, 1_000,
                "HOODX Stock LP", "hxSLP"
            );
            sl[i] = address(sleeves[i]);
            swapKeys[i] = keys[i];
            pol[i] = HoodxStockLpControllerV1.Policy({
                halfWidth: half,
                makerWidth: 2 * half,
                maxDivergenceBps: 150,
                breachDelay: 24 hours,
                cooldown: 1 hours,
                priceRef: ref,
                tokenDecimals: IERC20Metadata(stock[i]).decimals(),
                quoteDecimals: 6
            });
            _syncRef(i);
        }
        vault = new HoodxStockLpVaultV1(
            address(this), PM, USDG, ETH_FEE, ETH_SPACING, sl, swapKeys, 10e6, 2_000e6, 50,
            "8 tokenized stocks, +/-1% Uniswap V4 ranges, fees compound; 10% performance fee on LP fees only",
            "HOODX Stock LP", "STKX"
        );
        for (uint256 i; i < N; ++i) {
            sleeves[i].setVault(address(vault));
        }
        controller = new HoodxStockLpControllerV1(address(vault), curator, address(this), address(this), sl, pol);
        vault.transferOwnership(address(controller));
        for (uint256 i; i < N; ++i) {
            sleeves[i].transferOwnership(address(controller));
        }
        controller.activate();
        for (uint256 i; i < N; ++i) {
            _seed(i, 15e6); // ≈ $30 per sleeve, ≈ $240 NAV
        }
        controller.bootstrap(seedHolder, 240e18);
    }

    function test_maxBasket_fullLifecycle() public {
        if (!live) return;
        // $10 minimum: $6 rejected, $12 accepted.
        uint256 small = _ethFor(6e6);
        vm.deal(alice, small);
        uint256 s6 = _sharesFor(small);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.BelowMinimum.selector);
        vault.depositEth{value: small}(s6, alice, block.timestamp);
        uint256 twelve = _ethFor(12e6);
        vm.deal(alice, twelve);
        uint256 s12 = _sharesFor(twelve);
        emit log_named_uint("block gas limit", block.gaslimit);
        vm.prank(alice);
        uint256 g = gasleft();
        uint256 used12 = vault.depositEth{value: twelve}(s12, alice, block.timestamp);
        emit log_named_uint("gas: depositEth $12 (8 sleeves)", g - gasleft());

        // $500 entry
        uint256 budget = _ethFor(500e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        uint256 pps = _sleevePerShare();
        vm.prank(alice);
        g = gasleft();
        uint256 used = vault.depositEth{value: budget}(shares, alice, block.timestamp);
        emit log_named_uint("gas: depositEth $500 (8 sleeves)", g - gasleft());
        assertGe(_sleevePerShare(), pps, "no dilution");
        _assertNoResidue();
        uint256 held = vault.balanceOf(alice);

        // Partial ETH exit
        vm.prank(alice);
        g = gasleft();
        uint256 out1 = vault.withdrawEth(held / 2, payable(alice), 1, block.timestamp);
        emit log_named_uint("gas: withdrawEth half (8 sleeves)", g - gasleft());
        _assertNoResidue();

        // Paused: entry blocked, in-kind recovery works for the rest of alice's position.
        vm.prank(curator);
        controller.setManagementPaused(true);
        vm.deal(alice, budget);
        vm.prank(alice);
        vm.expectRevert();
        vault.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.startPrank(alice);
        uint256 rest = vault.balanceOf(alice);
        vault.exitToSleeveShares(rest / 2, alice);
        for (uint256 i; i < N; ++i) {
            uint256 s = sleeves[i].balanceOf(alice);
            assertGt(s, 0, "in-kind sleeve shares received");
            sleeves[i].redeem(s, alice, 0, 0, block.timestamp);
        }
        vm.stopPrank();
        vm.prank(curator);
        controller.setManagementPaused(false);

        // Full ETH exit of the remainder
        uint256 last = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out2 = vault.withdrawEth(last, payable(alice), 1, block.timestamp);
        assertEq(vault.balanceOf(alice), 0, "fully exited");
        _assertNoResidue();
        assertGe(_sleevePerShare(), pps, "seed holder never harmed");
        // ETH-exited fraction of alice's shares = 1 - in-kind fraction (rest / 2 of held)
        uint256 inKind = rest / 2;
        uint256 ethFracBps = 10_000 - inKind * 10_000 / held;
        emit log_named_uint("ETH round trip: ETH back / ETH in, on the ETH-exited fraction (bps)",
            (out1 + out2) * 10_000 * 10_000 / ((used + used12) * ethFracBps));
    }

    // ------------------------------------------------------------------ helpers

    function _id(uint256 i) internal view returns (bytes32) {
        return keccak256(abi.encode(keys[i]));
    }

    function _seed(uint256 i, uint256 usdgBudget) internal {
        address tok = stock[i];
        uint256 unit = 10 ** IERC20Metadata(tok).decimals();
        uint256 tokBudget = Math.mulDiv(usdgBudget, unit, ref.unitValue(tok));
        vm.startPrank(PM);
        IERC20(USDG).transfer(address(this), usdgBudget * 2);
        IERC20(tok).transfer(address(this), tokBudget * 2);
        vm.stopPrank();
        IERC20(USDG).approve(address(sleeves[i]), type(uint256).max);
        IERC20(tok).approve(address(sleeves[i]), type(uint256).max);
        (uint256 max0, uint256 max1) = keys[i].currency0 == USDG ? (usdgBudget, tokBudget) : (tokBudget, usdgBudget);
        uint128 lo = 1;
        uint128 hi = type(uint128).max / 2;
        for (uint256 k; k < 128 && lo < hi; ++k) {
            uint128 mid = lo + (hi - lo + 1) / 2;
            uint256 snap = vm.snapshotState();
            try controller.seedSleeve(i, mid, max0, max1, block.timestamp) {
                lo = mid;
            } catch {
                hi = mid - 1;
            }
            vm.revertToState(snap);
        }
        controller.seedSleeve(i, lo, max0, max1, block.timestamp);
    }

    function _syncRef(uint256 i) internal {
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
        uint256 unit = 10 ** IERC20Metadata(stock[i]).decimals();
        uint256 v = keys[i].currency0 == USDG
            ? Math.mulDiv(unit, uint256(1) << 192, uint256(sqrtP) * uint256(sqrtP))
            : Math.mulDiv(Math.mulDiv(unit, uint256(sqrtP), uint256(1) << 96), uint256(sqrtP), uint256(1) << 96);
        ref.set(stock[i], v);
    }

    function _sharesFor(uint256 budget) internal returns (uint256) {
        uint256 probe = vault.totalSupply() / 5;
        uint256 probeValue = _ethFor(150e6);
        uint256 snap = vm.snapshotState();
        vm.deal(address(0xD00D), probeValue);
        vm.prank(address(0xD00D));
        uint256 used = vault.depositEth{value: probeValue}(probe, address(0xD00D), block.timestamp);
        vm.revertToState(snap);
        return probe * budget * 98 / 100 / used;
    }

    function _ethFor(uint256 usdgAmount) internal view returns (uint256) {
        bytes32 id = keccak256(abi.encode(PoolKey(address(0), USDG, ETH_FEE, ETH_SPACING, address(0))));
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(id);
        return Math.mulDiv(usdgAmount, uint256(1) << 192, uint256(sqrtP) * uint256(sqrtP));
    }

    function _sleevePerShare() internal view returns (uint256 m) {
        m = type(uint256).max;
        for (uint256 i; i < N; ++i) {
            uint256 r = Math.mulDiv(sleeves[i].balanceOf(address(vault)), 1e36, vault.totalSupply());
            if (r < m) m = r;
        }
    }

    function _assertNoResidue() internal view {
        assertEq(IERC20(USDG).balanceOf(address(vault)), 0, "no USDG left in vault");
        for (uint256 i; i < N; ++i) {
            assertEq(IERC20(stock[i]).balanceOf(address(vault)), 0, "no stock left in vault");
        }
        assertEq(address(vault).balance, 0, "no ETH left in vault");
    }

    function _floor(int24 tick, int24 spacing) internal pure returns (int24 c) {
        c = tick / spacing * spacing;
        if (tick < 0 && tick % spacing != 0) c -= spacing;
    }

    function _roundUp(int24 x, int24 spacing) internal pure returns (int24) {
        return (x + spacing - 1) / spacing * spacing;
    }
}
