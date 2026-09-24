// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProportionalV3Fixture} from "./ProportionalV3.t.sol";
import {HoodxRebalanceControllerV3} from "../../contracts/v3/HoodxRebalanceControllerV3.sol";

contract RebalanceControllerV3Test is ProportionalV3Fixture {
    HoodxRebalanceControllerV3 internal controller;
    address internal nextCurator = address(0xcafe);

    function setUp() public override {
        super.setUp();
        controller = new HoodxRebalanceControllerV3(address(vault), address(this));
    }

    function _activate() internal {
        vault.transferOwnership(address(controller));
        controller.activate();
    }

    function _weights() internal pure returns (uint16[] memory weights) {
        weights = new uint16[](2);
        weights[0] = 2750;
        weights[1] = 4750;
    }

    function _steps(uint256 buyMin) internal view returns (HoodxRebalanceControllerV3.Step[] memory steps) {
        steps = new HoodxRebalanceControllerV3.Step[](2);
        steps[0] = HoodxRebalanceControllerV3.Step(address(a), false, 0.01 ether, 0.0097 ether);
        steps[1] = HoodxRebalanceControllerV3.Step(address(b), true, 0.01 ether, buyMin);
    }

    function _hash() internal view returns (bytes32) {
        return keccak256(abi.encode(vault.constituents()));
    }

    function testAtomicRebalanceAdvancesNonceForTargetsAndEveryStep() public {
        seed();
        _activate();
        uint256 nonce = vault.planNonce();
        uint256 aBefore = vault.freeBalance(address(a));
        uint256 bBefore = vault.freeBalance(address(b));
        uint256 cashBefore = vault.freeBalance(address(w));

        controller.atomicRebalance(
            2500, _weights(), _steps(0.0097 ether), _hash(), nonce, cashBefore - 1, block.timestamp + 5 minutes
        );

        assertEq(vault.planNonce(), nonce + 3);
        assertEq(vault.targetBps(address(a)), 2750);
        assertEq(vault.targetBps(address(b)), 4750);
        assertEq(vault.freeBalance(address(a)), aBefore - 0.01 ether);
        assertEq(vault.freeBalance(address(b)), bBefore + 0.01 ether);
        assertEq(vault.freeBalance(address(w)), cashBefore);
    }

    function testExactLegQuotesReturnActualOutputAndRollBack() public {
        seed();
        _activate();
        uint256 tokenBefore = vault.freeBalance(address(a));
        uint256 cashBefore = vault.freeBalance(address(w));
        uint256 nonceBefore = vault.planNonce();

        vm.expectRevert(abi.encodeWithSelector(HoodxRebalanceControllerV3.RebalanceQuote.selector, 0.01 ether));
        controller.quoteRebalance{value: 0.01 ether}(address(a), true, 0.01 ether);
        assertEq(vault.freeBalance(address(a)), tokenBefore);
        assertEq(vault.freeBalance(address(w)), cashBefore);
        assertEq(vault.planNonce(), nonceBefore);

        vm.expectRevert(abi.encodeWithSelector(HoodxRebalanceControllerV3.RebalanceQuote.selector, 0.01 ether));
        controller.quoteRebalance(address(a), false, 0.01 ether);
        assertEq(vault.freeBalance(address(a)), tokenBefore);
        assertEq(vault.freeBalance(address(w)), cashBefore);
        assertEq(vault.planNonce(), nonceBefore);
    }

    function testStalePlanAndLaterFailureRollBackWholeTransaction() public {
        seed();
        _activate();
        uint256 nonce = vault.planNonce();
        uint256 aBefore = vault.freeBalance(address(a));
        uint256 cashBefore = vault.freeBalance(address(w));
        bytes32 basketHash = _hash();
        uint16[] memory weights = _weights();

        vm.expectRevert(HoodxRebalanceControllerV3.StalePlan.selector);
        controller.atomicRebalance(
            2500, weights, _steps(0.0097 ether), basketHash, nonce + 1, cashBefore - 1, block.timestamp + 5 minutes
        );

        vm.expectRevert();
        controller.atomicRebalance(
            2500, weights, _steps(0.02 ether), basketHash, nonce, cashBefore - 1, block.timestamp + 5 minutes
        );

        assertEq(vault.planNonce(), nonce);
        assertEq(vault.freeBalance(address(a)), aBefore);
        assertEq(vault.freeBalance(address(w)), cashBefore);
        assertEq(vault.targetBps(address(a)), 3750);
    }

    function testAtomicRebalanceRejectsCuratorFloorBelowFreshQuoteAndRollsBack() public {
        seed();
        _activate();
        uint256 nonce = vault.planNonce();
        uint256 aBefore = vault.freeBalance(address(a));
        uint256 cashBefore = vault.freeBalance(address(w));
        HoodxRebalanceControllerV3.Step[] memory steps = _steps(0.0097 ether);
        bytes32 basketHash = _hash();
        uint16[] memory weights = _weights();
        steps[0].minOut = 1;

        vm.expectRevert(
            abi.encodeWithSelector(HoodxRebalanceControllerV3.ExecutionFloor.selector, uint256(1), 0.0097 ether)
        );
        controller.atomicRebalance(2500, weights, steps, basketHash, nonce, cashBefore - 1, block.timestamp + 5 minutes);

        assertEq(vault.planNonce(), nonce);
        assertEq(vault.targetBps(address(a)), 3750);
        assertEq(vault.freeBalance(address(a)), aBefore);
        assertEq(vault.freeBalance(address(w)), cashBefore);
    }

    function testForwardedRebalanceRejectsFloorBelowFreshQuote() public {
        seed();
        _activate();
        uint256 nonce = vault.planNonce();

        vm.expectRevert(
            abi.encodeWithSelector(HoodxRebalanceControllerV3.ExecutionFloor.selector, 0.0097 ether - 1, 0.0097 ether)
        );
        controller.rebalance(address(a), false, 0.01 ether, 0.0097 ether - 1, 0, nonce, block.timestamp + 5 minutes);
        assertEq(vault.planNonce(), nonce);
    }

    function testEmergencyUnwindRejectsFloorBelowFreshQuote() public {
        seed();
        _activate();
        controller.setPaused(true);
        uint256 tokenBefore = vault.freeBalance(address(a));

        vm.expectRevert(
            abi.encodeWithSelector(HoodxRebalanceControllerV3.ExecutionFloor.selector, 0.0097 ether - 1, 0.0097 ether)
        );
        controller.emergencyUnwind(address(a), 0.01 ether, 0.0097 ether - 1, block.timestamp + 5 minutes);
        assertEq(vault.freeBalance(address(a)), tokenBefore);
    }

    function testFreshQuoteFloorRoundsUpAndExactFloorPasses() public {
        seed();
        _activate();
        uint256 amount = 101;
        uint256 required = 98;
        uint256 beforeBalance = vault.freeBalance(address(a));

        controller.rebalance(address(a), false, amount, required, 0, vault.planNonce(), block.timestamp + 5 minutes);
        assertEq(vault.freeBalance(address(a)), beforeBalance - amount);
    }

    function testSellCanBuildCashTowardFinalFloorBeforeBuy() public {
        seed();
        _activate();
        uint256 nonce = vault.planNonce();
        uint256 cashBefore = vault.freeBalance(address(w));
        HoodxRebalanceControllerV3.Step[] memory steps = new HoodxRebalanceControllerV3.Step[](2);
        steps[0] = HoodxRebalanceControllerV3.Step(address(a), false, 0.01 ether, 0.0097 ether);
        steps[1] = HoodxRebalanceControllerV3.Step(address(b), true, 0.001 ether, 0.00097 ether);

        controller.atomicRebalance(
            2500, _weights(), steps, _hash(), nonce, cashBefore + 0.008 ether, block.timestamp + 5 minutes
        );

        assertGe(vault.freeBalance(address(w)), cashBefore + 0.008 ether);
    }

    function testRejectsUnsafeOrderingAndDuplicateAssets() public {
        seed();
        _activate();
        uint256 nonce = vault.planNonce();
        bytes32 basketHash = _hash();
        uint16[] memory weights = _weights();
        HoodxRebalanceControllerV3.Step[] memory steps = _steps(0.0097 ether);
        (steps[0], steps[1]) = (steps[1], steps[0]);

        vm.expectRevert(HoodxRebalanceControllerV3.UnsafeOrder.selector);
        controller.atomicRebalance(2500, weights, steps, basketHash, nonce, 0.024 ether, block.timestamp + 5 minutes);

        steps = _steps(0.0097 ether);
        steps[1].token = address(a);
        vm.expectRevert(HoodxRebalanceControllerV3.Invalid.selector);
        controller.atomicRebalance(2500, weights, steps, basketHash, nonce, 0.024 ether, block.timestamp + 5 minutes);
    }

    function testControllerHandoffAndVaultReleasePreserveCustody() public {
        seed();
        _activate();
        uint256 beforeBalance = vault.freeBalance(address(a));

        controller.proposeCurator(nextCurator);
        vm.prank(nextCurator);
        controller.acceptCurator();
        assertEq(controller.curator(), nextCurator);

        vm.prank(nextCurator);
        controller.releaseVault(nextCurator);
        vm.prank(nextCurator);
        vault.acceptOwnership();
        assertEq(vault.owner(), nextCurator);
        assertEq(vault.freeBalance(address(a)), beforeBalance);
    }
}
