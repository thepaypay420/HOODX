// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";
import {OfficialVaultCatalogV3} from "../../script/OfficialVaultCatalogV3.sol";

contract OfficialVaultCatalogV3Test is Test {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function testCatalogHasTenValidVaultsAndUniqueRoutes() public {
        assertEq(OfficialVaultCatalogV3.count(), 47);
        assertEq(OfficialVaultCatalogV3.vaultCount(), 10);
        address[] memory seen = new address[](OfficialVaultCatalogV3.count());
        for (uint256 i; i < seen.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = OfficialVaultCatalogV3.routeFor(i);
            assertTrue(token != address(0) && token != WETH);
            V2Hop[] memory buys = abi.decode(buy, (V2Hop[]));
            V2Hop[] memory sells = abi.decode(sell, (V2Hop[]));
            assertEq(buys[0].tokenIn, WETH);
            assertEq(buys[buys.length - 1].tokenOut, token);
            assertEq(sells[0].tokenIn, token);
            assertEq(sells[sells.length - 1].tokenOut, WETH);
            for (uint256 j; j < i; ++j) assertTrue(seen[j] != token);
            seen[i] = token;
        }
        for (uint256 i; i < OfficialVaultCatalogV3.vaultCount(); ++i) {
            (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory weights) = OfficialVaultCatalogV3.vault(i);
            assertGe(bytes(slug).length, 3); assertLe(bytes(slug).length, 16); assertGt(bytes(symbol).length, 0);
            assertEq(indexes.length, weights.length); assertGe(indexes.length, 4); assertLe(indexes.length, 6);
            uint256 total = cashBps;
            bool differs;
            for (uint256 j; j < weights.length; ++j) {
                assertLt(indexes[j], seen.length);
                assertGe(weights[j], 750, "position below tradable floor");
                assertLe(weights[j], 2500, "position above concentration cap");
                if (j > 0 && weights[j] != weights[0]) differs = true;
                total += weights[j];
            }
            assertEq(total, 10_000);
            assertTrue(differs, "smart weights unexpectedly equal");
        }
        emit log_named_bytes32("catalog fingerprint", OfficialVaultCatalogV3.fingerprint());
    }
}
