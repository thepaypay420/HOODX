// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxRouteAdminV3} from "../contracts/v3/HoodxRouteAdminV3.sol";

/// @notice Deploys the assetless batch administrator used for reviewed official routes.
contract DeployOfficialRouteAdminV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;

    function run() external returns (address adminAddress) {
        require(block.chainid == 4663 && POLICY.code.length != 0, "wrong network");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("official-route-admin-deploy"), "wrong stage");
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "build mismatch");
        }
        vm.startBroadcast(DEPLOYER);
        HoodxRouteAdminV3 routeAdmin = new HoodxRouteAdminV3(ADMIN, POLICY);
        vm.stopBroadcast();
        require(routeAdmin.owner() == ADMIN && address(routeAdmin.policy()) == POLICY, "identity mismatch");
        adminAddress = address(routeAdmin);
        console2.log("Official route admin", adminAddress);
        console2.logBytes32(buildFingerprint());
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(type(HoodxRouteAdminV3).creationCode), ADMIN, POLICY));
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
