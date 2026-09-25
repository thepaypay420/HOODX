// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";

/// @notice Starts the policy's two-step ownership transfer to the reviewed batch administrator.
contract TransferOfficialRoutePolicyV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;

    function run() external {
        require(block.chainid == 4663, "wrong network");
        address routeAdmin = vm.envAddress("HOODX_ROUTE_ADMIN");
        require(routeAdmin.code.length != 0, "missing route admin");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("official-policy-transfer"), "wrong stage");
        }
        vm.startBroadcast(DEPLOYER);
        HoodxProportionalPolicyV3(POLICY).transferOwnership(routeAdmin);
        vm.stopBroadcast();
        require(HoodxProportionalPolicyV3(POLICY).pendingOwner() == routeAdmin, "nomination failed");
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
