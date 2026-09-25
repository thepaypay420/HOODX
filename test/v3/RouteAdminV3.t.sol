// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxRouteAdminV3} from "../../contracts/v3/HoodxRouteAdminV3.sol";
import {HoodxProportionalPolicyV3} from "../../contracts/v3/HoodxProportionalPolicyV3.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";
import {TestTokenV2, TestWethV2, TestExecutorV2} from "../v2/VaultV2.t.sol";

contract RouteAdminV3Test is Test {
    address admin = address(0xA11CE);
    HoodxProportionalPolicyV3 policy;
    HoodxRouteAdminV3 routeAdmin;
    TestWethV2 weth;
    TestTokenV2 token;

    function setUp() public {
        weth = new TestWethV2();
        token = new TestTokenV2("TKN");
        TestExecutorV2 executor = new TestExecutorV2(address(weth));
        policy = new HoodxProportionalPolicyV3(address(this), address(executor));
        routeAdmin = new HoodxRouteAdminV3(admin, address(policy));
        policy.transferOwnership(address(routeAdmin));
        vm.prank(admin); routeAdmin.acceptPolicyOwnership();
    }

    function testOwnerCanBatchAndRecoverPolicyOwnership() public {
        V2Hop[] memory hops = new V2Hop[](1); hops[0].kind = 3; hops[0].tokenIn = address(weth); hops[0].tokenOut = address(token); hops[0].fee = 3000;
        bytes[] memory buys = new bytes[](1); buys[0] = abi.encode(hops);
        (hops[0].tokenIn, hops[0].tokenOut) = (hops[0].tokenOut, hops[0].tokenIn);
        bytes[] memory sells = new bytes[](1); sells[0] = abi.encode(hops);
        address[] memory tokens = new address[](1); tokens[0] = address(token);
        vm.prank(admin); bytes32[] memory ids = routeAdmin.approveRoutes(tokens, buys, sells, bytes32(uint256(1)));
        (address admitted,,,) = policy.config(ids[0]); assertEq(admitted, address(token));
        vm.prank(admin); routeAdmin.nominatePolicyOwner(admin);
        vm.prank(admin); policy.acceptOwnership();
        assertEq(policy.owner(), admin);
    }

    function testNonOwnerCannotAdminister() public {
        vm.expectRevert(); routeAdmin.acceptPolicyOwnership();
        vm.expectRevert(); routeAdmin.nominatePolicyOwner(address(this));
    }
}
