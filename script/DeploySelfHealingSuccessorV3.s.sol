// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {HoodxAtomicFactoryV3} from "../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxRebalanceControllerV3} from "../contracts/v3/HoodxRebalanceControllerV3.sol";
import {HoodxHookRegistryV3} from "../contracts/v3/HoodxHookRegistryV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Deploys the self-healing future-vault implementation and atomic creation factory.
/// The already reviewed live routing and fee infrastructure is reused. No vault is created or funded.
contract DeploySelfHealingSuccessorV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant TREASURY = ADMIN;
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant ROUTING = 0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE;
    address constant FEE_MODEL = 0xE274bc33C5dCD3Ee1dd603a3e08509E46c2B3dFb;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    bytes32 constant HOOK_EVIDENCE = 0x6b70f4f761e22ecca3a35aab6a9ba22eea9dbd038165fe684f63ca9e1a27315f;
    bytes32 constant PONS_CODE_HASH = 0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db;
    bytes32 constant QUOTRON_CODE_HASH = 0xd6082651ea0016d58e52d4478b46b8ef601dce4cd6312f22f572ad39f8b2a094;

    function run() external returns (address policyAddress, address implementationAddress, address factoryAddress) {
        require(block.chainid == 4663, "wrong chain");
        require(REGISTRY.code.length != 0 && ROUTING.code.length != 0 && FEE_MODEL.code.length != 0, "missing reviewed dependencies");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string(""))))
                    == keccak256("self-healing-successor-v3"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
        }

        console2.log("Reviewed successor build");
        console2.logBytes32(buildFingerprint());
        vm.startBroadcast(DEPLOYER);
        _activateHook(HoodxHookRegistryV3(REGISTRY), PONS_HOOK, PONS_CODE_HASH);
        _activateHook(HoodxHookRegistryV3(REGISTRY), QUOTRON_HOOK, QUOTRON_CODE_HASH);
        HoodxProportionalPolicyV3 policy = new HoodxProportionalPolicyV3(DEPLOYER, ROUTING);
        bytes32[] memory ids = new bytes32[](ProportionalWatchlistV3.count());
        for (uint256 i; i < ids.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = ProportionalWatchlistV3.routeFor(i);
            ids[i] = policy.approveRoute(token, buy, sell, ProportionalWatchlistV3.evidence());
        }
        HoodxProportionalV3 implementation = new HoodxProportionalV3(address(policy), FEE_MODEL);
        HoodxAtomicFactoryV3 factory = new HoodxAtomicFactoryV3(ADMIN, TREASURY, address(implementation), ids);
        policy.transferOwnership(ADMIN);
        vm.stopBroadcast();

        policyAddress = address(policy);
        implementationAddress = address(implementation);
        factoryAddress = address(factory);
        require(policy.pendingOwner() == ADMIN && factory.owner() == ADMIN, "owner mismatch");
        require(factory.implementation() == implementationAddress, "implementation mismatch");
        require(address(factory.routePolicy()) == policyAddress, "policy mismatch");
        require(implementationAddress.code.length <= 24_576, "implementation too large");
        for (uint256 i; i < ids.length; ++i) {
            (address token,,,) = policy.config(ids[i]);
            require(factory.configIdByToken(token) == ids[i], "registration mismatch");
            bytes32[] memory active = policy.configsFor(token);
            require(active.length == 1 && active[0] == ids[i], "active route mismatch");
        }
        console2.log("Policy", policyAddress);
        console2.log("Implementation", implementationAddress);
        console2.log("Atomic factory", factoryAddress);
    }

    function _activateHook(HoodxHookRegistryV3 registry, address hook, bytes32 expectedHash) private {
        if (registry.isApprovedHook(hook)) {
            require(hook.codehash == expectedHash, "approved hook changed");
            return;
        }
        (bytes32 proposedHash, bytes32 evidence, uint256 readyAt) = registry.proposals(hook);
        require(
            proposedHash == expectedHash && hook.codehash == expectedHash && evidence == HOOK_EVIDENCE
                && readyAt != 0 && block.timestamp >= readyAt,
            "hook review incomplete"
        );
        registry.activate(hook);
        require(registry.isApprovedHook(hook), "hook activation failed");
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxProportionalPolicyV3).creationCode),
                keccak256(type(HoodxProportionalV3).creationCode),
                keccak256(type(HoodxAtomicFactoryV3).creationCode),
                keccak256(type(HoodxRebalanceControllerV3).creationCode),
                ProportionalWatchlistV3.fingerprint(),
                ADMIN,
                TREASURY,
                REGISTRY,
                ROUTING,
                FEE_MODEL,
                PONS_CODE_HASH,
                QUOTRON_CODE_HASH,
                HOOK_EVIDENCE
            )
        );
    }
}
