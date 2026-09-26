// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {HoodxAtomicFactoryV3} from "../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxHookRegistryV3} from "../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxRouteAdminV3} from "../contracts/v3/HoodxRouteAdminV3.sol";
import {HoodxRebalanceControllerV3} from "../contracts/v3/HoodxRebalanceControllerV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Read-only release rehearsal for the still-pending route approvals and atomic factory.
/// @dev Deliberately refuses broadcast. The production stages remain separately guarded.
contract PrepareAtomicFactoryV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant ROUTE_ADMIN = 0x49bAe4Eb7b7a7567f67A600Ca8752027e9d12Fa3;
    address constant IMPLEMENTATION = 0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    bytes32 constant EVIDENCE = 0x6b70f4f761e22ecca3a35aab6a9ba22eea9dbd038165fe684f63ca9e1a27315f;
    bytes32 constant PONS_CODE_HASH = 0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db;
    bytes32 constant QUOTRON_CODE_HASH = 0xd6082651ea0016d58e52d4478b46b8ef601dce4cd6312f22f572ad39f8b2a094;
    uint256 constant READY_AT = 1790322086;

    function run() external returns (address factoryAddress) {
        require(!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast), "simulation only");
        HoodxHookRegistryV3 registry = HoodxHookRegistryV3(REGISTRY);
        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(POLICY);
        HoodxRouteAdminV3 routeAdmin = HoodxRouteAdminV3(ROUTE_ADMIN);
        require(routeAdmin.owner() == ADMIN && address(routeAdmin.policy()) == POLICY, "admin mismatch");
        require(policy.owner() == ROUTE_ADMIN, "policy owner changed");
        _checkProposal(registry, PONS_HOOK, PONS_CODE_HASH);
        _checkProposal(registry, QUOTRON_HOOK, QUOTRON_CODE_HASH);
        bytes32[] memory ids = new bytes32[](ProportionalWatchlistV3.count());

        // Rehearse the exact post-delay sequence without weakening the live registry delay.
        // vm.warp affects only this disposable fork simulation.
        if (block.timestamp < READY_AT) vm.warp(READY_AT);
        vm.startBroadcast(DEPLOYER);
        registry.activate(PONS_HOOK);
        registry.activate(QUOTRON_HOOK);
        vm.stopBroadcast();
        require(registry.isApprovedHook(PONS_HOOK) && registry.isApprovedHook(QUOTRON_HOOK), "hook activation failed");

        address[] memory tokens = new address[](ids.length);
        bytes[] memory buys = new bytes[](ids.length);
        bytes[] memory sells = new bytes[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            (tokens[i], buys[i], sells[i]) = ProportionalWatchlistV3.routeFor(i);
        }
        vm.startBroadcast(ADMIN);
        for (uint256 start; start < ids.length; start += routeAdmin.MAX_BATCH()) {
            uint256 end = start + routeAdmin.MAX_BATCH();
            if (end > ids.length) end = ids.length;
            address[] memory batchTokens = new address[](end - start);
            bytes[] memory batchBuys = new bytes[](end - start);
            bytes[] memory batchSells = new bytes[](end - start);
            for (uint256 i = start; i < end; ++i) {
                batchTokens[i - start] = tokens[i];
                batchBuys[i - start] = buys[i];
                batchSells[i - start] = sells[i];
            }
            bytes32[] memory batchIds =
                routeAdmin.approveRoutes(batchTokens, batchBuys, batchSells, ProportionalWatchlistV3.evidence());
            for (uint256 i; i < batchIds.length; ++i) ids[start + i] = batchIds[i];
        }
        vm.stopBroadcast();

        vm.startBroadcast(DEPLOYER);
        HoodxAtomicFactoryV3 factory = new HoodxAtomicFactoryV3(ADMIN, ADMIN, IMPLEMENTATION, ids);
        vm.stopBroadcast();
        factoryAddress = address(factory);

        require(factory.owner() == ADMIN && factory.implementation() == IMPLEMENTATION, "factory identity mismatch");
        for (uint256 i; i < ids.length; ++i) {
            (address token,,,) = policy.config(ids[i]);
            require(factory.configIdByToken(token) == ids[i], "route registration mismatch");
        }

        uint16[] memory weights = new uint16[](ids.length);
        for (uint256 i; i < weights.length; ++i) {
            weights[i] = ProportionalWatchlistV3.targetFor(i);
        }
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init({
            curator: ADMIN,
            creator: ADMIN,
            recipient: ADMIN,
            treasury: ADMIN,
            name: "Atomic Rehearsal",
            symbol: "ATOMX",
            creatorFee: 40,
            protocolFee: 10,
            cashBps: 2500,
            firstDeposit: 0.02 ether,
            image: ""
        });
        vm.startBroadcast(ADMIN);
        uint256 gasBefore = gasleft();
        (address rehearsedVault, address rehearsedController) =
            factory.createAtomic("atomicrehearsal", init, ids, weights);
        uint256 creationGas = gasBefore - gasleft();
        vm.stopBroadcast();
        require(HoodxProportionalV3(payable(rehearsedVault)).owner() == rehearsedController, "controller not owner");
        require(
            HoodxRebalanceControllerV3(rehearsedController).curator() == ADMIN
                && address(HoodxRebalanceControllerV3(rehearsedController).vault()) == rehearsedVault,
            "curator identity mismatch"
        );
        console2.log("SIMULATED atomic factory", factoryAddress);
        console2.log("SIMULATED routes", ids.length);
        console2.log("SIMULATED setup transactions", uint256(5));
        console2.log("SIMULATED one-transaction 21-asset creation gas", creationGas);
    }

    function _checkProposal(HoodxHookRegistryV3 registry, address hook, bytes32 codeHash) private view {
        (bytes32 proposedHash, bytes32 evidence, uint256 readyAt) = registry.proposals(hook);
        require(readyAt == READY_AT, "proposal timestamp changed");
        require(proposedHash == codeHash && hook.codehash == codeHash && evidence == EVIDENCE, "proposal changed");
        require(!registry.isApprovedHook(hook), "hook already active");
    }
}
