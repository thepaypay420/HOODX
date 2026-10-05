// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodxStockLpSleeveV2} from "../../contracts/liquidity/v4/HoodxStockLpSleeveV2.sol";
import {HoodxStockLpControllerV2} from "../../contracts/liquidity/v4/HoodxStockLpControllerV2.sol";
import {IPriceReference, IV4StateView, PoolKey} from "../../contracts/liquidity/v4/V4Types.sol";
import {DeployStockLpVaultV2} from "../../script/DeployStockLpVaultV2.s.sol";
import {Trader} from "./StockLpV4Fork.t.sol";

/// @notice STKX v3 phase 1 on a current-state fork: the real deploy script with the v3 manifest (new pools, real V3
///         TWAP references, real seeder), then the 15-minute autopilot rule on the deployed contracts.
/// @dev Run with HOODX_FORK_TEST=true ROBINHOOD_RPC_URL=<rpc> [HOODX_FORK_BLOCK=<n>]. Nothing is broadcast.
contract StockLpVaultV3ForkTest is Test {
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant TREASURY = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    string constant MANIFEST = "deployments/stock-lp-vault-v3-manifest.json";

    DeployStockLpVaultV2.Deployed d;
    HoodxStockLpControllerV2 controller;
    PoolKey[] keys;
    address[] stock;
    Trader trader;
    address keeper = address(0xBEEB);
    address alice = address(0xA11CE);
    bool live;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) return;
        uint256 b = vm.envOr("HOODX_FORK_BLOCK", uint256(0));
        if (b == 0) vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        else vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), b);
        live = true;
        vm.setEnv("HOODX_STOCK_LP_MANIFEST", MANIFEST);
        vm.deal(DEPLOYER, 1 ether);
        DeployStockLpVaultV2 script = new DeployStockLpVaultV2();
        d = script.run();
        controller = d.controller;
        trader = new Trader();
        for (uint256 i; i < d.sleeves.length; ++i) {
            PoolKey memory k = HoodxStockLpSleeveV2(d.sleeves[i]).poolKey();
            keys.push(k);
            stock.push(k.currency0 == USDG ? k.currency1 : k.currency0);
        }
    }

    /// The script deploys and seeds the v3 basket against the real references, with the manifest's policy.
    function test_v3ManifestDeploys_withRealReferences() public {
        if (!live) return;
        string memory json = vm.readFile(MANIFEST);
        assertTrue(d.vault.bootstrapped(), "seeded");
        assertGt(d.initialShares, 0);
        assertEq(d.sleeves.length, vm.parseJsonUint(json, ".count"));
        for (uint256 i; i < d.sleeves.length; ++i) {
            HoodxStockLpControllerV2.Policy memory p = controller.policy(i);
            string memory e = string.concat(".sleeves[", vm.toString(i), "]");
            assertEq(p.breachDelay, 15 minutes, "15-minute rule");
            assertEq(p.cooldown, 1 hours);
            assertEq(int256(p.halfWidth), vm.parseJsonInt(json, string.concat(e, ".halfWidthTicks")));
            assertEq(int256(p.makerWidth), vm.parseJsonInt(json, string.concat(e, ".makerWidthTicks")));
            HoodxStockLpSleeveV2 s = HoodxStockLpSleeveV2(d.sleeves[i]);
            assertEq(int256(s.tickUpper() - s.tickLower()), 2 * int256(p.halfWidth), "centred launch range");
            (bool inRange, bool agrees,,,,) = controller.status(i);
            assertTrue(inRange, "launch range holds the price");
            assertTrue(agrees, "real reference agrees with the LP pool");
            emit log_named_string("sleeve", vm.parseJsonString(json, string.concat(e, ".symbol")));
            emit log_named_uint("  pool vs V3 reference (bps)", controller.divergenceBps(i));
            emit log_named_int("  half width (ticks)", p.halfWidth);
        }
    }

    /// A sleeve pushed out of range is re-placed after 15 minutes of keeper observations, not before; the new range is
    /// one-sided with the manifest width; a second re-placement waits for the 1-hour cooldown.
    function test_fifteenMinuteReband_andCooldown() public {
        if (!live) return;
        uint256 i = _index("MSFT");
        _afterLaunchCooldown();
        _pushOut(i);
        _syncRef(i);
        _signal();
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.NotReady.selector);
        controller.executeReband(i);
        _advance(14 minutes);
        _signal();
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.NotReady.selector);
        controller.executeReband(i); // 14 minutes out: too early
        _advance(1 minutes);
        _signal();
        (,,,, bool ready,) = controller.status(i);
        assertTrue(ready, "ready at 15 minutes");
        vm.prank(keeper);
        controller.executeReband(i);
        HoodxStockLpSleeveV2 s = HoodxStockLpSleeveV2(d.sleeves[i]);
        (, int24 t) = s.spot();
        assertTrue(s.tickLower() > t || s.tickUpper() <= t, "one-sided range next to the price");
        assertEq(int256(s.tickUpper() - s.tickLower()), int256(controller.policy(i).makerWidth), "manifest maker width");
        assertGt(s.positionLiquidity(), 0);

        // Out again straight away, past the new range: the 15 minutes pass but the 1-hour cooldown does not.
        _pushOut(i);
        _syncRef(i);
        _signal();
        _advance(20 minutes);
        _signal();
        vm.prank(keeper);
        vm.expectRevert(HoodxStockLpControllerV2.NotReady.selector);
        controller.executeReband(i);
        for (uint256 k; k < 3; ++k) {
            _advance(15 minutes);
            _signal();
        }
        vm.prank(keeper);
        controller.executeReband(i); // 65 minutes after the first re-placement
    }

    /// Every sleeve can be pushed out both ways and re-placed by the 15-minute rule without stranding funds,
    /// and the in-kind exit still works afterwards.
    function test_everySleeveRebands_bothDirections() public {
        if (!live) return;
        _afterLaunchCooldown();
        for (uint256 i; i < d.sleeves.length; ++i) {
            bool up = i % 2 == 0;
            _pushDir(i, up);
            _syncRef(i);
            _signal();
            _advance(15 minutes);
            _signal();
            vm.prank(keeper);
            controller.executeReband(i);
            HoodxStockLpSleeveV2 s = HoodxStockLpSleeveV2(d.sleeves[i]);
            (, int24 t) = s.spot();
            if (up) assertTrue(s.tickUpper() <= t, "token1-only range below price after a rise");
            else assertTrue(s.tickLower() > t, "token0-only range above price after a fall");
        }
        uint256 half = d.vault.balanceOf(TREASURY) / 2;
        vm.prank(TREASURY);
        d.vault.exitToSleeveShares(half, TREASURY);
        assertEq(IERC20(USDG).balanceOf(address(d.vault)), 0, "vault strands no USDG");
    }

    /// Entry and exit cost for a depositor in the new basket (several stocks convert through 0.5-1% pools).
    function test_ethRoundTripCost() public {
        if (!live) return;
        uint256 budget = _ethFor(200e6);
        vm.deal(alice, budget * 2);
        uint256 shares = _sharesFor(budget);
        vm.prank(alice);
        uint256 used = d.vault.depositEth{value: budget * 2}(shares, alice, block.timestamp);
        vm.prank(alice);
        uint256 out = d.vault.withdrawEth(shares, payable(alice), 1, block.timestamp);
        emit log_named_uint("v3 basket ETH round trip, $200 (bps of ETH used)", out * 10_000 / used);
        assertGt(out, used * 97 / 100, "round trip costs under 3%");
    }

    // ------------------------------------------------------------------ helpers

    function _index(string memory sym) internal view returns (uint256) {
        string memory json = vm.readFile(MANIFEST);
        for (uint256 i; i < d.sleeves.length; ++i) {
            if (keccak256(bytes(vm.parseJsonString(json, string.concat(".sleeves[", vm.toString(i), "].symbol")))) == keccak256(bytes(sym))) {
                return i;
            }
        }
        revert("symbol not in manifest");
    }

    /// @dev The controller starts each sleeve's 1-hour cooldown at launch, so nothing can be re-placed in the first hour.
    function _afterLaunchCooldown() internal {
        for (uint256 k; k < 4; ++k) {
            _advance(16 minutes);
            _signal();
        }
    }

    function _signal() internal {
        vm.prank(keeper);
        controller.signalAll();
    }

    function _pushOut(uint256 i) internal {
        _pushDir(i, true);
    }

    /// @dev Swaps until the price sits 3 tick spacings beyond the sleeve's current range in the given direction.
    function _pushDir(uint256 i, bool up) internal {
        HoodxStockLpSleeveV2 s = HoodxStockLpSleeveV2(d.sleeves[i]);
        int24 m = 3 * keys[i].tickSpacing;
        for (uint256 k; k < 300; ++k) {
            (, int24 t,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
            if (up ? t >= s.tickUpper() + m : t < s.tickLower() - m) return;
            // price (token1 per token0) rises when token1 goes in: zeroForOne = false
            bool zeroForOne = !up;
            address tokenIn = zeroForOne ? keys[i].currency0 : keys[i].currency1;
            uint256 amt = tokenIn == USDG ? 5_000e6 : Math.mulDiv(5_000e6, 10 ** IERC20Metadata(stock[i]).decimals(), _unitValue(i));
            vm.prank(PM);
            IERC20(tokenIn).transfer(address(trader), amt);
            trader.swap(keys[i], zeroForOne, amt);
        }
        revert("could not push the price out of range");
    }

    /// @dev The fork has no arbitrageurs, so make the sleeve's reference follow its pool (as arbitrage would).
    function _syncRef(uint256 i) internal {
        HoodxStockLpControllerV2.Policy memory p = controller.policy(i);
        uint256 unit = 10 ** IERC20Metadata(stock[i]).decimals();
        vm.mockCall(address(p.priceRef), abi.encodeCall(IPriceReference.value, (stock[i], unit)), abi.encode(_unitValue(i)));
    }

    function _unitValue(uint256 i) internal view returns (uint256) {
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(_id(i));
        uint256 unit = 10 ** IERC20Metadata(stock[i]).decimals();
        return keys[i].currency0 == USDG
            ? Math.mulDiv(Math.mulDiv(unit, uint256(1) << 96, uint256(sqrtP)), uint256(1) << 96, uint256(sqrtP))
            : Math.mulDiv(Math.mulDiv(unit, uint256(sqrtP), uint256(1) << 96), uint256(sqrtP), uint256(1) << 96);
    }

    function _id(uint256 i) internal view returns (bytes32) {
        return keccak256(abi.encode(keys[i]));
    }

    function _advance(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
        vm.roll(vm.getBlockNumber() + secs * 10);
    }

    function _sharesFor(uint256 budget) internal returns (uint256) {
        uint256 probe = d.vault.totalSupply() / 4;
        uint256 probeValue = _ethFor(3_000e6);
        uint256 snap = vm.snapshotState();
        vm.deal(address(0xD00D), probeValue);
        vm.prank(address(0xD00D));
        uint256 used;
        try d.vault.depositEth{value: probeValue}(probe, address(0xD00D), block.timestamp) returns (uint256 u) {
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
}
