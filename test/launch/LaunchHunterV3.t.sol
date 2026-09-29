// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxLaunchHunterV3} from "../../contracts/launch/HoodxLaunchHunterV3.sol";
import {HunterToken, HunterWeth, HunterOracle, HunterExecutor, HunterPolicy} from "./LaunchHunterV1.t.sol";

contract LaunchHunterV3Test is Test {
    HunterWeth weth;
    HunterExecutor executor;
    HunterPolicy policy;
    HoodxLaunchHunterV3 hunter;
    HunterToken baseSleeve;
    HunterToken[4] tokens;
    HunterOracle[4] oracles;
    bytes32[4] ids;
    address curator = address(0xC0FFEE);

    function setUp() public {
        weth = new HunterWeth();
        executor = new HunterExecutor(address(weth));
        policy = new HunterPolicy(address(executor));
        for (uint256 i; i < 4; ++i) {
            tokens[i] = new HunterToken(string.concat("V3T", vm.toString(i)));
            oracles[i] = new HunterOracle();
            ids[i] = policy.add(address(tokens[i]), address(oracles[i]));
            executor.setRate(address(tokens[i]), 1 ether);
        }
        baseSleeve = new HunterToken("BASE");
        address[] memory baseSleeves = new address[](1);
        baseSleeves[0] = address(baseSleeve);
        hunter = new HoodxLaunchHunterV3(address(policy), curator, 20 ether, 100 ether, 200 ether, baseSleeves);
        baseSleeve.mint(address(hunter), 80 ether);
        vm.deal(curator, 21 ether);
        vm.prank(curator);
        hunter.bootstrap{value: 20 ether}(curator);
    }

    function _arm(uint256 i) internal {
        vm.prank(curator);
        hunter.arm(ids[i], keccak256(abi.encode("cluster", i)), keccak256(abi.encode("evidence", i)));
    }

    function _ready(uint256 count) internal {
        for (uint256 i; i < count; ++i) _arm(i);
        vm.warp(block.timestamp + 12 hours);
    }

    function _enter(uint256 i) internal {
        vm.prank(curator);
        hunter.enter(address(tokens[i]), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
    }

    function testPositionIsExactlyTenPercent() public {
        _ready(1);
        vm.startPrank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 9.999 ether, 9.6 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 10.001 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        hunter.enter(address(tokens[0]), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.stopPrank();
        assertEq(hunter.riskyAssets(), 10 ether);
    }

    function testBootstrapRequiresEveryReviewedBaseSleeve() public {
        HunterToken emptySleeve = new HunterToken("EMPTY");
        address[] memory sleeves = new address[](1);
        sleeves[0] = address(emptySleeve);
        HoodxLaunchHunterV3 emptyHunter =
            new HoodxLaunchHunterV3(address(policy), curator, 20 ether, 100 ether, 200 ether, sleeves);
        vm.prank(curator);
        vm.expectRevert();
        emptyHunter.bootstrap{value: 20 ether}(curator);
    }

    function testCuratorCannotRescueBaseBacking() public {
        vm.prank(curator);
        vm.expectRevert();
        hunter.rescueUnexpectedToken(address(baseSleeve), curator, 1 ether);
        assertEq(baseSleeve.balanceOf(address(hunter)), 80 ether);
    }

    function testTwoPositionsCapLaunchRiskAtTwentyPercent() public {
        _ready(3);
        _enter(0);
        vm.warp(block.timestamp + 30 minutes);
        _enter(1);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[2]), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 2);
        assertEq(hunter.riskyAssets(), 20 ether);
        assertEq(weth.balanceOf(address(hunter)), 0);
    }

    function testEntrySpacingPreventsBurstChurn() public {
        _ready(2);
        _enter(0);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[1]), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 30 minutes);
        _enter(1);
    }

    function testEntryExpiresAfterFortyEightHours() public {
        _arm(0);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
    }

    function testTwoEntryDailyLimitSurvivesFastProfitableExits() public {
        _ready(3);
        _enter(0);
        oracles[0].setPrice(1.2 ether);
        executor.setRate(address(tokens[0]), 1.2 ether);
        hunter.enforceExit(address(tokens[0]), 11.64 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 30 minutes);
        _enter(1);
        oracles[1].setPrice(1.2 ether);
        executor.setRate(address(tokens[1]), 1.2 ether);
        hunter.enforceExit(address(tokens[1]), 11.64 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[2]), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
    }

    function testFourHourTimeoutIsPubliclyEnforceable() public {
        _ready(1);
        _enter(0);
        vm.warp(block.timestamp + 4 hours - 1);
        vm.expectRevert();
        hunter.enforceExit(address(tokens[0]), 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 1);
        hunter.enforceExit(address(tokens[0]), 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 0);
        assertEq(weth.balanceOf(address(hunter)), 20 ether);
    }

    function testTwentyPercentProfitClosesWithoutWaiting() public {
        _ready(1);
        _enter(0);
        oracles[0].setPrice(1.2 ether);
        executor.setRate(address(tokens[0]), 1.2 ether);
        hunter.enforceExit(address(tokens[0]), 11.64 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(weth.balanceOf(address(hunter)), 22 ether);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testFifteenPercentStopClosesWithoutWaiting() public {
        _ready(1);
        _enter(0);
        oracles[0].setPrice(.85 ether);
        executor.setRate(address(tokens[0]), .85 ether);
        hunter.enforceExit(address(tokens[0]), 8.245 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(weth.balanceOf(address(hunter)), 18.5 ether);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testUntriggeredPublicExitCannotMoveFunds() public {
        _ready(1);
        _enter(0);
        vm.expectRevert();
        hunter.enforceExit(address(tokens[0]), 0, vm.getBlockTimestamp() + 5 minutes);
        assertEq(tokens[0].balanceOf(address(hunter)), 10 ether);
    }

    function testProtectedExitFailureLeavesPositionRetryable() public {
        _ready(1);
        _enter(0);
        vm.warp(block.timestamp + 4 hours);
        executor.setRate(address(tokens[0]), .96 ether);
        vm.expectRevert();
        hunter.enforceExit(address(tokens[0]), 0, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 1);
        executor.setRate(address(tokens[0]), 1 ether);
        hunter.enforceExit(address(tokens[0]), 0, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testPauseBlocksNewRiskButNotTimedRecovery() public {
        _ready(1);
        _enter(0);
        vm.prank(curator);
        hunter.setManagementPaused(true);
        vm.warp(block.timestamp + 4 hours);
        hunter.enforceExit(address(tokens[0]), 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testDirectRecoveryBypassesOracleAndExecutor() public {
        _ready(1);
        _enter(0);
        vm.prank(curator);
        hunter.redeemInKind(200 ether, curator);
        assertEq(weth.balanceOf(curator), 10 ether);
        assertEq(tokens[0].balanceOf(curator), 10 ether);
        assertEq(baseSleeve.balanceOf(curator), 80 ether);
        assertEq(hunter.totalSupply(), 0);
    }
}
