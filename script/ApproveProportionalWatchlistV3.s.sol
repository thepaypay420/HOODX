// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxHookRegistryV3} from "../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Approves only the pinned 20-asset route manifest. It cannot create or fund a vault.
contract ApproveProportionalWatchlistV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        HoodxHookRegistryV3 registry = HoodxHookRegistryV3(REGISTRY);
        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(POLICY);
        require(policy.owner() == DEPLOYER, "policy owner changed");
        require(registry.isApprovedHook(PONS_HOOK) && registry.isApprovedHook(QUOTRON_HOOK), "hooks inactive");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("successor-canary-routes"), "wrong stage");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == ProportionalWatchlistV3.fingerprint(), "route mismatch");
        }
        vm.startBroadcast(DEPLOYER);
        for (uint256 i; i < ProportionalWatchlistV3.count(); ++i) {
            (address token, bytes memory buy, bytes memory sell) = ProportionalWatchlistV3.routeFor(i);
            bytes32 id = policy.approveRoute(token, buy, sell, ProportionalWatchlistV3.evidence());
            require(id == routeId(token, buy, sell), "route id mismatch");
        }
        vm.stopBroadcast();
    }

    function routeId(address token, bytes memory buy, bytes memory sell) public view returns (bytes32) {
        return keccak256(abi.encode(token, token.codehash, buy, sell, ProportionalWatchlistV3.evidence()));
    }

    function routeFingerprint() external pure returns (bytes32) {
        return ProportionalWatchlistV3.fingerprint();
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
