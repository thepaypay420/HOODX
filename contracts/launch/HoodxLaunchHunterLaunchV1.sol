// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HoodxPolicyV2} from "../v2/HoodxPolicyV2.sol";
import {HoodxLaunchHunterV1} from "./HoodxLaunchHunterV1.sol";

interface ILaunchExecutorIdentityV1 {
    function weth() external view returns (address);
    function hookRegistry() external view returns (address);
}

interface ILaunchHookRegistryV1 {
    function isApprovedHook(address) external view returns (bool);
}

/// @notice One-purpose deployer for the exact reviewed Launch Hunter canary.
/// @dev The launcher receives no ownership and has no callable administrative function.
contract HoodxLaunchHunterLaunchV1 {
    address public constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address public constant EXECUTOR = 0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750;
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address public constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    bytes32 public constant EXECUTOR_HASH = 0x7f0ab91ef78f36e60d01f7b167e227de218e708931ce4b6e823080608a4dc195;
    uint256 public constant SEED = 0.073973 ether;
    uint256 public constant SHARES = 200 ether;

    HoodxPolicyV2 public immutable policy;
    HoodxLaunchHunterV1 public immutable vault;

    constructor() {
        require(block.chainid == 4663, "wrong chain");
        require(EXECUTOR.codehash == EXECUTOR_HASH, "executor changed");
        require(ILaunchExecutorIdentityV1(EXECUTOR).weth() == WETH, "weth changed");
        require(ILaunchExecutorIdentityV1(EXECUTOR).hookRegistry() == REGISTRY, "registry changed");
        require(ILaunchHookRegistryV1(REGISTRY).isApprovedHook(PONS_HOOK), "PONS hook inactive");
        policy = new HoodxPolicyV2(CURATOR, EXECUTOR);
        vault = new HoodxLaunchHunterV1(address(policy), CURATOR, SEED, SHARES);
        require(policy.owner() == CURATOR && vault.curator() == CURATOR, "authority mismatch");
    }
}
