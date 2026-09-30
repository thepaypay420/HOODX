// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodxLiquiditySleeveV4} from "../../contracts/liquidity/v4/HoodxLiquiditySleeveV4.sol";
import {HoodxStockLpControllerV1} from "../../contracts/liquidity/v4/HoodxStockLpControllerV1.sol";
import {HoodxStockLpVaultV1} from "../../contracts/liquidity/v4/HoodxStockLpVaultV1.sol";
import {IPriceReference, IV4StateView, PoolKey} from "../../contracts/liquidity/v4/V4Types.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";

interface IV3FactoryLookup {
    function getPool(address, address, uint24) external view returns (address);
}

struct SwapParamsT {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManagerSwap {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParamsT memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

/// @dev Test-only settable price reference (stands in for HOODX CL TWAPs over the stock's V3 pools).
contract MockPriceRef is IPriceReference {
    mapping(address => uint256) public unitValue;

    function set(address token, uint256 v) external {
        unitValue[token] = v;
    }

    function value(address token, uint256) external view returns (uint256) {
        return unitValue[token];
    }
}

/// @dev Test-only external trader: exact-input swaps settled directly against the PoolManager.
contract Trader {
    IPoolManagerSwap constant PM = IPoolManagerSwap(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    uint160 constant MIN_SQRT = 4295128740;
    uint160 constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;

    function swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) external {
        PM.unlock(abi.encode(key, zeroForOne, amountIn));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(PM), "pm");
        (PoolKey memory key, bool z, uint256 amt) = abi.decode(data, (PoolKey, bool, uint256));
        int256 d = PM.swap(key, SwapParamsT(z, -int256(amt), z ? MIN_SQRT + 1 : MAX_SQRT - 1), "");
        _settle(key.currency0, int128(d >> 128));
        _settle(key.currency1, int128(d));
        return "";
    }

