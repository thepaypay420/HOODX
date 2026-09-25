// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxRouteAdminV3} from "../contracts/v3/HoodxRouteAdminV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {OfficialVaultCatalogV3} from "./OfficialVaultCatalogV3.sol";

/// @notice Accepts policy ownership or approves one bounded catalog batch.
contract ApproveOfficialVaultCatalogV3 is Script {
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;

    function run() external {
        require(block.chainid == 4663, "wrong network");
        address adminAddress = vm.envAddress("HOODX_ROUTE_ADMIN");
        HoodxRouteAdminV3 routeAdmin = HoodxRouteAdminV3(adminAddress);
        require(routeAdmin.owner() == ADMIN && address(routeAdmin.policy()) == POLICY, "admin mismatch");
        uint256 batch = vm.envUint("HOODX_CATALOG_BATCH");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == OfficialVaultCatalogV3.fingerprint(), "route mismatch");
        }
        vm.startBroadcast(ADMIN);
        if (batch == 99) {
            routeAdmin.acceptPolicyOwnership();
        } else {
            require(batch < 3, "batch out of range");
            uint256 start = batch * 20;
            uint256 end = start + 20;
            if (end > OfficialVaultCatalogV3.count()) end = OfficialVaultCatalogV3.count();
            address[] memory tokens = new address[](end - start);
            bytes[] memory buys = new bytes[](end - start);
            bytes[] memory sells = new bytes[](end - start);
            for (uint256 i = start; i < end; ++i) {
                (tokens[i - start], buys[i - start], sells[i - start]) = OfficialVaultCatalogV3.routeFor(i);
            }
            routeAdmin.approveRoutes(tokens, buys, sells, OfficialVaultCatalogV3.evidence());
        }
        vm.stopBroadcast();
        if (batch == 99) require(HoodxProportionalPolicyV3(POLICY).owner() == adminAddress, "ownership failed");
        console2.log("Completed catalog batch", batch);
    }
}
