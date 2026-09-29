// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxFeeMachineLaunchV1} from "../contracts/liquidity/HoodxFeeMachineLaunchV1.sol";

/// @notice Deploys the exact reviewed Fee Machine pilot. Funding is a separate curator transaction.
contract DeployFeeMachineV1 is Script {
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address internal constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function run() external returns (HoodxFeeMachineLaunchV1 launch) {
        require(block.chainid == 4663, "wrong chain");
        uint256 seedWeth = vm.envUint("HOODX_FEE_MACHINE_SEED_WEI");
        uint256 initialShares = vm.envOr("HOODX_FEE_MACHINE_INITIAL_SHARES", uint256(200 ether));
        int24[4] memory centers = [
            int24(vm.envInt("HOODX_FEE_MACHINE_CENTER_0")),
            int24(vm.envInt("HOODX_FEE_MACHINE_CENTER_1")),
            int24(vm.envInt("HOODX_FEE_MACHINE_CENTER_2")),
            int24(vm.envInt("HOODX_FEE_MACHINE_CENTER_3"))
        ];

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("fee-machine-pilot"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
        }

        console2.log("Reviewed build fingerprint");
        console2.logBytes32(buildFingerprint());
        console2.log("Seed WETH (wei)", seedWeth);
        vm.startBroadcast(DEPLOYER);
        launch = new HoodxFeeMachineLaunchV1(CURATOR, seedWeth, initialShares, centers);
        vm.stopBroadcast();

        require(launch.curator() == CURATOR, "curator mismatch");
        require(launch.seedWeth() == seedWeth && launch.initialShares() == initialShares, "terms mismatch");
        require(launch.controller().curator() == CURATOR, "controller mismatch");
        require(launch.index().owner() == address(launch.controller()), "index owner mismatch");
        require(!launch.bootstrapped() && !launch.index().bootstrapped(), "unexpected bootstrap");
        console2.log("Launcher", address(launch));
        console2.log("Controller", address(launch.controller()));
        console2.log("Index", address(launch.index()));
        for (uint256 i; i < 4; ++i) {
            console2.log("Sleeve", launch.sleeves(i));
        }
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(type(HoodxFeeMachineLaunchV1).creationCode);
    }
}
