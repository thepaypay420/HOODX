// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {V2Hop, V2PoolKey} from "../../contracts/v2/Types.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxFeeModelV4} from "../../contracts/v3/HoodxFeeModelV4.sol";

contract FeeModelV4ForkTest is Test {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ACTIVE_QUOTIENT = 0x2531F3ca1b31086b7FC130eCDa6D3253DAF83ba3;
    address constant LEGACY_QUOTIENT = 0x013940c3daa5e2Bb12df1Ea94AfE47Ce84c0db4f;
    address constant ROUTING = 0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant DOPPLER = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    address constant REHYPE = 0x9982538F41f2ae29ddb9d3D9307010052984FDbB;

    HoodxFeeModelV4 model;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envUint("HOODX_FORK_BLOCK"));
        model = new HoodxFeeModelV4(ROUTING, QUOTRON_HOOK, PONS_HOOK, POOL_MANAGER, DOPPLER, REHYPE);
    }

    function testActiveQuotientUsesReviewedFamily() public view {
        assertEq(model.factor(_route(ACTIVE_QUOTIENT)), 884_250_000_000_000_000);
    }

    function testLegacyQuotientCannotReuseActiveIdentity() public {
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(_route(LEGACY_QUOTIENT));
    }

    function _route(address asset) private pure returns (bytes memory) {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 4;
        h[0].tokenIn = WETH;
        h[0].tokenOut = asset;
        h[0].key = V2PoolKey(WETH, asset, 0x800000, 200, DOPPLER);
        return abi.encode(h);
    }
}
