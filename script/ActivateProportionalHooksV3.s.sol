// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxHookRegistryV3} from "../contracts/v3/HoodxHookRegistryV3.sol";

/// @notice Activates only the two reviewed hooks after their on-chain delay.
contract ActivateProportionalHooksV3 is Script {
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    bytes32 constant EVIDENCE = 0x6b70f4f761e22ecca3a35aab6a9ba22eea9dbd038165fe684f63ca9e1a27315f;
    bytes32 constant PONS_CODE_HASH = 0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db;
    bytes32 constant QUOTRON_CODE_HASH = 0xd6082651ea0016d58e52d4478b46b8ef601dce4cd6312f22f572ad39f8b2a094;
    uint256 constant READY_AT = 1790322086;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        HoodxHookRegistryV3 registry = HoodxHookRegistryV3(REGISTRY);
        _check(registry, PONS_HOOK, PONS_CODE_HASH);
        _check(registry, QUOTRON_HOOK, QUOTRON_CODE_HASH);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("successor-canary-hooks"), "wrong stage");
        }
        vm.startBroadcast();
        registry.activate(PONS_HOOK);
        registry.activate(QUOTRON_HOOK);
        vm.stopBroadcast();
        require(registry.isApprovedHook(PONS_HOOK) && registry.isApprovedHook(QUOTRON_HOOK), "activation failed");
    }

    function _check(HoodxHookRegistryV3 registry, address hook, bytes32 codeHash) private view {
        (bytes32 proposedHash, bytes32 evidence, uint256 readyAt) = registry.proposals(hook);
        require(block.timestamp >= READY_AT && readyAt == READY_AT, "delay incomplete");
        require(proposedHash == codeHash && hook.codehash == codeHash && evidence == EVIDENCE, "proposal changed");
        require(!registry.isApprovedHook(hook), "already active");
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
