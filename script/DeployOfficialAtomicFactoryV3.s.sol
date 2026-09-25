// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxAtomicFactoryV3} from "../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {OfficialVaultCatalogV3} from "./OfficialVaultCatalogV3.sol";

/// @notice Deploys the atomic creation factory with every reviewed official route pinned.
contract DeployOfficialAtomicFactoryV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant IMPLEMENTATION = 0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7;

    function run() external returns (address factoryAddress) {
        require(block.chainid == 4663 && POLICY.code.length != 0 && IMPLEMENTATION.code.length != 0, "wrong network");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("official-atomic-factory"), "wrong stage");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == OfficialVaultCatalogV3.fingerprint(), "route mismatch");
        }
        bytes32[] memory ids = new bytes32[](OfficialVaultCatalogV3.count());
        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(POLICY);
        for (uint256 i; i < ids.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = OfficialVaultCatalogV3.routeFor(i);
            ids[i] = keccak256(abi.encode(token, token.codehash, buy, sell, OfficialVaultCatalogV3.evidence()));
            (address stored,, bytes memory storedBuy, bytes memory storedSell) = policy.config(ids[i]);
            require(stored == token && keccak256(storedBuy) == keccak256(buy) && keccak256(storedSell) == keccak256(sell), "route not approved");
        }
        vm.startBroadcast(DEPLOYER);
        HoodxAtomicFactoryV3 factory = new HoodxAtomicFactoryV3(ADMIN, ADMIN, IMPLEMENTATION, ids);
        vm.stopBroadcast();
        require(factory.owner() == ADMIN && factory.treasury() == ADMIN, "roles mismatch");
        require(factory.implementation() == IMPLEMENTATION && address(factory.routePolicy()) == POLICY, "identity mismatch");
        factoryAddress = address(factory);
        console2.log("Official atomic factory", factoryAddress);
        console2.logBytes32(OfficialVaultCatalogV3.fingerprint());
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
