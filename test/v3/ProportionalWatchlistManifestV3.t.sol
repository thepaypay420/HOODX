// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {ProportionalWatchlistV3} from "../../script/ProportionalWatchlistV3.sol";

contract ProportionalWatchlistManifestV3Test is Test {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ACTIVE_QUOTIENT = 0x2531F3ca1b31086b7FC130eCDa6D3253DAF83ba3;
    address constant LEGACY_QUOTIENT = 0x013940c3daa5e2Bb12df1Ea94AfE47Ce84c0db4f;
    address constant DOPPLER_HOOK = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;

    function testManifestIsCompleteUniqueAndRoundTrips() public {
        assertEq(ProportionalWatchlistV3.count(), 21);
        address[] memory seen = new address[](ProportionalWatchlistV3.count());
        uint256 totalWeight;
        for (uint256 i; i < seen.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = ProportionalWatchlistV3.routeFor(i);
            assertTrue(token != address(0) && token != WETH);
            V2Hop[] memory buys = abi.decode(buy, (V2Hop[]));
            V2Hop[] memory sells = abi.decode(sell, (V2Hop[]));
            assertTrue(buys[0].tokenIn == WETH || buys[0].tokenIn == address(0));
            assertEq(buys[buys.length - 1].tokenOut, token);
            assertEq(sells[0].tokenIn, token);
            assertTrue(sells[sells.length - 1].tokenOut == WETH || sells[sells.length - 1].tokenOut == address(0));
            assertEq(buys.length, sells.length);
            for (uint256 j; j < i; ++j) {
                assertTrue(seen[j] != token);
            }
            seen[i] = token;
            totalWeight += ProportionalWatchlistV3.targetFor(i);
        }
        assertEq(totalWeight, 7500);
        emit log_named_bytes32("route fingerprint", ProportionalWatchlistV3.fingerprint());
    }

    function testQuotientIdentityAndPoolKeyArePinned() public {
        (address token, bytes memory buy,) = ProportionalWatchlistV3.routeFor(18);
        V2Hop[] memory hops = abi.decode(buy, (V2Hop[]));
        assertEq(token, ACTIVE_QUOTIENT);
        assertTrue(token != LEGACY_QUOTIENT);
        assertEq(hops.length, 1);
        assertEq(hops[0].kind, 4);
        assertEq(hops[0].key.currency0, WETH);
        assertEq(hops[0].key.currency1, ACTIVE_QUOTIENT);
        assertEq(hops[0].key.fee, 8388608);
        assertEq(hops[0].key.tickSpacing, 200);
        assertEq(hops[0].key.hooks, DOPPLER_HOOK);
        assertEq(
            keccak256(abi.encode(hops[0].key)),
            0xc6c2cd8e0f1e9373e0e2c60da3b6619753f7ff05599d59a66a358cbbaecc5ccf
        );
    }

    function testActiveQuotientRouteIsBlockedByDeployedFeeModelRules() public {
        (, bytes memory buy,) = ProportionalWatchlistV3.routeFor(18);
        HoodxFeeModelV3 model = new HoodxFeeModelV3(address(this), address(this), address(this));
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(buy);
    }
}
