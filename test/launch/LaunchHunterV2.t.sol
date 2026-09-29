// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxLaunchHunterV2} from "../../contracts/launch/HoodxLaunchHunterV2.sol";
import {HunterToken, HunterWeth, HunterOracle, HunterExecutor, HunterPolicy} from "./LaunchHunterV1.t.sol";

contract LaunchHunterV2Test is Test {
    HunterWeth weth;
    HunterExecutor executor;
    HunterPolicy policy;
    HoodxLaunchHunterV2 hunter;
    HunterToken[6] tokens;
    HunterOracle[6] oracles;
    bytes32[6] ids;
    address curator = address(0xC0FFEE);

    function setUp() public {
        weth = new HunterWeth();
        executor = new HunterExecutor(address(weth));
        policy = new HunterPolicy(address(executor));
        for (uint256 i; i < 6; ++i) {
            tokens[i] = new HunterToken(string.concat("V2T", vm.toString(i)));
            oracles[i] = new HunterOracle();
            ids[i] = policy.add(address(tokens[i]), address(oracles[i]));
            executor.setRate(address(tokens[i]), 1 ether);
        }
        hunter = new HoodxLaunchHunterV2(address(policy), curator, 100 ether, 200 ether);
        vm.deal(curator, 101 ether);
        vm.prank(curator);
        hunter.bootstrap{value: 100 ether}(curator);
    }

    function _arm(uint256 i) internal {
        vm.prank(curator);
        hunter.arm(ids[i], keccak256(abi.encode("cluster", i)), keccak256(abi.encode("evidence", i)));
    }

    function testEconomicallyMeaningfulFiveToTenPercentSizing() public {
        _arm(0);
        vm.warp(block.timestamp + 12 hours);
        vm.startPrank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 4.999 ether, 4.7 ether, vm.getBlockTimestamp() + 5 minutes);
        hunter.enter(address(tokens[0]), 10 ether, 9.5 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.stopPrank();
        assertEq(tokens[0].balanceOf(address(hunter)), 10 ether);
        assertEq(hunter.riskyAssets(), 10 ether);
    }

    function testFivePositionsCanUseHalfThePilot() public {
        for (uint256 i; i < 5; ++i) {
            _arm(i);
        }
        vm.warp(block.timestamp + 12 hours);
        vm.startPrank(curator);
        for (uint256 i; i < 4; ++i) {
            hunter.enter(address(tokens[i]), 10 ether, 9.5 ether, vm.getBlockTimestamp() + 5 minutes);
            vm.warp(vm.getBlockTimestamp() + 30 minutes);
        }
        vm.expectRevert();
        hunter.enter(address(tokens[4]), 10 ether, 9.5 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        hunter.enter(address(tokens[4]), 10 ether, 9.5 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.stopPrank();
        assertEq(hunter.activeTokens().length, 5);
        assertEq(hunter.riskyAssets(), 50 ether);
        assertEq(weth.balanceOf(address(hunter)), 50 ether);
    }

    function testEntrySpacingPreventsRapidChurn() public {
        _arm(0);
        _arm(1);
        vm.warp(block.timestamp + 12 hours);
        vm.startPrank(curator);
        hunter.enter(address(tokens[0]), 5 ether, 4.85 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.expectRevert();
        hunter.enter(address(tokens[1]), 5 ether, 4.85 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 30 minutes);
        hunter.enter(address(tokens[1]), 5 ether, 4.85 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.stopPrank();
    }

    function testTwelveHourObservationAndTwentyFourHourExit() public {
        _arm(0);
        vm.warp(block.timestamp + 12 hours - 1);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 5 ether, 4.75 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 1);
        vm.prank(curator);
        hunter.enter(address(tokens[0]), 5 ether, 4.75 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 24 hours - 1);
        vm.expectRevert();
        hunter.enforceExit(address(tokens[0]), 4.75 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 1);
        hunter.enforceExit(address(tokens[0]), 4.75 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testDirectRecoveryStillBypassesMarketInfrastructure() public {
        _arm(0);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(curator);
        hunter.enter(address(tokens[0]), 10 ether, 9.5 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.prank(curator);
        hunter.redeemInKind(200 ether, curator);
        assertEq(weth.balanceOf(curator), 90 ether);
        assertEq(tokens[0].balanceOf(curator), 10 ether);
        assertEq(hunter.totalSupply(), 0);
    }
}
