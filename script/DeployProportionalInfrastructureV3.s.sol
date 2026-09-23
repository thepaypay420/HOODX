// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxHookRegistryV3} from "../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxExecutorV3} from "../contracts/v3/HoodxExecutorV3.sol";
import {HoodxRoutingV3} from "../contracts/v3/HoodxRoutingV3.sol";
import {HoodxFeeModelV3} from "../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {HoodxProportionalFactoryV3} from "../contracts/v3/HoodxProportionalFactoryV3.sol";

/// @notice Deploys successor infrastructure and starts the two hook-review timers.
/// It cannot activate hooks, approve routes, create a vault, or deploy production.
contract DeployProportionalInfrastructureV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant TREASURY = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant V4_MANAGER = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant V4_STATE = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant POSITION_MANAGER = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;
    address constant V2_FACTORY = 0x42024fCFdB4F3089Dd619A0cEF0Cd24E7b841C18;
    address constant QUOTRON_ROUTER = 0x5a86828Efd322bfb16d93cFeD16EE9BC14940D7F;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    bytes32 constant SIMULATION_EVIDENCE = keccak256("SIMULATION_ONLY_NOT_LIVE_REVIEW");

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        bytes32 evidence = vm.envOr("HOODX_SUCCESSOR_EVIDENCE", SIMULATION_EVIDENCE);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string(""))))
                    == keccak256("successor-canary-infrastructure"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
            require(evidence != bytes32(0) && evidence != SIMULATION_EVIDENCE, "live evidence missing");
        }

        console2.log("Reviewed build fingerprint");
        console2.logBytes32(buildFingerprint());
        console2.log("Deployer balance (wei)", DEPLOYER.balance);
        vm.startBroadcast(DEPLOYER);
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(DEPLOYER);
        registry.propose(PONS_HOOK, evidence);
        registry.propose(QUOTRON_HOOK, evidence);
        HoodxExecutorV3 executor = new HoodxExecutorV3(
            WETH, ROUTER, PERMIT2, V4_MANAGER, V4_STATE, POSITION_MANAGER, address(registry)
        );
        HoodxRoutingV3 routing =
            new HoodxRoutingV3(address(executor), V2_FACTORY, address(registry), QUOTRON_ROUTER, QUOTRON_HOOK);
        HoodxFeeModelV3 fees = new HoodxFeeModelV3(address(routing), QUOTRON_HOOK, PONS_HOOK);
        HoodxProportionalPolicyV3 policy = new HoodxProportionalPolicyV3(DEPLOYER, address(routing));
        HoodxProportionalV3 implementation = new HoodxProportionalV3(address(policy), address(fees));
        HoodxProportionalFactoryV3 factory =
            new HoodxProportionalFactoryV3(DEPLOYER, TREASURY, address(implementation));
        vm.stopBroadcast();

        require(registry.owner() == DEPLOYER && policy.owner() == DEPLOYER, "owner mismatch");
        require(factory.owner() == DEPLOYER && factory.treasury() == TREASURY, "factory roles mismatch");
        require(!registry.isApprovedHook(PONS_HOOK) && !registry.isApprovedHook(QUOTRON_HOOK), "delay bypassed");
        require(address(implementation).code.length <= 24_576, "implementation too large");
        console2.log("Registry", address(registry));
        console2.log("Executor", address(executor));
        console2.log("Routing", address(routing));
        console2.log("Fees", address(fees));
        console2.log("Policy", address(policy));
        console2.log("Implementation", address(implementation));
        console2.log("Factory", address(factory));
        console2.log("Hook readyAt", block.timestamp + registry.DELAY());
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxHookRegistryV3).creationCode),
                keccak256(type(HoodxExecutorV3).creationCode),
                keccak256(type(HoodxRoutingV3).creationCode),
                keccak256(type(HoodxFeeModelV3).creationCode),
                keccak256(type(HoodxProportionalPolicyV3).creationCode),
                keccak256(type(HoodxProportionalV3).creationCode),
                keccak256(type(HoodxProportionalFactoryV3).creationCode)
            )
        );
    }
}
