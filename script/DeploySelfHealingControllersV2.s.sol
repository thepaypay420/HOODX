// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxSelfHealingControllerV2} from "../contracts/v2/HoodxSelfHealingControllerV2.sol";

interface ILiveVaultIdentityV2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function policy() external view returns (address);
}

/// @notice Deploys replacement controllers for the two immutable official vaults.
/// @dev Deployment alone has no authority and cannot move assets. Curator wallet calls complete the
/// two-step ownership handoff and explicitly approve recovery configurations afterward.
contract DeploySelfHealingControllersV2 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant POLICY = 0x8e36fB11545Fc1683f35a079d3F9f1A715DbEC70;
    address constant VAULT_696X = 0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292;
    address constant VAULT_FAANGX = 0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0;
    address constant CURRENT_696X_CONTROLLER = 0x5A732854bD6A4EEa6e5bA9ED9D897bC089f58767;
    address constant CURRENT_FAANGX_CONTROLLER = 0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb;

    function run() external returns (address controller696x, address controllerFaangx) {
        require(block.chainid == 4663, "wrong chain");
        _checkVault(VAULT_696X, CURRENT_696X_CONTROLLER);
        _checkVault(VAULT_FAANGX, CURRENT_FAANGX_CONTROLLER);

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string(""))))
                    == keccak256("self-healing-v2-controllers"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
        }

        console2.log("Reviewed V2 self-healing build");
        console2.logBytes32(buildFingerprint());
        vm.startBroadcast(DEPLOYER);
        controller696x = address(new HoodxSelfHealingControllerV2(VAULT_696X, CURATOR));
        controllerFaangx = address(new HoodxSelfHealingControllerV2(VAULT_FAANGX, CURATOR));
        vm.stopBroadcast();

        require(HoodxSelfHealingControllerV2(controller696x).curator() == CURATOR, "696 curator mismatch");
        require(HoodxSelfHealingControllerV2(controllerFaangx).curator() == CURATOR, "faang curator mismatch");
        require(address(HoodxSelfHealingControllerV2(controller696x).vault()) == VAULT_696X, "696 vault mismatch");
        require(
            address(HoodxSelfHealingControllerV2(controllerFaangx).vault()) == VAULT_FAANGX,
            "faang vault mismatch"
        );
        console2.log("696X controller", controller696x);
        console2.log("FAANGX controller", controllerFaangx);
    }

    function _checkVault(address vault, address expectedOwner) private view {
        ILiveVaultIdentityV2 target = ILiveVaultIdentityV2(vault);
        require(vault.code.length != 0 && target.policy() == POLICY, "vault identity mismatch");
        require(target.owner() == expectedOwner && target.pendingOwner() == address(0), "ownership changed");
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxSelfHealingControllerV2).creationCode),
                CURATOR,
                POLICY,
                VAULT_696X,
                VAULT_FAANGX,
                CURRENT_696X_CONTROLLER,
                CURRENT_FAANGX_CONTROLLER
            )
        );
    }
}
