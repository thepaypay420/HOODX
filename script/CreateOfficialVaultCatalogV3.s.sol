// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {HoodxAtomicFactoryV3} from "../contracts/v3/HoodxAtomicFactoryV3.sol";
import {OfficialVaultCatalogV3} from "./OfficialVaultCatalogV3.sol";

/// @notice Creates all ten empty official vault/controller pairs in one transaction.
contract CreateOfficialVaultCatalogV3 is Script {
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function run() external returns (address[] memory vaults, address[] memory controllers) {
        address factoryAddress = vm.envAddress("HOODX_OFFICIAL_FACTORY");
        require(block.chainid == 4663 && factoryAddress.code.length != 0, "wrong network");
        HoodxAtomicFactoryV3 factory = HoodxAtomicFactoryV3(factoryAddress);
        require(factory.owner() == ADMIN && factory.treasury() == ADMIN, "factory identity");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == OfficialVaultCatalogV3.fingerprint(), "route mismatch");
        }

        uint256 length = OfficialVaultCatalogV3.vaultCount();
        string[] memory slugs = new string[](length);
        HoodxIndexV2.Init[] memory params = new HoodxIndexV2.Init[](length);
        bytes32[][] memory configs = new bytes32[][](length);
        uint16[][] memory weights = new uint16[][](length);
        for (uint256 i; i < length; ++i) {
            (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory targetWeights) = OfficialVaultCatalogV3.vault(i);
            slugs[i] = slug;
            weights[i] = targetWeights;
            configs[i] = new bytes32[](indexes.length);
            for (uint256 j; j < indexes.length; ++j) {
                (address token, bytes memory buy, bytes memory sell) = OfficialVaultCatalogV3.routeFor(indexes[j]);
                bytes32 id = keccak256(abi.encode(token, token.codehash, buy, sell, OfficialVaultCatalogV3.evidence()));
                require(factory.configIdByToken(token) == id, "route not registered");
                configs[i][j] = id;
            }
            params[i] = HoodxIndexV2.Init(ADMIN, ADMIN, ADMIN, ADMIN, _name(i), symbol, 40, 10, cashBps, 0.02 ether, "");
        }

        vm.startBroadcast(ADMIN);
        (vaults, controllers) = factory.createAtomicBatch(slugs, params, configs, weights);
        vm.stopBroadcast();
        for (uint256 i; i < length; ++i) {
            require(factory.bySlug(slugs[i]) == vaults[i], "vault missing");
            console2.log(slugs[i], vaults[i]);
            console2.log("controller", controllers[i]);
        }
    }

    function _name(uint256 i) private pure returns (string memory) {
        if (i == 0) return "On-chain Finance";
        if (i == 1) return "Silicon Stack";
        if (i == 2) return "AI Stack";
        if (i == 3) return "Retail Pulse";
        if (i == 4) return "Health Frontier";
        if (i == 5) return "Cloud Layer";
        if (i == 6) return "Real Assets";
        if (i == 7) return "Core and Carry";
        if (i == 8) return "Frontier Systems";
        return "Consumer Icons";
    }
}
