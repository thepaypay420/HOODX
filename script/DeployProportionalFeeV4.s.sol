// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxFeeModelV4} from "../contracts/v3/HoodxFeeModelV4.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {HoodxProportionalFactoryV3} from "../contracts/v3/HoodxProportionalFactoryV3.sol";

interface IPolicyIdentityV4 { function executor() external view returns (address); }

/// @notice Deploys only the immutable V4 fee model and replacement canary factory.
/// It reuses the reviewed live registry, executor, routing, and policy. It does
/// not propose/activate a hook, approve a route, create a vault, or seed one.
contract DeployProportionalFeeV4 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant TREASURY = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant ROUTING = 0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    address constant DOPPLER_INITIALIZER = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    address constant REHYPE_HOOK = 0x9982538F41f2ae29ddb9d3D9307010052984FDbB;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        require(IPolicyIdentityV4(POLICY).executor() == ROUTING, "live policy changed");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string(""))))
                    == keccak256("reviewed-doppler-fee-v4"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
        }

        console2.log("Reviewed build fingerprint");
        console2.logBytes32(buildFingerprint());
        vm.startBroadcast(DEPLOYER);
        HoodxFeeModelV4 fees = new HoodxFeeModelV4(
            ROUTING, QUOTRON_HOOK, PONS_HOOK, POOL_MANAGER, DOPPLER_INITIALIZER, REHYPE_HOOK
        );
        HoodxProportionalV3 implementation = new HoodxProportionalV3(POLICY, address(fees));
        HoodxProportionalFactoryV3 factory =
            new HoodxProportionalFactoryV3(DEPLOYER, TREASURY, address(implementation));
        vm.stopBroadcast();

        require(factory.owner() == DEPLOYER && factory.treasury() == TREASURY, "factory roles mismatch");
        require(factory.implementation() == address(implementation), "implementation mismatch");
        require(address(implementation).code.length <= 24_576, "implementation too large");
        console2.log("Fees V4", address(fees));
        console2.log("Implementation", address(implementation));
        console2.log("Factory", address(factory));
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxFeeModelV4).creationCode),
                keccak256(type(HoodxProportionalV3).creationCode),
                keccak256(type(HoodxProportionalFactoryV3).creationCode)
            )
        );
    }
}
