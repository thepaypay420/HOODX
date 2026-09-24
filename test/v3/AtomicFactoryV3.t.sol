// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProportionalV3Fixture} from "./ProportionalV3.t.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {HoodxAtomicFactoryV3} from "../../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxRebalanceControllerV3} from "../../contracts/v3/HoodxRebalanceControllerV3.sol";

contract AtomicFactoryV3Test is ProportionalV3Fixture {
    function testCreatesAtomicReadyVaultInOneTransaction() public {
        HoodxProportionalV3 implementation = new HoodxProportionalV3(address(policy), address(vault.feeModel()));
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = vault.configId(address(a));
        ids[1] = vault.configId(address(b));
        HoodxAtomicFactoryV3 factory = new HoodxAtomicFactoryV3(address(this), treasury, address(implementation), ids);
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init(
            alice, address(this), recipient, treasury, "Atomic Basket", "ABASK", 40, 10, 2500, 0.02 ether, ""
        );

        (address created, address controllerAddress) = factory.createAtomic("atomicbasket", init, ids, weights);
        HoodxProportionalV3 createdVault = HoodxProportionalV3(payable(created));
        HoodxRebalanceControllerV3 createdController = HoodxRebalanceControllerV3(controllerAddress);

        assertEq(createdVault.owner(), controllerAddress);
        assertEq(createdController.curator(), alice);
        assertEq(address(createdController.vault()), created);
        assertEq(factory.bySlug("atomicbasket"), created);
        assertEq(factory.configIdByToken(address(a)), ids[0]);

        vm.prank(alice);
        createdController.setPaused(true);
        assertTrue(createdVault.paused());
    }

    function testRejectsUnregisteredAndStaleConfigs() public {
        HoodxProportionalV3 implementation = new HoodxProportionalV3(address(policy), address(vault.feeModel()));
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = vault.configId(address(a));
        HoodxAtomicFactoryV3 factory = new HoodxAtomicFactoryV3(address(this), treasury, address(implementation), ids);
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        bytes32[] memory requested = new bytes32[](2);
        requested[0] = ids[0];
        requested[1] = vault.configId(address(b));
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init(
            alice, address(this), recipient, treasury, "Atomic Basket", "ABASK", 40, 10, 2500, 0.02 ether, ""
        );

        vm.expectRevert(HoodxAtomicFactoryV3.Invalid.selector);
        factory.createAtomic("atomicbasket", init, requested, weights);

        bytes32[] memory next = new bytes32[](1);
        next[0] = requested[1];
        factory.registerConfigs(next);
        (address created,) = factory.createAtomic("atomicbasket", init, requested, weights);
        assertTrue(created.code.length > 0);
    }
}
