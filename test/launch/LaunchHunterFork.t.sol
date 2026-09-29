// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxLaunchHunterV1} from "../../contracts/launch/HoodxLaunchHunterV1.sol";
import {HoodxLaunchHunterLaunchV1} from "../../contracts/launch/HoodxLaunchHunterLaunchV1.sol";

contract LaunchHunterForkTest is Test {
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant EXECUTOR = 0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        assertEq(block.chainid, 4663);
    }

    function testExactLaunchBootstrapAndRouteIndependentRecovery() public {
        HoodxLaunchHunterLaunchV1 launcher = new HoodxLaunchHunterLaunchV1();
        HoodxPolicyV2 policy = launcher.policy();
        HoodxLaunchHunterV1 vault = launcher.vault();
        assertEq(policy.owner(), CURATOR);
        assertEq(address(policy.executor()), EXECUTOR);
        assertEq(vault.curator(), CURATOR);
        assertEq(vault.seedAmount(), 0.073973 ether);
        assertEq(vault.totalSupply(), 0);

        vm.deal(CURATOR, 0.08 ether);
        vm.prank(CURATOR);
        vault.bootstrap{value: 0.073973 ether}(CURATOR);
        assertEq(vault.balanceOf(CURATOR), 200 ether);
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0.073973 ether);

        vm.prank(CURATOR);
        vault.redeemInKind(200 ether, CURATOR);
        assertEq(vault.totalSupply(), 0);
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0);
        assertEq(IERC20(WETH).balanceOf(CURATOR), 0.073973 ether);
    }

    function testNonCuratorCannotBootstrapOrManage() public {
        HoodxLaunchHunterV1 vault = (new HoodxLaunchHunterLaunchV1()).vault();
        vm.deal(address(this), 0.08 ether);
        vm.expectRevert();
        vault.bootstrap{value: 0.073973 ether}(address(this));
        vm.expectRevert();
        vault.setManagementPaused(true);
    }
}
