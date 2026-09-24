// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxAtomicFactoryV3} from "../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxRebalanceControllerV3} from "../contracts/v3/HoodxRebalanceControllerV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Deploys the successor factory with every reviewed watchlist route registered.
/// @dev Every user creation through this factory creates both the vault and its controller in the
///      same transaction. This script does not create, fund, or migrate a vault.
contract DeployAtomicFactoryV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant TREASURY = ADMIN;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant IMPLEMENTATION = 0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7;

    function run() external returns (address factoryAddress) {
        require(block.chainid == 4663, "wrong chain");
        require(POLICY.code.length != 0 && IMPLEMENTATION.code.length != 0, "missing reviewed infrastructure");
        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(POLICY);
        bytes32[] memory ids = new bytes32[](ProportionalWatchlistV3.count());
        for (uint256 i; i < ids.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = ProportionalWatchlistV3.routeFor(i);
            ids[i] = keccak256(abi.encode(token, token.codehash, buy, sell, ProportionalWatchlistV3.evidence()));
            (address admitted,, bytes memory storedBuy, bytes memory storedSell) = policy.config(ids[i]);
            require(
                admitted == token && keccak256(storedBuy) == keccak256(buy) && keccak256(storedSell) == keccak256(sell),
                "route identity mismatch"
            );
        }

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("atomic-successor-factory"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
        }

        console2.log("Reviewed atomic factory build fingerprint");
        console2.logBytes32(buildFingerprint());
        vm.startBroadcast(DEPLOYER);
        HoodxAtomicFactoryV3 factory = new HoodxAtomicFactoryV3(ADMIN, TREASURY, IMPLEMENTATION, ids);
        vm.stopBroadcast();
        factoryAddress = address(factory);

        require(factory.owner() == ADMIN && factory.treasury() == TREASURY, "factory roles mismatch");
        require(
            factory.implementation() == IMPLEMENTATION && address(factory.routePolicy()) == POLICY, "identity mismatch"
        );
        for (uint256 i; i < ids.length; ++i) {
            (address token,,,) = policy.config(ids[i]);
            require(factory.configIdByToken(token) == ids[i], "route registration mismatch");
        }
        console2.log("Atomic factory", factoryAddress);
        console2.log("Registered routes", ids.length);
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxAtomicFactoryV3).creationCode),
                keccak256(type(HoodxRebalanceControllerV3).creationCode),
                ProportionalWatchlistV3.fingerprint(),
                ADMIN,
                TREASURY,
                POLICY,
                IMPLEMENTATION
            )
        );
    }
}
