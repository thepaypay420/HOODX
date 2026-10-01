// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodxStockLpSleeveV2} from "../../contracts/liquidity/v4/HoodxStockLpSleeveV2.sol";
import {HoodxStockLpControllerV2} from "../../contracts/liquidity/v4/HoodxStockLpControllerV2.sol";
import {HoodxStockLpVaultV1} from "../../contracts/liquidity/v4/HoodxStockLpVaultV1.sol";
import {HoodxStockLpSeederV1, ISeedController} from "../../contracts/liquidity/v4/HoodxStockLpSeederV1.sol";
import {IV4StateView, PoolKey} from "../../contracts/liquidity/v4/V4Types.sol";
import {MockPriceRef, Trader} from "./StockLpV4Fork.t.sol";

/// @notice V2 "autopilot" on a current-state fork: 8 sleeves seeded through the real seeder, ETH lifecycle,
///         and permissionless keeper cranks (harvest, compound, hourly signalAll, reband after 24 h).
/// @dev Run with HOODX_FORK_TEST=true ROBINHOOD_RPC_URL=<rpc>. Nothing is broadcast.
contract StockLpVaultV2ForkTest is Test {
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    uint256 constant BLOCK = 77_090_834;
    uint256 constant N = 8;

    address treasury = address(0x7EA5);
    address deployer = address(0xDE91);
    address keeper = address(0xBEEB);
    address alice = address(0xA11CE);
    HoodxStockLpVaultV1 vault;
    HoodxStockLpControllerV2 controller;
    HoodxStockLpSeederV1 seeder;
    HoodxStockLpSleeveV2[N] sleeves;
    PoolKey[N] keys;
    address[N] stock;
    MockPriceRef ref;
    Trader trader;
    bool live;
    uint256 entries;
    uint256 failedEntries;
    uint256 ethExits;
    uint256 inKindExits;

    function _basket() internal pure returns (PoolKey[N] memory k, address[N] memory s) {
        s[0] = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC; // NVDA
        s[1] = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35; // META
        s[2] = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C; // SPY
        s[3] = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa; // SPCX
        s[4] = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A; // PLTR
        s[5] = 0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4; // BABA
        s[6] = 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344; // USO
        s[7] = 0xec262a75e413fAfD0dF80480274532C79D42da09; // MSTR
        uint24[N] memory fee = [uint24(100), 310, 500, 250, 1500, 1000, 1200, 2400];
        int24[N] memory sp = [int24(1), 3, 5, 3, 15, 10, 15, 24];
        for (uint256 i; i < N; ++i) {
            (address c0, address c1) = s[i] < USDG ? (s[i], USDG) : (USDG, s[i]);
            k[i] = PoolKey(c0, c1, fee[i], sp[i], address(0));
        }
    }

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) return;
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envOr("HOODX_FORK_BLOCK", BLOCK));
        live = true;
        (keys, stock) = _basket();
        ref = new MockPriceRef();
        trader = new Trader();
        vm.startPrank(deployer);
        seeder = new HoodxStockLpSeederV1(PM, USDG, deployer, 100, 1);
        address[] memory sl = new address[](N);
        PoolKey[] memory swapKeys = new PoolKey[](N);
        HoodxStockLpControllerV2.Policy[] memory pol = new HoodxStockLpControllerV2.Policy[](N);
        for (uint256 i; i < N; ++i) {
            (, int24 t, uint24 protocolFee,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
            int24 sp = keys[i].tickSpacing;
            int24 half = (100 + sp - 1) / sp * sp;
            int24 c = _floor(t, sp);
            sleeves[i] = new HoodxStockLpSleeveV2(
                deployer, PM, STATE_VIEW, keys[i], protocolFee, c - half, c + half, treasury, 1_000, "S", "S"
            );
            sl[i] = address(sleeves[i]);
            swapKeys[i] = keys[i];
            pol[i] = HoodxStockLpControllerV2.Policy({
                halfWidth: half,
                makerWidth: 2 * half,
                maxDivergenceBps: 150,
                breachDelay: 24 hours,
                cooldown: 1 hours,
                priceRef: ref,
                tokenDecimals: IERC20Metadata(stock[i]).decimals(),
                quoteDecimals: 6
            });
        }
        vm.stopPrank();
        for (uint256 i; i < N; ++i) {
            _syncRef(i);
        }
        vm.startPrank(deployer);
        vault = new HoodxStockLpVaultV1(
            deployer, PM, USDG, 100, 1, sl, swapKeys, 10e6, 10_000e6, 50, "autopilot", "HOODX Stock LP", "STKX"
        );
        for (uint256 i; i < N; ++i) {
            sleeves[i].setVault(address(vault));
        }
        controller = new HoodxStockLpControllerV2(address(vault), treasury, deployer, address(seeder), sl, pol);
        vault.transferOwnership(address(controller));
        for (uint256 i; i < N; ++i) {
            sleeves[i].transferOwnership(address(controller));
        }
        controller.activate();
        vm.deal(deployer, 1 ether);
        seeder.seed{value: 0.022 ether}(ISeedController(address(controller)), treasury, 500);
        vm.stopPrank();
    }

    function test_seederLaunch_andEthLifecycle() public {
        if (!live) return;
        assertTrue(vault.bootstrapped());
        assertGt(vault.balanceOf(treasury), 0, "seed shares to treasury");
        assertEq(address(seeder).balance, 0, "seeder holds no ETH");
        for (uint256 i; i < N; ++i) {
            assertGt(sleeves[i].positionLiquidity(), 0, "every sleeve seeded");
        }
        uint256 budget = _ethFor(100e6);
        vm.deal(alice, budget);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        uint256 used = vault.depositEth{value: budget}(shares, alice, block.timestamp);
        vm.prank(alice);
        uint256 out = vault.withdrawEth(shares, payable(alice), 1, block.timestamp);
        emit log_named_uint("V2 ETH round trip (bps)", out * 10_000 / used);
        assertGt(out, used * 99 / 100, "round trip cost under 1%");
    }

    function test_keeperCranks_harvestCompound_andCannotPause() public {
        if (!live) return;
        _churn(2, 10, 20_000e6);
        _syncRef(2);
        uint128 before = sleeves[2].positionLiquidity();
        vm.startPrank(keeper);
        controller.harvest(2);
        controller.compound(2);
        vm.expectRevert(HoodxStockLpControllerV2.Unauthorized.selector);
        controller.setManagementPaused(true);
        vm.stopPrank();
        assertGt(sleeves[2].positionLiquidity(), before, "keeper compound added liquidity");
        assertGt(sleeves[2].feeOwed0() + sleeves[2].feeOwed1(), 0, "performance fee set aside");
        vm.prank(treasury);
        controller.setManagementPaused(true);
        vm.prank(keeper);
        vm.expectRevert();
        controller.compound(2); // paused: cranks stop, exits keep working
    }

    function test_autopilotReband_afterHourlySignals() public {
        if (!live) return;
        uint256 i = 2; // SPY
        bool buyStock = keys[i].currency0 == USDG;
        for (uint256 k; k < 200 && !_beyond(i, 3 * keys[i].tickSpacing); ++k) {
            _swap(i, buyStock, 25_000e6);
        }
        assertTrue(_beyond(i, 3 * keys[i].tickSpacing), "pushed out of range");
        _syncRef(i);
        vm.prank(keeper);
        controller.signalAll();
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.NotReady.selector);
        controller.executeReband(i); // too early
        for (uint256 h; h < 25; ++h) {
            _advance(1 hours);
            vm.prank(keeper);
            controller.signalAll();
        }
        (bool inRange,, uint64 since,, bool ready,) = controller.status(i);
        assertFalse(inRange);
        assertGt(since, 0);
        assertTrue(ready, "status reports reband ready");
        int24 oldLower = sleeves[i].tickLower();
        vm.prank(keeper);
        controller.executeReband(i);
        (, int24 t) = sleeves[i].spot();
        assertTrue(sleeves[i].tickLower() != oldLower, "range moved");
        assertTrue(sleeves[i].tickLower() > t || sleeves[i].tickUpper() <= t, "one-sided maker range");
        // The sleeve redeployed (almost) everything it owned on the side it holds.
        uint256 idle0 = IERC20(keys[i].currency0).balanceOf(address(sleeves[i])) - sleeves[i].feeOwed0();
        uint256 idle1 = IERC20(keys[i].currency1).balanceOf(address(sleeves[i])) - sleeves[i].feeOwed1();
        emit log_named_uint("idle0 after reband", idle0);
        emit log_named_uint("idle1 after reband", idle1);
        assertGt(sleeves[i].positionLiquidity(), 0);
        // Exits still work after an autopilot reband.
        uint256 half = vault.balanceOf(treasury) / 2;
        vm.prank(treasury);
        vault.exitToSleeveShares(half, treasury);
        uint256 s = sleeves[i].balanceOf(treasury);
        vm.prank(treasury);
        sleeves[i].redeem(s, treasury, 0, 0, block.timestamp);
    }

    // ------------------------------------------------------------------ autopilot edge cases

    function test_autopilotReband_downDirection() public {
        if (!live) return;
        uint256 i = 2; // SPY
        _pushOut(i, false);
        _syncRef(i);
        _signalHours(25);
        vm.prank(keeper);
        controller.executeReband(i);
        (, int24 t) = sleeves[i].spot();
        assertTrue(sleeves[i].tickLower() > t, "token0-only range above price after a down move");
        assertGt(sleeves[i].positionLiquidity(), 0);
    }

    function test_signalAll_skipsDisagreeingSleeve_andRebandRefused() public {
        if (!live) return;
        uint256 i = 2;
        _pushOut(i, true);
        _syncRef(i);
        uint256 v = ref.unitValue(stock[i]);
        ref.set(stock[i], v * 110 / 100); // reference now disagrees by 10%
        vm.prank(keeper);
        controller.signalAll(); // must not revert because of one sleeve
        assertEq(controller.breachSince(i), 0, "disagreeing sleeve not signalled");
        (, bool agrees,,,,) = controller.status(i);
        assertFalse(agrees);
        ref.set(stock[i], v);
        _signalHours(25);
        ref.set(stock[i], v * 110 / 100);
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.Divergence.selector);
        controller.executeReband(i);
    }

    function test_breachResetsAfterKeeperGap_andClearsInRange() public {
        if (!live) return;
        uint256 i = 2;
        _pushOut(i, true);
        _syncRef(i);
        _signalHours(10);
        uint64 first = controller.breachSince(i);
        _advance(3 hours); // keeper offline longer than MAX_OBSERVATION_GAP
        vm.prank(keeper);
        controller.signalAll();
        assertGt(controller.breachSince(i), first, "gap restarts the 24 h timer");
        _signalHours(20);
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.NotReady.selector);
        controller.executeReband(i); // only 20 h since the restart
        // Price returns into range: breach clears.
        _pushBack(i);
        _syncRef(i);
        vm.prank(keeper);
        controller.signalAll();
        assertEq(controller.breachSince(i), 0, "breach cleared in range");
    }

    function test_cooldownBetweenRebands() public {
        if (!live) return;
        uint256 i = 2;
        _pushOut(i, true);
        _syncRef(i);
        _signalHours(25);
        vm.prank(keeper);
        controller.executeReband(i);
        // Push out again immediately past the new range and keep signalling for 25 h: allowed again only after
        // both the new breach delay and the cooldown.
        _pushOut(i, true);
        _syncRef(i);
        vm.prank(keeper);
        controller.signalAll();
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.NotReady.selector);
        controller.executeReband(i);
        _signalHours(25);
        vm.prank(keeper);
        controller.executeReband(i);
    }

    function test_pauseStopsAllCranks_exitsStillWork() public {
        if (!live) return;
        vm.prank(treasury);
        controller.setManagementPaused(true);
        vm.startPrank(keeper);
        vm.expectRevert();
        controller.harvest(0);
        vm.expectRevert();
        controller.compound(0);
        vm.stopPrank();
        uint256 sh = vault.balanceOf(treasury) / 3;
        vm.prank(treasury);
        uint256 out = vault.withdrawEth(sh, payable(treasury), 1, block.timestamp);
        assertGt(out, 0, "ETH exit while paused");
        vm.prank(treasury);
        controller.setManagementPaused(false);
        vm.prank(keeper);
        controller.harvest(0);
    }

    function test_compoundNeverSpendsOwedFees() public {
        if (!live) return;
        uint256 i = 2;
        _churn(i, 10, 20_000e6);
        _syncRef(i);
        vm.prank(keeper);
        controller.harvest(i);
        uint256 o0 = sleeves[i].feeOwed0();
        uint256 o1 = sleeves[i].feeOwed1();
        vm.prank(keeper);
        controller.compound(i);
        assertGe(IERC20(keys[i].currency0).balanceOf(address(sleeves[i])), sleeves[i].feeOwed0(), "fee0 backed");
        assertGe(IERC20(keys[i].currency1).balanceOf(address(sleeves[i])), sleeves[i].feeOwed1(), "fee1 backed");
        assertGe(sleeves[i].feeOwed0(), o0);
        assertGe(sleeves[i].feeOwed1(), o1);
        (uint256 owe0, uint256 owe1) = (sleeves[i].feeOwed0(), sleeves[i].feeOwed1());
        uint256 t0 = IERC20(keys[i].currency0).balanceOf(treasury);
        uint256 t1 = IERC20(keys[i].currency1).balanceOf(treasury);
        sleeves[i].claimFees();
        assertEq(IERC20(keys[i].currency0).balanceOf(treasury) - t0, owe0, "treasury paid exactly fee0");
        assertEq(IERC20(keys[i].currency1).balanceOf(treasury) - t1, owe1, "treasury paid exactly fee1");
        assertEq(sleeves[i].feeOwed0() + sleeves[i].feeOwed1(), 0);
    }

    /// @dev Random walk: price pushes both ways, hourly keeper runs, deposits and withdrawals interleaved.
    ///      Holders are never diluted, the vault never strands funds, and every exit works throughout.
    function test_randomWalk_autopilotWithUsers() public {
        if (!live) return;
        uint256 seed = 0xC0FFEE;
        uint256 pps = _sleevePerShare();
        uint256 rebands;
        for (uint256 step; step < 240; ++step) {
            seed = uint256(keccak256(abi.encode(seed)));
            uint256 i = seed % N;
            uint256 action = (seed >> 8) % 6;
            if (action == 0) {
                _swap(i, keys[i].currency0 == USDG, 2_000e6 + (seed >> 16) % 30_000e6);
            } else if (action == 1) {
                _sellStock(i, 2_000e6 + (seed >> 16) % 30_000e6);
            } else if (action == 2) {
                _userDeposit(20e6 + (seed >> 24) % 300e6);
                assertGe(_sleevePerShare(), pps, "entry never dilutes");
            } else if (action == 3) {
                uint256 b = vault.balanceOf(alice);
                if (b > 0) {
                    uint256 ethBefore = alice.balance;
                    vm.prank(alice);
                    try vault.withdrawEth(b / 2 + 1, payable(alice), 1, block.timestamp) {
                        ++ethExits;
                    } catch {
                        // Drained pool: the ETH exit refuses an incomplete fill and costs nothing...
                        assertEq(vault.balanceOf(alice), b, "failed ETH exit burns nothing");
                        assertEq(alice.balance, ethBefore, "failed ETH exit moves no ETH");
                        // ...and the in-kind exit always works.
                        vm.prank(alice);
                        vault.exitToSleeveShares(b / 2 + 1, alice);
                        ++inKindExits;
                    }
                    assertGe(_sleevePerShare(), pps, "exit never over-pays");
                }
            } else {
                for (uint256 k; k < N; ++k) {
                    _syncRef(k);
                }
                _advance(1 hours);
                vm.startPrank(keeper);
                uint256 readyMask = controller.signalAll();
                for (uint256 k; k < N; ++k) {
                    if (readyMask & (1 << k) != 0) {
                        controller.executeReband(k);
                        ++rebands;
                    }
                }
                if (action == 5) {
                    controller.harvest(i);
                    try controller.compound(i) {} catch {}
                }
                vm.stopPrank();
            }
            pps = _sleevePerShare();
            assertEq(IERC20(USDG).balanceOf(address(vault)), 0, "vault never strands USDG");
            assertEq(address(vault).balance, 0, "vault never strands ETH");
        }
        emit log_named_uint("rebands executed by keeper", rebands);
        emit log_named_uint("ETH entries ok", entries);
        emit log_named_uint("ETH entries refused (cost nothing)", failedEntries);
        emit log_named_uint("ETH exits ok", ethExits);
        emit log_named_uint("in-kind fallback exits", inKindExits);
        uint256 rest = vault.balanceOf(alice);
        if (rest > 0) {
            vm.prank(alice);
            try vault.withdrawEth(rest, payable(alice), 1, block.timestamp) {} catch {
                vm.prank(alice);
                vault.exitToSleeveShares(rest, alice);
            }
        }
        assertEq(vault.balanceOf(alice), 0, "user fully exits at the end");
        assertGt(rebands, 0, "walk exercised at least one autopilot reband");
    }

    // ------------------------------------------------------------------ helpers

    function _pushOut(uint256 i, bool up) internal {
        for (uint256 k; k < 200 && !_beyond(i, 3 * keys[i].tickSpacing); ++k) {
            if (up) _swap(i, keys[i].currency0 == USDG, 25_000e6);
            else _sellStock(i, 25_000e6);
        }
        assertTrue(_beyond(i, 3 * keys[i].tickSpacing), "pushed out of range");
    }

    function _pushBack(uint256 i) internal {
        (, int24 t,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
        bool above = t >= sleeves[i].tickUpper();
        for (uint256 k; k < 400; ++k) {
            (, t,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
            if (t >= sleeves[i].tickLower() && t < sleeves[i].tickUpper()) return;
            if (above) _sellStock(i, 2_000e6);
            else _swap(i, keys[i].currency0 == USDG, 2_000e6);
        }
        revert("could not return into range");
    }

    /// @dev Reads the real current time (block.timestamp can be cached across cheatcodes under via-IR).
    function _advance(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
        vm.roll(vm.getBlockNumber() + secs * 10);
    }

    function _signalHours(uint256 h) internal {
        for (uint256 k; k < h; ++k) {
            _advance(1 hours);
            vm.prank(keeper);
            controller.signalAll();
        }
    }

    function _sellStock(uint256 i, uint256 usdgWorth) internal {
        uint256 tok = Math.mulDiv(usdgWorth, 10 ** IERC20Metadata(stock[i]).decimals(), ref.unitValue(stock[i]));
        vm.prank(PM);
        IERC20(stock[i]).transfer(address(trader), tok);
        trader.swap(keys[i], keys[i].currency0 != USDG, tok);
    }

    function _userDeposit(uint256 usd) internal {
        for (uint256 k; k < N; ++k) {
            _syncRef(k); // the reference tracks the pool in this simulation
        }
        uint256 budget = _ethFor(usd);
        uint256 shares = _sharesFor(budget);
        if (shares == 0) {
            ++failedEntries; // quote itself could not fill: a frontend would show "entry unavailable"
            return;
        }
        uint256 sent = budget * 120 / 100; // frontend sends a margin; the vault refunds the unused ETH
        vm.deal(alice, sent);
        uint256 before = alice.balance;
        uint256 held = vault.balanceOf(alice);
        vm.prank(alice);
        try vault.depositEth{value: sent}(shares, alice, block.timestamp) returns (uint256 used) {
            assertEq(before - alice.balance, used, "only the ETH actually used is kept");
            ++entries;
        } catch {
            assertEq(alice.balance, before, "failed entry costs nothing");
            assertEq(vault.balanceOf(alice), held, "failed entry mints nothing");
            ++failedEntries;
        }
    }

    function _sleevePerShare() internal view returns (uint256 m) {
        m = type(uint256).max;
        for (uint256 i; i < N; ++i) {
            uint256 r = Math.mulDiv(sleeves[i].balanceOf(address(vault)), 1e36, vault.totalSupply());
            if (r < m) m = r;
        }
    }

    function _id(uint256 i) internal view returns (bytes32) {
        return keccak256(abi.encode(keys[i]));
    }

    function _syncRef(uint256 i) internal {
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
        uint256 unit = 10 ** IERC20Metadata(stock[i]).decimals();
        uint256 v = keys[i].currency0 == USDG
            ? Math.mulDiv(Math.mulDiv(unit, uint256(1) << 96, uint256(sqrtP)), uint256(1) << 96, uint256(sqrtP))
            : Math.mulDiv(Math.mulDiv(unit, uint256(sqrtP), uint256(1) << 96), uint256(sqrtP), uint256(1) << 96);
        ref.set(stock[i], v);
    }

    function _swap(uint256 i, bool zeroForOne, uint256 usdgAmount) internal {
        vm.prank(PM);
        IERC20(USDG).transfer(address(trader), usdgAmount);
        trader.swap(keys[i], zeroForOne, usdgAmount);
    }

    function _churn(uint256 i, uint256 rounds, uint256 usdgSize) internal {
        bool usdgIs0 = keys[i].currency0 == USDG;
        uint256 tokSize = Math.mulDiv(usdgSize, 10 ** IERC20Metadata(stock[i]).decimals(), ref.unitValue(stock[i]));
        for (uint256 k; k < rounds; ++k) {
            _swap(i, usdgIs0, usdgSize);
            vm.prank(PM);
            IERC20(stock[i]).transfer(address(trader), tokSize);
            trader.swap(keys[i], !usdgIs0, tokSize);
        }
    }

    function _beyond(uint256 i, int24 margin) internal view returns (bool) {
        (, int24 t,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
        return t < sleeves[i].tickLower() - margin || t >= sleeves[i].tickUpper() + margin;
    }

    function _sharesFor(uint256 budget) internal returns (uint256) {
        uint256 probe = vault.totalSupply() / 4;
        uint256 probeValue = _ethFor(3_000e6); // ample; unused ETH is refunded
        uint256 snap = vm.snapshotState();
        vm.deal(address(0xD00D), probeValue);
        vm.prank(address(0xD00D));
        uint256 used;
        try vault.depositEth{value: probeValue}(probe, address(0xD00D), block.timestamp) returns (uint256 u) {
            used = u;
        } catch {}
        vm.revertToState(snap);
        return used == 0 ? 0 : probe * budget * 98 / 100 / used;
    }

    function _ethFor(uint256 usdgAmount) internal view returns (uint256) {
        bytes32 id = keccak256(abi.encode(PoolKey(address(0), USDG, 100, 1, address(0))));
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(id);
        return Math.mulDiv(Math.mulDiv(usdgAmount, uint256(1) << 96, uint256(sqrtP)), uint256(1) << 96, uint256(sqrtP));
    }

    function _floor(int24 tick, int24 spacing) internal pure returns (int24 c) {
        c = tick / spacing * spacing;
        if (tick < 0 && tick % spacing != 0) c -= spacing;
    }
}
