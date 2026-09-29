// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxLaunchHunterLaunchV3} from "../contracts/launch/HoodxLaunchHunterLaunchV3.sol";

/// @notice Deploys the exact reviewed HUNTX V3 infrastructure after FEEX is live and fully backed.
contract DeployLaunchHunterV3 is Script {
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    bytes32 internal constant EXECUTOR_HASH = 0x7f0ab91ef78f36e60d01f7b167e227de218e708931ce4b6e823080608a4dc195;

    function run() external returns (HoodxLaunchHunterLaunchV3 launch) {
        require(block.chainid == 4663, "wrong chain");
        address baseIndex = vm.envAddress("HUNTX_BASE_INDEX");
        bytes32 baseHash = vm.envBytes32("HUNTX_BASE_INDEX_HASH");
        uint256 baseAmount = vm.envUint("HUNTX_BASE_SEED_AMOUNT");
        uint256 wethSeed = vm.envUint("HUNTX_WETH_SEED_AMOUNT");
        uint256 riskReference = vm.envUint("HUNTX_RISK_REFERENCE_AMOUNT");
        uint256 initialShares = vm.envUint("HUNTX_INITIAL_SHARES");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("launch-hunter-v3"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
            require(vm.getNonce(DEPLOYER) == vm.envUint("HUNTX_DEPLOYER_NONCE"), "deployer nonce changed");
        }

        console2.log("Reviewed HUNTX V3 build fingerprint");
        console2.logBytes32(buildFingerprint());
        vm.startBroadcast(DEPLOYER);
        launch = new HoodxLaunchHunterLaunchV3(
            baseIndex, EXECUTOR_HASH, baseHash, baseAmount, wethSeed, riskReference, initialShares
        );
        vm.stopBroadcast();
        console2.log("HUNTX V3 launcher", address(launch));
        console2.log("HUNTX V3 policy", address(launch.policy()));
        console2.log("HUNTX V3 vault", address(launch.vault()));
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(type(HoodxLaunchHunterLaunchV3).creationCode);
    }
}
