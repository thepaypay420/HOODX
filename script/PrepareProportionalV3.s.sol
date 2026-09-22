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

/// @notice Read-only infrastructure rehearsal. Deliberately rejects --broadcast.
/// No investor vault is created and no existing vault is called.
contract PrepareProportionalV3 is Script {
    function run() external {
        require(!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast), "simulation only");
        require(block.chainid == 4663, "wrong chain");
        address deployer = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
        address treasury = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
        address pons = address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"));
        address qhook = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        console2.log("Current deployer balance (wei)", deployer.balance);
        console2.log("Chain", block.chainid);
        console2.log("Fork block", block.number);
        // This evidence label cannot be mistaken for live review approval.
        bytes32 evidence = keccak256("SIMULATION_ONLY_NOT_LIVE_REVIEW");
        vm.startBroadcast(deployer);
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(deployer);
        registry.propose(pons, evidence);
        registry.propose(qhook, evidence);
        HoodxExecutorV3 executor = new HoodxExecutorV3(
            address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")),
            address(bytes20(hex"8876789976decbfcbbbe364623c63652db8c0904")),
            address(bytes20(hex"000000000022d473030f116ddee9f6b43ac78ba3")),
            address(bytes20(hex"1f7d7550b1b028f7571e69a784071f0205fd2efa")),
            address(bytes20(hex"f3334192d15450cdd385c8b70e03f9a6bd9e673b")),
            address(bytes20(hex"8bceaa40b9acdfaedf85adf4ff01f5ad6517937f")),
            address(registry)
        );
        HoodxRoutingV3 routing = new HoodxRoutingV3(
            address(executor),
            address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")),
            address(registry),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            qhook
        );
        HoodxFeeModelV3 fees = new HoodxFeeModelV3(address(routing), qhook, pons);
        HoodxProportionalPolicyV3 policy = new HoodxProportionalPolicyV3(deployer, address(routing));
        HoodxProportionalV3 implementation = new HoodxProportionalV3(address(policy), address(fees));
        HoodxProportionalFactoryV3 factory = new HoodxProportionalFactoryV3(deployer, treasury, address(implementation));
        vm.stopBroadcast();
        console2.log("SIMULATED registry", address(registry));
        console2.log("SIMULATED routing", address(routing));
        console2.log("SIMULATED policy", address(policy));
        console2.log("SIMULATED implementation", address(implementation));
        console2.log("SIMULATED factory", address(factory));
        console2.log("Required hook delay seconds", registry.DELAY());
        require(!registry.isApprovedHook(pons) && !registry.isApprovedHook(qhook), "delay bypassed");
        require(address(implementation).code.length <= 24576, "implementation too large");
    }
}
