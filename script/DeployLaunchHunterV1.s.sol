// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxLaunchHunterLaunchV1} from "../contracts/launch/HoodxLaunchHunterLaunchV1.sol";

interface ILaunchExecutorIdentity {
    function weth() external view returns (address);
    function hookRegistry() external view returns (address);
}

interface ILaunchHookRegistry {
    function isApprovedHook(address) external view returns (bool);
}

/// @notice Deploys the closed Launch Hunter policy and WETH-backed canary. Funding is a separate curator action.
contract DeployLaunchHunterV1 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant EXECUTOR = 0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    bytes32 constant EXECUTOR_HASH = 0x7f0ab91ef78f36e60d01f7b167e227de218e708931ce4b6e823080608a4dc195;
    uint256 constant SEED = 0.073973 ether;
    uint256 constant SHARES = 200 ether;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        require(EXECUTOR.codehash == EXECUTOR_HASH, "executor changed");
        require(ILaunchExecutorIdentity(EXECUTOR).weth() == WETH, "weth changed");
        require(ILaunchExecutorIdentity(EXECUTOR).hookRegistry() == REGISTRY, "registry changed");
        require(ILaunchHookRegistry(REGISTRY).isApprovedHook(PONS_HOOK), "PONS hook inactive");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("launch-hunter-v1"),
                "wrong stage"
            );
        }

        vm.startBroadcast(DEPLOYER);
        HoodxLaunchHunterLaunchV1 launcher = new HoodxLaunchHunterLaunchV1();
        vm.stopBroadcast();
        console2.log("Launch Hunter launcher", address(launcher));
        console2.log("Launch Hunter policy", address(launcher.policy()));
        console2.log("Launch Hunter vault", address(launcher.vault()));
    }
}
