// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxRebalanceControllerV2} from "../contracts/v2/HoodxRebalanceControllerV2.sol";
import {HoodxRebalanceControllerV3} from "../contracts/v3/HoodxRebalanceControllerV3.sol";

/// @notice Deploys one non-custodial atomic controller for a reviewed vault.
/// @dev Deployment alone grants no authority. The current curator must separately nominate the
///      printed controller and then call activate() from the same curator wallet.
contract DeployRebalanceController is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;

    function run() external returns (address controller) {
        require(block.chainid == 4663, "wrong chain");
        address vault = vm.envAddress("HOODX_CONTROLLER_VAULT");
        address curator = vm.envAddress("HOODX_CONTROLLER_CURATOR");
        uint256 version = vm.envUint("HOODX_CONTROLLER_VERSION");
        require(vault.code.length != 0 && curator != address(0), "invalid configuration");
        require(version == 2 || version == 3, "unsupported vault version");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string(""))))
                    == keccak256("atomic-rebalance-controller"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
        }

        console2.log("Reviewed controller build fingerprint");
        console2.logBytes32(buildFingerprint());
        console2.log("Vault", vault);
        console2.log("Curator", curator);
        console2.log("Version", version);
        vm.startBroadcast(DEPLOYER);
        if (version == 2) controller = address(new HoodxRebalanceControllerV2(vault, curator));
        else controller = address(new HoodxRebalanceControllerV3(vault, curator));
        vm.stopBroadcast();

        require(controller.code.length != 0, "controller deployment failed");
        if (version == 2) {
            HoodxRebalanceControllerV2 deployed = HoodxRebalanceControllerV2(controller);
            require(address(deployed.vault()) == vault && deployed.curator() == curator, "identity mismatch");
        } else {
            HoodxRebalanceControllerV3 deployed = HoodxRebalanceControllerV3(controller);
            require(address(deployed.vault()) == vault && deployed.curator() == curator, "identity mismatch");
        }
        console2.log("Controller", controller);
        console2.log("Authority inactive until curator completes both ownership steps");
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxRebalanceControllerV2).creationCode),
                keccak256(type(HoodxRebalanceControllerV3).creationCode)
            )
        );
    }
}