    function _settle(address c, int128 d) internal {
        if (d < 0) {
            PM.sync(c);
            IERC20(c).transfer(address(PM), uint256(uint128(-d)));
            PM.settle();
        } else if (d > 0) {
            PM.take(c, address(this), uint256(uint128(d)));
        }
    }
}

/// @notice Fork lifecycle tests for the HOODX stock-token LP index (V4 sleeves + controller).
/// @dev Run with HOODX_FORK_TEST=true ROBINHOOD_RPC_URL=<rpc>. Nothing is broadcast.
contract StockLpV4ForkTest is Test {
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    uint256 constant REVIEW_BLOCK = 76_679_496;
    uint24 constant PROTOCOL_FEE = 2_048_500; // 500 pips each direction, packed
    int24 constant HALF = 240; // 4 spacings of 60 ≈ ±2.4%
    int24 constant MAKER = 480;

    address curator = address(0xC0FFEE);
    address user = address(0xBEEF);
    address treasury = address(0x7EA5);
    address alice = address(0xA11CE);
    uint24 constant ETH_FEE = 100;
    int24 constant ETH_SPACING = 1;
    uint16 constant PERF_BPS = 1_000;
    HoodxStockLpVaultV1 index;
    HoodxStockLpControllerV1 controller;
    HoodxLiquiditySleeveV4[2] sleeves;
    PoolKey[2] keys;
    address[2] stock;
    MockPriceRef ref;
    Trader trader;
    bool live;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) return;
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envOr("HOODX_FORK_BLOCK", REVIEW_BLOCK));
        live = true;
        keys[0] = PoolKey(USDG, META, 3000, 60, address(0)); // quote is token0
        keys[1] = PoolKey(SPY, USDG, 3000, 60, address(0)); // quote is token1
        stock[0] = META;
        stock[1] = SPY;
        ref = new MockPriceRef();
        trader = new Trader();
        address[] memory sl = new address[](2);
        HoodxStockLpControllerV1.Policy[] memory pol = new HoodxStockLpControllerV1.Policy[](2);
        for (uint256 i; i < 2; ++i) {
            int24 c = _floor(_tick(i), 60);
            sleeves[i] = new HoodxLiquiditySleeveV4(
                address(this), PM, STATE_VIEW, keys[i], PROTOCOL_FEE, c - HALF, c + HALF, treasury, PERF_BPS,
                "HOODX Stock LP", "hxSLP"
            );
            sl[i] = address(sleeves[i]);
            pol[i] = HoodxStockLpControllerV1.Policy({
                halfWidth: HALF,
                makerWidth: MAKER,
                maxDivergenceBps: 150,
                breachDelay: 24 hours,
                cooldown: 1 hours,
                priceRef: ref,
                tokenDecimals: 18,
                quoteDecimals: 6
            });
            _syncRef(i);
        }
        PoolKey[] memory swapKeys = new PoolKey[](2);
        swapKeys[0] = keys[0];
        swapKeys[1] = keys[1];
        index = new HoodxStockLpVaultV1(
            address(this), PM, USDG, ETH_FEE, ETH_SPACING, sl, swapKeys, 10e6, 2_000e6, 50,
            "8 tokenized stocks, +/-1% Uniswap V4 ranges, fees compound; 10% performance fee on LP fees only",
            "HOODX Stock LP", "STKX"
        );
        for (uint256 i; i < 2; ++i) {
            sleeves[i].setVault(address(index));
        }
        controller = new HoodxStockLpControllerV1(address(index), curator, address(this), address(this), sl, pol);
        index.transferOwnership(address(controller));
        for (uint256 i; i < 2; ++i) {
            sleeves[i].transferOwnership(address(controller));
        }
        controller.activate();
        for (uint256 i; i < 2; ++i) {
            _seed(i, 40e6);
        }
        controller.bootstrap(user, 160e18); // ≈ $1 per share at seed
    }

    // ------------------------------------------------------------------ tests

    function test_lifecycle_feesHarvestCompoundAndExitInKind() public {
        if (!live) return;
        for (uint256 i; i < 2; ++i) {
            _churn(i, 20, 300e6);
            _syncRef(i);
            vm.prank(curator);
            (uint256 a0, uint256 a1) = controller.harvest(i);
            assertGt(a0 + a1, 0, "fees accrued to the sleeve");
            uint128 before = sleeves[i].positionLiquidity();
            _compoundMax(i);
            assertGe(sleeves[i].positionLiquidity(), before, "compound never reduces liquidity");
        }
        // Exit: index -> sleeve shares -> underlying tokens, with management paused (must still work).
        vm.prank(curator);
        controller.setManagementPaused(true);
        vm.startPrank(user);
        index.exitToSleeveShares(index.balanceOf(user) / 2, user);
        for (uint256 i; i < 2; ++i) {
            uint256 shares = sleeves[i].balanceOf(user);
            assertGt(shares, 0);
            uint256 u0 = IERC20(USDG).balanceOf(user);
            uint256 s0 = IERC20(stock[i]).balanceOf(user);
            sleeves[i].redeem(shares, user, 0, 0, block.timestamp);
            assertGt(IERC20(USDG).balanceOf(user) - u0 + (IERC20(stock[i]).balanceOf(user) - s0), 0);
        }
        vm.stopPrank();
    }

    function test_oneSidedMakerRebandAfterSustainedBreach() public {
        if (!live) return;
        for (uint256 i; i < 2; ++i) {
            int24 lowerBefore = sleeves[i].tickLower();
            // Buy the stock until the pool leaves the range (price of the stock rises by > ±2.4%).
            bool buyStockZeroForOne = keys[i].currency0 == USDG;
            uint256 pushes;
            for (uint256 k; k < 240 && !_beyond(i, 3 * 60); ++k) {
                _swap(i, buyStockZeroForOne, 50_000e6);
                pushes++;
            }
            emit log_named_uint("USDG pushed (thousands) to leave the range", pushes * 50);
            assertFalse(_inRange(i), "pushed out of range");
            _syncRef(i);
            // Keeper pings every 29 minutes for > 24 h; reference stays in agreement.
            for (uint256 k; k < 52; ++k) {
                vm.warp(block.timestamp + 29 minutes);
                vm.roll(block.number + 17_000);
                controller.signal(i);
            }
            uint128 L = sleeves[i].positionLiquidity() * 4;
            bool done;
            for (uint256 k; k < 80 && !done; ++k) {
                vm.prank(curator);
                try controller.executeReband(i, L, block.timestamp) {
                    done = true;
                } catch {
                    L = L * 9 / 10;
                }
            }
            assertTrue(done, "reband funded from own balances");
            (, int24 t) = sleeves[i].spot();
            int24 lo = sleeves[i].tickLower();
            int24 hi = sleeves[i].tickUpper();
            assertEq(hi - lo, MAKER, "maker width");
            assertTrue(lo > t || hi <= t, "range is one-sided (entirely off the current price)");
            assertTrue(lo != lowerBefore, "range moved");
        }
    }

    function test_edgeCrossingNoOpRebandIsRefused() public {
        if (!live) return;
        bool buyStockZeroForOne = keys[0].currency0 == USDG;
        for (uint256 k; k < 240 && _inRange(0); ++k) {
            _swap(0, buyStockZeroForOne, 5_000e6);
        }
        vm.assume(!_inRange(0) && !_beyond(0, 60));
        _syncRef(0);
        for (uint256 k; k < 52; ++k) {
            vm.warp(block.timestamp + 29 minutes);
            vm.roll(block.number + 17_000);
            controller.signal(0);
        }
        vm.prank(curator);
        vm.expectRevert(HoodxStockLpControllerV1.NotReady.selector);
        controller.executeReband(0, 1, block.timestamp);
    }

    /// @notice Production reference: the protocol's existing HoodxTwapV2 over each stock's V3 USDG pool
    ///         (30-minute TWAP, quote = USDG). It must agree with the V4 pool the sleeve trades.
    function test_productionTwapReferenceAgreesWithV4Pools() public {
        if (!live) return;
        address v3Factory = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
        uint24[2] memory v3Fee = [uint24(3000), uint24(500)]; // META/USDG 0.30%, SPY/USDG 0.05%
        for (uint256 i; i < 2; ++i) {
            address v3Pool = IV3FactoryLookup(v3Factory).getPool(stock[i], USDG, v3Fee[i]);
            assertTrue(v3Pool != address(0), "V3 USDG reference pool exists");
            HoodxTwapV2 twap = new HoodxTwapV2(v3Factory, stock[i], USDG, v3Pool, address(0), 1800, 1, 0);
            uint256 refValue = twap.value(stock[i], 1e18);
            uint256 v4Value = ref.unitValue(stock[i]); // _syncRef mirrors the V4 spot
            uint256 hi = Math.max(refValue, v4Value);
            uint256 lo = Math.min(refValue, v4Value);
            uint256 bps = Math.mulDiv(hi - lo, 10_000, hi);
            emit log_named_uint("V3 TWAP vs V4 spot divergence (bps)", bps);
            assertLt(bps, 150, "production reference agrees within the policy band");
        }
    }

    function test_referenceDisagreementBlocksPriceSensitiveSteps() public {
        if (!live) return;
        uint256 v = ref.unitValue(META);
        ref.set(META, v * 110 / 100);
        vm.expectRevert(HoodxStockLpControllerV1.Divergence.selector);
        controller.signal(0);
        vm.prank(curator);
        vm.expectRevert(HoodxStockLpControllerV1.Divergence.selector);
        controller.compound(0, 1, block.timestamp);
    }

    function test_onlyCuratorMovesLiquidity_andRebandNeedsDwell() public {
        if (!live) return;
        vm.expectRevert(HoodxStockLpControllerV1.Unauthorized.selector);
        controller.executeReband(0, 1, block.timestamp);
        vm.expectRevert(HoodxStockLpControllerV1.Unauthorized.selector);
        controller.harvest(0);
        vm.prank(curator);
        vm.expectRevert(HoodxStockLpControllerV1.NotReady.selector);
        controller.executeReband(0, 1, block.timestamp);
        // Direct sleeve management is closed to everyone but the controller.
        vm.expectRevert();
        sleeves[0].reband(-600, 600, 1, block.timestamp);
    }

    // ------------------------------------------------------------------ one-click ETH product

    function test_ethEntry_partialExit_fullExit() public {
        if (!live) return;
        uint256 budget = _ethFor(100e6); // $100 of ETH
        vm.deal(alice, budget);
        uint256 ppsBefore = _sleevePerShare();
        uint256 shares = _sharesFor(budget);
        uint256 g = gasleft();
        vm.prank(alice);
        uint256 used = index.depositEth{value: budget}(shares, alice, block.timestamp);
        emit log_named_uint("gas: depositEth (2 sleeves)", g - gasleft());
        assertEq(index.balanceOf(alice), shares, "exact shares minted");
        assertEq(alice.balance, budget - used, "unused ETH refunded");
        assertGe(used, budget * 95 / 100, "sizing uses most of the budget");
        _assertNoResidue();
        assertGe(_sleevePerShare(), ppsBefore, "existing holders not diluted");
        emit log_named_uint("entry: ETH used (wei)", used);

        uint256 half = shares / 2;
        g = gasleft();
        vm.prank(alice);
        uint256 out1 = index.withdrawEth(half, payable(alice), 1, block.timestamp);
        emit log_named_uint("gas: withdrawEth (2 sleeves)", g - gasleft());
        assertEq(index.balanceOf(alice), shares - half, "partial exit burns only half");
        assertGt(out1, 0);
        _assertNoResidue();

        vm.prank(alice);
        uint256 out2 = index.withdrawEth(shares - half, payable(alice), 1, block.timestamp);
        assertEq(index.balanceOf(alice), 0, "fully exited");
        _assertNoResidue();
        uint256 back = out1 + out2;
        emit log_named_uint("round trip: ETH back / ETH used (bps)", back * 10_000 / used);
        assertLt(back, used, "no free value on an immediate round trip");
        assertGt(back, used * 97 / 100, "round-trip cost under 3%");
        assertGe(_sleevePerShare(), ppsBefore, "remaining holders not harmed by entry+exit");
    }

    function test_minimumEntry_10usd() public {
        if (!live) return;
        uint256 small = _ethFor(6e6);
        vm.deal(alice, small);
        uint256 shares = _sharesFor(small);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.BelowMinimum.selector);
        index.depositEth{value: small}(shares, alice, block.timestamp);

        uint256 ok = _ethFor(12e6);
        vm.deal(alice, ok);
        shares = _sharesFor(ok);
        vm.prank(alice);
        index.depositEth{value: ok}(shares, alice, block.timestamp);
        assertEq(index.balanceOf(alice), shares, "$12 entry accepted");
    }

    function test_cap_2000usd() public {
        if (!live) return;
        uint256 big = _ethFor(2_000e6); // seed NAV ~$160 + $2,000 > $2k cap
        vm.deal(alice, big);
        uint256 shares = _sharesFor(big);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.CapExceeded.selector);
        index.depositEth{value: big}(shares, alice, block.timestamp);
        uint256 mid = _ethFor(1_500e6);
        vm.deal(alice, mid);
        shares = _sharesFor(mid);
        vm.prank(alice);
        index.depositEth{value: mid}(shares, alice, block.timestamp);
        assertEq(index.balanceOf(alice), shares, "$1,500 fits under the cap");
    }

    function test_slippageBounds() public {
        if (!live) return;
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        vm.expectRevert();
        index.depositEth{value: budget / 2}(shares, alice, block.timestamp);
        vm.prank(alice);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.Slippage.selector);
        index.withdrawEth(shares, payable(alice), budget * 2, block.timestamp);
    }

    function test_pausedStopsEntry_butExitsWork() public {
        if (!live) return;
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(curator);
        controller.setManagementPaused(true);
        vm.deal(alice, budget);
        vm.prank(alice);
        vm.expectRevert();
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        uint256 out = index.withdrawEth(shares / 2, payable(alice), 1, block.timestamp);
        assertGt(out, 0, "ETH exit works while paused");
        vm.startPrank(alice);
        index.exitToSleeveShares(index.balanceOf(alice), alice);
        for (uint256 i; i < 2; ++i) {
            uint256 s = sleeves[i].balanceOf(alice);
            assertGt(s, 0);
            sleeves[i].redeem(s, alice, 0, 0, block.timestamp);
        }
        vm.stopPrank();
        assertEq(index.balanceOf(alice), 0);
    }

    function test_performanceFee_toTreasury_onFeesOnly() public {
        if (!live) return;
        for (uint256 i; i < 2; ++i) {
            uint256 b0 = IERC20(keys[i].currency0).balanceOf(treasury);
            uint256 b1 = IERC20(keys[i].currency1).balanceOf(treasury);
            _churn(i, 20, 300e6);
            _syncRef(i);
            vm.prank(curator);
            (uint256 a0, uint256 a1) = controller.harvest(i);
            uint256 f0 = IERC20(keys[i].currency0).balanceOf(treasury) - b0;
            uint256 f1 = IERC20(keys[i].currency1).balanceOf(treasury) - b1;
            assertGt(f0 + f1, 0, "treasury received the performance fee");
            // fee = floor(10% of gross); the sleeve keeps the rest (≈ 9x the fee)
            assertApproxEqAbs(f0 * 9, a0, 10);
            assertApproxEqAbs(f1 * 9, a1, 10);
        }
    }

    function test_accessControl() public {
        if (!live) return;
        vm.expectRevert(HoodxLiquiditySleeveV4.Unauthorized.selector);
        sleeves[0].depositShares(1, 0, 0);
        vm.expectRevert();
        sleeves[0].setVault(address(this));
        vm.expectRevert();
        index.bootstrap(alice, 1);
        vm.expectRevert(HoodxStockLpVaultV1.Unauthorized.selector);
        index.unlockCallback("");
        vm.expectRevert(HoodxLiquiditySleeveV4.Unauthorized.selector);
        sleeves[0].unlockCallback("");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(index).call{value: 1 ether}("");
        assertFalse(ok, "stray ETH rejected");
        vm.expectRevert(HoodxLiquiditySleeveV4.Unauthorized.selector);
        sleeves[0].simulateDeposit(1);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.withdrawEth(1, payable(alice), 0, block.timestamp);
    }

    function test_strategyIsDisplayable() public {
        if (!live) return;
        HoodxStockLpVaultV1.HoldingView[] memory h = index.holdings();
        assertEq(h.length, 2);
        for (uint256 i; i < 2; ++i) {
            assertEq(h[i].stock, stock[i]);
            assertGt(h[i].sleeveShares, 0);
            assertTrue(h[i].tick >= h[i].tickLower && h[i].tick < h[i].tickUpper, "in range at seed");
        }
        assertGt(bytes(index.strategy()).length, 0);
    }

    // ------------------------------------------------------------------ product helpers

    /// @dev Frontend stand-in: probe with eth_call, then scale shares to 98% of the budget.
    function _sharesFor(uint256 budget) internal returns (uint256) {
        uint256 probe = index.totalSupply() / 5; // ≈ $32 at seed (above the $10 minimum)
        uint256 snap = vm.snapshotState();
        uint256 probeValue = _ethFor(100e6);
        vm.deal(address(0xD00D), probeValue);
        vm.prank(address(0xD00D));
        uint256 used = index.depositEth{value: probeValue}(probe, address(0xD00D), block.timestamp);
        vm.revertToState(snap);
        return probe * budget * 98 / 100 / used;
    }

    function _ethFor(uint256 usdgAmount) internal view returns (uint256) {
        bytes32 id = keccak256(abi.encode(PoolKey(address(0), USDG, ETH_FEE, ETH_SPACING, address(0))));
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(id);
        return Math.mulDiv(usdgAmount, uint256(1) << 192, uint256(sqrtP) * uint256(sqrtP));
    }

    /// @dev Min over sleeves of (vault's sleeve shares per vault share): must never fall for holders.
    function _sleevePerShare() internal view returns (uint256 m) {
        m = type(uint256).max;
        for (uint256 i; i < 2; ++i) {
            uint256 r = Math.mulDiv(sleeves[i].balanceOf(address(index)), 1e36, index.totalSupply());
            if (r < m) m = r;
        }
    }

    function _assertNoResidue() internal view {
        assertEq(IERC20(USDG).balanceOf(address(index)), 0, "vault holds no USDG");
        assertEq(IERC20(META).balanceOf(address(index)), 0, "vault holds no META");
        assertEq(IERC20(SPY).balanceOf(address(index)), 0, "vault holds no SPY");
        assertEq(address(index).balance, 0, "vault holds no ETH");
    }

    // ------------------------------------------------------------------ adversarial (exploit-pattern) tests

    /// @dev Bunni (2025) pattern: extreme manipulated price + many small exits must not leak value.
    function test_bunniPattern_manyTinyExitsAtManipulatedPrice() public {
        if (!live) return;
        uint256 budget = _ethFor(200e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        index.exitToSleeveShares(shares, alice);
        // Push sleeve 0's pool far out of range (attacker's flash-loan leg).
        bool buyStock = keys[0].currency0 == USDG;
        for (uint256 k; k < 60 && !_beyond(0, 600); ++k) {
            _swap(0, buyStock, 100_000e6);
        }
        assertTrue(_beyond(0, 600), "manipulated far out of range");
        (uint256 l0, uint256 i00, uint256 i01) = _backingPerShare(0);
        uint256 s = sleeves[0].balanceOf(alice);
        uint256 piece = s / 41;
        vm.startPrank(alice);
        for (uint256 k; k < 40; ++k) {
            sleeves[0].redeem(piece, alice, 0, 0, block.timestamp);
            (uint256 l1, uint256 i10, uint256 i11) = _backingPerShare(0);
            assertGe(l1, l0, "liquidity per share never falls");
            assertGe(i10, i00, "idle0 per share never falls");
            assertGe(i11, i01, "idle1 per share never falls");
            (l0, i00, i01) = (l1, i10, i11);
        }
        vm.stopPrank();
    }

    /// @dev Repeated small entries/exits: remaining holders' backing per share never decreases.
    function test_repeatedSmallRoundTrips_noLeak() public {
        if (!live) return;
        uint256 pps = _sleevePerShare();
        for (uint256 k; k < 6; ++k) {
            uint256 budget = _ethFor(15e6);
            vm.deal(alice, budget);
            uint256 shares = _sharesFor(budget);
            vm.prank(alice);
            index.depositEth{value: budget}(shares, alice, block.timestamp);
            assertGe(_sleevePerShare(), pps, "entry never dilutes");
            pps = _sleevePerShare();
            uint256 held = index.balanceOf(alice);
            vm.prank(alice);
            index.withdrawEth(held, payable(alice), 1, block.timestamp);
            assertGe(_sleevePerShare(), pps, "exit never takes more than pro-rata");
            pps = _sleevePerShare();
        }
        _assertNoResidue();
    }

    /// @dev Gamma (2024) pattern: a manipulated pool must not accept deposits.
    function test_manipulatedPoolBlocksEntry_exitsStillWork() public {
        if (!live) return;
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        bool buyStock = keys[0].currency0 == USDG;
        for (uint256 k; k < 60 && controller.divergenceBps(0) <= 200; ++k) {
            _swap(0, buyStock, 50_000e6);
        }
        assertGt(controller.divergenceBps(0), 150, "pool pushed beyond the reference band");
        vm.deal(alice, budget);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.Divergence.selector);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        uint256 out = index.withdrawEth(shares, payable(alice), 1, block.timestamp);
        assertGt(out, 0, "ETH exit never depends on the reference");
    }

    function test_brokenReferenceFailsClosedForEntryOnly() public {
        if (!live) return;
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        ref.set(META, 0); // reference unavailable
        vm.deal(alice, budget);
        vm.prank(alice);
        vm.expectRevert(HoodxStockLpControllerV1.Divergence.selector);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        index.withdrawEth(shares, payable(alice), 1, block.timestamp);
        assertEq(index.balanceOf(alice), 0);
    }

    function test_liveVaultGuardsCarriedOver() public {
        if (!live) return;
        assertEq(index.balanceOf(address(0xdead)), index.DEAD_SHARES(), "dead shares locked at bootstrap");
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.startPrank(alice);
        vm.expectRevert(HoodxStockLpVaultV1.Stale.selector);
        index.depositEth{value: budget}(shares, alice, block.timestamp + 1 hours);
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.depositEth{value: budget}(1e11, alice, block.timestamp); // below MIN_SHARES
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.depositEth{value: budget}(shares, address(index), block.timestamp); // bad recipient
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.withdrawEth(shares, payable(alice), 0, block.timestamp); // zero exit floor
        vm.expectRevert(HoodxStockLpVaultV1.Stale.selector);
        index.withdrawEth(shares, payable(alice), 1, block.timestamp + 1 hours);
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.transfer(address(index), 1);
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.transfer(address(0xdead), 1);
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.exitToSleeveShares(shares, address(0));
        vm.stopPrank();
        vm.prank(address(controller));
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.renounceOwnership();
        vm.prank(address(controller));
        vm.expectRevert(HoodxLiquiditySleeveV4.Invalid.selector);
        sleeves[0].renounceOwnership();
        vm.prank(address(controller));
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        index.bootstrap(alice, 1e18); // one-time only
    }

    /// @dev Donations to the vault or a sleeve cannot block entry/exit; sleeve donations accrue to holders.
    function test_donationsCannotGrief() public {
        if (!live) return;
        vm.startPrank(PM);
        IERC20(USDG).transfer(address(index), 5e6);
        IERC20(META).transfer(address(index), 1e15);
        IERC20(USDG).transfer(address(sleeves[0]), 5e6);
        vm.stopPrank();
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(index).call{value: 1 ether}("");
        assertFalse(ok);
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        index.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        uint256 out = index.withdrawEth(shares, payable(alice), 1, block.timestamp);
        assertGt(out, 0);
        assertEq(IERC20(USDG).balanceOf(address(index)), 5e6, "stray tokens untouched, not paid to users");
    }

    function test_constructorRejectsDynamicFeeAndHookedRoutes() public {
        if (!live) return;
        address[] memory sl = new address[](1);
        sl[0] = address(sleeves[0]);
        PoolKey[] memory k = new PoolKey[](1);
        k[0] = PoolKey(USDG, META, 0x800000, 60, address(0));
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        new HoodxStockLpVaultV1(address(this), PM, USDG, ETH_FEE, ETH_SPACING, sl, k, 10e6, 2_000e6, 50, "", "x", "x");
        k[0] = PoolKey(USDG, META, 3000, 60, address(0x1234));
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        new HoodxStockLpVaultV1(address(this), PM, USDG, ETH_FEE, ETH_SPACING, sl, k, 10e6, 2_000e6, 50, "", "x", "x");
        k[0] = PoolKey(USDG, SPY, 3000, 60, address(0)); // wrong stock for this sleeve
        vm.expectRevert(HoodxStockLpVaultV1.Invalid.selector);
        new HoodxStockLpVaultV1(address(this), PM, USDG, ETH_FEE, ETH_SPACING, sl, k, 10e6, 2_000e6, 50, "", "x", "x");
    }

    function _backingPerShare(uint256 i) internal view returns (uint256 l, uint256 i0, uint256 i1) {
        uint256 supply = sleeves[i].totalSupply();
        l = Math.mulDiv(sleeves[i].positionLiquidity(), 1e36, supply);
        i0 = Math.mulDiv(IERC20(keys[i].currency0).balanceOf(address(sleeves[i])), 1e36, supply);
        i1 = Math.mulDiv(IERC20(keys[i].currency1).balanceOf(address(sleeves[i])), 1e36, supply);
    }

    // ------------------------------------------------------------------ helpers

    function _seed(uint256 i, uint256 usdgBudget) internal {
        address tok = stock[i];
        uint256 tokBudget = Math.mulDiv(usdgBudget, 1e18, ref.unitValue(tok));
        vm.startPrank(PM);
        IERC20(USDG).transfer(address(this), usdgBudget * 2);
        IERC20(tok).transfer(address(this), tokBudget * 2);
        vm.stopPrank();
        IERC20(USDG).approve(address(sleeves[i]), type(uint256).max);
        IERC20(tok).approve(address(sleeves[i]), type(uint256).max);
        (uint256 max0, uint256 max1) = keys[i].currency0 == USDG ? (usdgBudget, tokBudget) : (tokBudget, usdgBudget);
        // Off-chain curator math stand-in: largest liquidity the budget funds (binary search on the fork).
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
        assertGt(sleeves[i].positionLiquidity(), 0);
    }

    function _compoundMax(uint256 i) internal {
        uint128 lo = 0;
        uint128 hi = sleeves[i].positionLiquidity();
        for (uint256 k; k < 128 && lo < hi; ++k) {
            uint128 mid = lo + (hi - lo + 1) / 2;
            uint256 snap = vm.snapshotState();
            vm.prank(curator);
            try controller.compound(i, mid, block.timestamp) {
                lo = mid;
            } catch {
                hi = mid - 1;
            }
            vm.revertToState(snap);
        }
        if (lo > 0) {
            vm.prank(curator);
            controller.compound(i, lo, block.timestamp);
        }
    }

    function _churn(uint256 i, uint256 rounds, uint256 usdgSize) internal {
        bool usdgIs0 = keys[i].currency0 == USDG;
        uint256 tokSize = Math.mulDiv(usdgSize, 1e18, ref.unitValue(stock[i]));
        for (uint256 k; k < rounds; ++k) {
            _swap(i, usdgIs0, usdgSize); // buy stock with USDG
            _swapToken(i, !usdgIs0, tokSize); // sell stock back
        }
    }

    function _swap(uint256 i, bool zeroForOne, uint256 usdgAmount) internal {
        vm.prank(PM);
        IERC20(USDG).transfer(address(trader), usdgAmount);
        trader.swap(keys[i], zeroForOne, usdgAmount);
    }

    function _swapToken(uint256 i, bool zeroForOne, uint256 tokAmount) internal {
        vm.prank(PM);
        IERC20(stock[i]).transfer(address(trader), tokAmount);
        trader.swap(keys[i], zeroForOne, tokAmount);
    }

    function _tick(uint256 i) internal view returns (int24 t) {
        (, t,,) = IV4StateView(STATE_VIEW).getSlot0(keccak256(abi.encode(keys[i])));
    }

    function _beyond(uint256 i, int24 margin) internal view returns (bool) {
        int24 t = _tick(i);
        return t < sleeves[i].tickLower() - margin || t >= sleeves[i].tickUpper() + margin;
    }

    function _inRange(uint256 i) internal view returns (bool) {
        int24 t = _tick(i);
        return t >= sleeves[i].tickLower() && t < sleeves[i].tickUpper();
    }

    /// @dev Sets the mock reference to the pool's current price (quote units per 1e18 token units).
    function _syncRef(uint256 i) internal {
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(keccak256(abi.encode(keys[i])));
        uint256 unit = 1e18;
        uint256 v = keys[i].currency0 == USDG
            ? Math.mulDiv(unit, uint256(1) << 192, uint256(sqrtP) * uint256(sqrtP))
            : Math.mulDiv(Math.mulDiv(unit, uint256(sqrtP), uint256(1) << 96), uint256(sqrtP), uint256(1) << 96);
        ref.set(stock[i], v);
    }

    function _floor(int24 tick, int24 spacing) internal pure returns (int24 c) {
        c = tick / spacing * spacing;
        if (tick < 0 && tick % spacing != 0) c -= spacing;
    }
}
