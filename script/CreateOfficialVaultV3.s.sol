// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {HoodxAtomicFactoryV3} from "../contracts/v3/HoodxAtomicFactoryV3.sol";
import {OfficialVaultCatalogV3} from "./OfficialVaultCatalogV3.sol";

/// @notice Creates one empty official vault and its atomic controller in one transaction.
contract CreateOfficialVaultV3 is Script {
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function run() external returns (address vaultAddress, address controllerAddress) {
        address factoryAddress = vm.envAddress("HOODX_OFFICIAL_FACTORY");
        require(block.chainid == 4663 && factoryAddress.code.length != 0, "wrong network");
        HoodxAtomicFactoryV3 factory = HoodxAtomicFactoryV3(factoryAddress);
        uint256 index = vm.envUint("HOODX_VAULT_INDEX");
        require(index < OfficialVaultCatalogV3.vaultCount(), "vault index");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == OfficialVaultCatalogV3.fingerprint(), "route mismatch");
        }
        (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory weights) = OfficialVaultCatalogV3.vault(index);
        bytes32[] memory ids = new bytes32[](indexes.length);
        for (uint256 i; i < indexes.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = OfficialVaultCatalogV3.routeFor(indexes[i]);
            ids[i] = keccak256(abi.encode(token, token.codehash, buy, sell, OfficialVaultCatalogV3.evidence()));
            require(factory.configIdByToken(token) == ids[i], "route not registered");
        }
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init({
            curator: ADMIN,
            creator: ADMIN,
            recipient: ADMIN,
            treasury: ADMIN,
            name: _name(index),
            symbol: symbol,
            creatorFee: 40,
            protocolFee: 10,
            cashBps: cashBps,
            firstDeposit: 0.02 ether,
            image: ""
        });
        vm.startBroadcast(ADMIN);
        (vaultAddress, controllerAddress) = factory.createAtomic(slug, init, ids, weights);
        vm.stopBroadcast();
        require(factory.bySlug(slug) == vaultAddress, "vault missing");
        console2.log("Official vault", vaultAddress);
        console2.log("Atomic controller", controllerAddress);
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
