// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";
import {ProportionalWatchlistV3} from "../../script/ProportionalWatchlistV3.sol";

contract ProportionalWatchlistManifestV3Test is Test {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function testManifestIsCompleteUniqueAndRoundTrips() public {
        assertEq(ProportionalWatchlistV3.count(), 20);
        address[] memory seen = new address[](20);
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
        }
        emit log_named_bytes32("route fingerprint", ProportionalWatchlistV3.fingerprint());
    }
}
