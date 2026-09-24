// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxFactoryV2} from "../../contracts/v2/HoodxFactoryV2.sol";
import {HoodxRebalanceControllerV2} from "../../contracts/v2/HoodxRebalanceControllerV2.sol";
import {TestWethV2, TestTokenV2, TestOracleV2, TestExecutorV2, TestPolicyV2} from "./VaultV2.t.sol";

contract RebalanceControllerV2Test is Test {
    TestWethV2 internal weth;
    TestTokenV2 internal tokenA;
    TestTokenV2 internal tokenB;
    TestOracleV2 internal oracle;
    TestExecutorV2 internal executor;
    TestPolicyV2 internal policy;
    HoodxIndexV2 internal vault;
    HoodxRebalanceControllerV2 internal controller;

    address internal curator = address(0xc0);
    address internal alice = address(0xa11ce);
    address internal nextCurator = address(0xcafe);

    function setUp() public {
        weth = new TestWethV2();
        tokenA = new TestTokenV2("A");
        tokenB = new TestTokenV2("B");
        oracle = new TestOracleV2();
        executor = new TestExecutorV2(address(weth));
        policy = new TestPolicyV2(address(executor), address(oracle));
        HoodxIndexV2 implementation = new HoodxIndexV2(address(policy));
        HoodxFactoryV2 factory = new HoodxFactoryV2(address(this), address(0xc2), address(implementation));

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = policy.add(address(tokenA));
        ids[1] = policy.add(address(tokenB));
        uint16[] memory weights = _weights(3750, 3750);
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init({
            curator: curator,
            creator: address(0xc1),
            recipient: address(0xc1),
            treasury: address(0xc2),
            name: "Atomic",
            symbol: "ATOM",
            creatorFee: 0,
            protocolFee: 10,
            cashBps: 2500,
            firstDeposit: 0.02 ether,
            image: ""
        });
        vault = HoodxIndexV2(payable(factory.create("696x", init, ids, weights)));
        controller = new HoodxRebalanceControllerV2(address(vault), curator);
        vm.deal(alice, 10 ether);
        vm.deal(address(weth), 10 ether);
    }

    function _activate() internal {
        vm.prank(curator);
        vault.transferOwnership(address(controller));
        vm.prank(curator);
        controller.activate();
    }

    function _deposit() internal {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(1e12, block.timestamp);
    }

    function _weights(uint16 a, uint16 b) internal pure returns (uint16[] memory weights) {
        weights = new uint16[](2);
        weights[0] = a;
        weights[1] = b;
    }

    function _steps(uint256 sellMin, uint256 buyMin)
        internal
        view
        returns (HoodxRebalanceControllerV2.Step[] memory steps)
    {
        steps = new HoodxRebalanceControllerV2.Step[](2);
        steps[0] = HoodxRebalanceControllerV2.Step(address(tokenA), false, 0.1 ether, sellMin);
        steps[1] = HoodxRebalanceControllerV2.Step(address(tokenB), true, 0.1 ether, buyMin);
    }

    function _hash() internal view returns (bytes32) {
        return keccak256(abi.encode(vault.constituents()));
    }

    function testActivationRequiresExistingCuratorAndPendingOwnership() public {
        vm.prank(alice);
        vm.expectRevert(HoodxRebalanceControllerV2.Unauthorized.selector);
        controller.activate();

        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.Unauthorized.selector);
        controller.activate();

        _activate();
        assertEq(vault.owner(), address(controller));
        assertEq(controller.curator(), curator);
    }

    function testAtomicTargetsSellAndBuyUseOneControllerCall() public {
        _deposit();
        _activate();
        bytes32 basketHash = _hash();
        uint256 aBefore = vault.freeBalance(address(tokenA));
        uint256 bBefore = vault.freeBalance(address(tokenB));
        uint256 cashBefore = vault.freeBalance(address(weth));

        vm.prank(curator);
        controller.atomicRebalance(
            2500, _weights(2750, 4750), _steps(0.097 ether, 0.097 ether), basketHash, 0.249 ether, block.timestamp + 5 minutes
        );

        assertEq(vault.targetBps(address(tokenA)), 2750);
        assertEq(vault.targetBps(address(tokenB)), 4750);
        assertEq(vault.freeBalance(address(tokenA)), aBefore - 0.1 ether);
        assertEq(vault.freeBalance(address(tokenB)), bBefore + 0.1 ether);
        assertEq(vault.freeBalance(address(weth)), cashBefore);
    }

    function testLaterFailureRollsBackTargetsAndEarlierSale() public {
        _deposit();
        _activate();
        uint256 aBefore = vault.freeBalance(address(tokenA));
        uint256 bBefore = vault.freeBalance(address(tokenB));
        uint256 cashBefore = vault.freeBalance(address(weth));
        bytes32 basketHash = _hash();

        vm.prank(curator);
        vm.expectRevert();
        controller.atomicRebalance(
            2500, _weights(2750, 4750), _steps(0.097 ether, 0.2 ether), basketHash, 0.25 ether, block.timestamp + 5 minutes
        );

        assertEq(vault.targetBps(address(tokenA)), 3750);
        assertEq(vault.targetBps(address(tokenB)), 3750);
        assertEq(vault.freeBalance(address(tokenA)), aBefore);
        assertEq(vault.freeBalance(address(tokenB)), bBefore);
        assertEq(vault.freeBalance(address(weth)), cashBefore);
    }

    function testCashFloorRollsBackWholePlan() public {
        _deposit();
        _activate();
        bytes32 basketHash = _hash();
        uint256 aBefore = vault.freeBalance(address(tokenA));
        uint256 bBefore = vault.freeBalance(address(tokenB));
        uint256 cashBefore = vault.freeBalance(address(weth));

        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.CashFloor.selector);
        controller.atomicRebalance(
            2500, _weights(2750, 4750), _steps(0.097 ether, 0.097 ether), basketHash, 0.3 ether, block.timestamp + 5 minutes
        );

        assertEq(vault.freeBalance(address(tokenA)), aBefore);
        assertEq(vault.freeBalance(address(tokenB)), bBefore);
        assertEq(vault.freeBalance(address(weth)), cashBefore);
        assertEq(vault.targetBps(address(tokenA)), 3750);
    }

    function testRejectsUnauthorizedStaleDuplicateAndUnsafePlans() public {
        _deposit();
        _activate();
        HoodxRebalanceControllerV2.Step[] memory steps = _steps(0.097 ether, 0.097 ether);
        bytes32 basketHash = _hash();

        vm.prank(alice);
        vm.expectRevert(HoodxRebalanceControllerV2.Unauthorized.selector);
        controller.atomicRebalance(2500, _weights(2750, 4750), steps, basketHash, 0.25 ether, block.timestamp + 5 minutes);

        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.StalePlan.selector);
        controller.atomicRebalance(2500, _weights(2750, 4750), steps, bytes32(uint256(1)), 0.25 ether, block.timestamp + 5 minutes);

        steps[1].token = address(tokenA);
        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.Invalid.selector);
        controller.atomicRebalance(2500, _weights(2750, 4750), steps, basketHash, 0.25 ether, block.timestamp + 5 minutes);

        steps = _steps(0.097 ether, 0.097 ether);
        (steps[0], steps[1]) = (steps[1], steps[0]);
        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.UnsafeOrder.selector);
        controller.atomicRebalance(2500, _weights(2750, 4750), steps, basketHash, 0.25 ether, block.timestamp + 5 minutes);
    }

    function testRejectsExpiredAndLongLivedPlans() public {
        _deposit();
        _activate();
        HoodxRebalanceControllerV2.Step[] memory steps = _steps(0.097 ether, 0.097 ether);
        bytes32 basketHash = _hash();

        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.Invalid.selector);
        controller.atomicRebalance(2500, _weights(2750, 4750), steps, basketHash, 0.25 ether, block.timestamp - 1);

        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.Invalid.selector);
        controller.atomicRebalance(2500, _weights(2750, 4750), steps, basketHash, 0.25 ether, block.timestamp + 16 minutes);
    }

    function testForwardsManagementAndSupportsCuratorHandoff() public {
        _activate();
        vm.prank(curator);
        controller.setPaused(true);
        assertTrue(vault.paused());

        bytes32 replacement = policy.add(address(tokenA));
        vm.prank(curator);
        controller.replaceConfig(replacement);
        assertEq(vault.configId(address(tokenA)), replacement);

        vm.prank(curator);
        controller.proposeCurator(nextCurator);
        vm.prank(nextCurator);
        controller.acceptCurator();
        assertEq(controller.curator(), nextCurator);

        vm.prank(curator);
        vm.expectRevert(HoodxRebalanceControllerV2.Unauthorized.selector);
        controller.setPaused(false);
        vm.prank(nextCurator);
        controller.setPaused(false);
        assertFalse(vault.paused());
    }

    function testVaultCanBeReleasedOrReleaseCancelledWithoutMovingFunds() public {
        _deposit();
        _activate();
        uint256 beforeBalance = vault.freeBalance(address(tokenA));

        vm.prank(curator);
        controller.releaseVault(curator);
        assertEq(vault.pendingOwner(), curator);
        vm.prank(curator);
        vault.acceptOwnership();
        assertEq(vault.owner(), curator);
        assertEq(vault.freeBalance(address(tokenA)), beforeBalance);

        vm.prank(curator);
        vault.transferOwnership(address(controller));
        vm.prank(curator);
        controller.activate();
        vm.prank(curator);
        controller.releaseVault(nextCurator);
        vm.prank(curator);
        controller.cancelVaultRelease();
        assertEq(vault.owner(), address(controller));
        assertEq(vault.pendingOwner(), address(0));
        assertEq(vault.freeBalance(address(tokenA)), beforeBalance);
    }
}
