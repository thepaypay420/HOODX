// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxLaunchHunterV3} from "../../contracts/launch/HoodxLaunchHunterV3.sol";
import {HunterToken, HunterWeth, HunterOracle, HunterExecutor, HunterPolicy} from "./LaunchHunterV1.t.sol";

contract BalanceGriefTokenV3 is HunterToken {
    bool public grief;
    constructor() HunterToken("GRIEF") {}

    function setGrief(bool value) external {
        grief = value;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (grief) revert("balance grief");
        return super.balanceOf(account);
    }
}

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
        uint256[] memory baseSeedAmounts = new uint256[](1);
        baseSeedAmounts[0] = 80 ether;
        hunter = new HoodxLaunchHunterV3(
            address(policy), curator, 20 ether, 100 ether, 200 ether, baseSleeves, baseSeedAmounts
        );
        baseSleeve.mint(curator, 80 ether);
        vm.deal(curator, 21 ether);
        vm.prank(curator);
        baseSleeve.approve(address(hunter), 80 ether);
        vm.prank(curator);
        hunter.bootstrap{value: 20 ether}(curator);
    }

    function _arm(uint256 i) internal {
        vm.prank(curator);
        hunter.arm(ids[i], keccak256(abi.encode("cluster", i)), keccak256(abi.encode("evidence", i)));
    }

    function _ready(uint256 count) internal {
        for (uint256 i; i < count; ++i) {
            _arm(i);
        }
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
        uint256[] memory seedAmounts = new uint256[](1);
        seedAmounts[0] = 80 ether;
        HoodxLaunchHunterV3 emptyHunter =
            new HoodxLaunchHunterV3(address(policy), curator, 20 ether, 100 ether, 200 ether, sleeves, seedAmounts);
        vm.prank(curator);
        emptySleeve.approve(address(emptyHunter), 80 ether);
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

    function testMaliciousActiveBalanceReadCannotBlockBaseAndWethRecovery() public {
        BalanceGriefTokenV3 grief = new BalanceGriefTokenV3();
        HunterOracle oracle = new HunterOracle();
        bytes32 id = policy.add(address(grief), address(oracle));
        executor.setRate(address(grief), 1 ether);
        vm.prank(curator);
        hunter.arm(id, keccak256("grief-cluster"), keccak256("reviewed-evidence"));
        vm.warp(block.timestamp + 12 hours);
        vm.prank(curator);
        hunter.enter(address(grief), 10 ether, 9.7 ether, vm.getBlockTimestamp() + 5 minutes);
        grief.setGrief(true);

        uint256 baseBefore = baseSleeve.balanceOf(curator);
        vm.prank(curator);
        hunter.redeemInKind(200 ether, curator);
        assertEq(hunter.totalSupply(), 0);
        assertEq(baseSleeve.balanceOf(curator), baseBefore + 80 ether);
        assertEq(weth.balanceOf(curator), 10 ether);
        grief.setGrief(false);
        assertEq(grief.balanceOf(curator), 10 ether);
    }

    function testPartialRedemptionScalesCostBasisAndCannotFabricateStop() public {
        _ready(1);
        _enter(0);
        vm.prank(curator);
        hunter.redeemInKind(40 ether, curator);
        vm.expectRevert(HoodxLaunchHunterV3.NotReady.selector);
        hunter.enforceExit(address(tokens[0]), 0, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.trackedCandidateBalance(address(tokens[0])), 8 ether);
    }

    function testCandidateDonationCannotFabricateProfitExitOrRisk() public {
        _ready(1);
        _enter(0);
        tokens[0].mint(address(hunter), 100 ether);
        assertEq(hunter.riskyAssets(), 10 ether);
        vm.expectRevert(HoodxLaunchHunterV3.NotReady.selector);
        hunter.enforceExit(address(tokens[0]), 0, vm.getBlockTimestamp() + 5 minutes);
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
        oracles[0].setPrice(1.5 ether);
        executor.setRate(address(tokens[0]), 1.5 ether);
        hunter.enforceExit(address(tokens[0]), 14.55 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 30 minutes);
        _enter(1);
        oracles[1].setPrice(1.5 ether);
        executor.setRate(address(tokens[1]), 1.5 ether);
        hunter.enforceExit(address(tokens[1]), 14.55 ether, vm.getBlockTimestamp() + 5 minutes);
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

    function testFiftyPercentProfitClosesWithoutWaiting() public {
        _ready(1);
        _enter(0);
        oracles[0].setPrice(1.5 ether);
        executor.setRate(address(tokens[0]), 1.5 ether);
        hunter.enforceExit(address(tokens[0]), 14.55 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(weth.balanceOf(address(hunter)), 25 ether);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testTwentyPercentStopClosesWithoutWaiting() public {
        _ready(1);
        _enter(0);
        oracles[0].setPrice(0.8 ether);
        executor.setRate(address(tokens[0]), 0.8 ether);
        hunter.enforceExit(address(tokens[0]), 7.76 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(weth.balanceOf(address(hunter)), 18 ether);
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
        executor.setRate(address(tokens[0]), 0.96 ether);
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
