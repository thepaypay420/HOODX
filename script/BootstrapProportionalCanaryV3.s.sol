// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {ProportionalCanaryGuardV3} from "./ProportionalCanaryGuardV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Bootstraps only the exact empty successor canary with exactly 0.02 ETH.
contract BootstrapProportionalCanaryV3 is Script, ProportionalCanaryGuardV3 {
    uint256 constant CAPITAL = 0.02 ether;

    function run() external {
        HoodxProportionalV3 vault = _verifiedCanary();
        require(vault.totalSupply() == 0 && address(vault).balance == 0, "canary not empty");
        require(vault.balanceOf(DEPLOYER) == 0 && !vault.paused(), "unexpected state");
        require(vault.planNonce() == ProportionalWatchlistV3.count() + 1, "canary was managed");
        require(vault.freeBalance(vault.weth()) == 0 && vault.reserved(vault.weth()) == 0, "cash already present");
        address[] memory tokens = vault.constituents();
        for (uint256 i; i < tokens.length; ++i) {
            require(vault.freeBalance(tokens[i]) == 0 && vault.reserved(tokens[i]) == 0, "asset already present");
        }
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("successor-canary-bootstrap"), "wrong stage");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == ProportionalWatchlistV3.fingerprint(), "route mismatch");
        }
        uint256[] memory budgets = new uint256[](ProportionalWatchlistV3.count());
        uint256 budget = (CAPITAL * 9950 / 10000) * 375 / 10000;
        for (uint256 i; i < budgets.length; ++i) {
            budgets[i] = budget;
        }
        vm.deal(address(this), CAPITAL);
        uint256[] memory floors = _quoteBuys(vault, budgets, CAPITAL);
        require(floors.length == budgets.length, "quote length");
        for (uint256 i; i < floors.length; ++i) {
            floors[i] = floors[i] * 9700 / 10000;
            require(floors[i] != 0, "zero floor");
        }
        uint256 nonce = vault.planNonce();
        vm.startBroadcast(DEPLOYER);
        vault.bootstrap{value: CAPITAL}(floors, nonce, block.timestamp + 180);
        vm.stopBroadcast();
        require(vault.totalSupply() != 0 && vault.balanceOf(DEPLOYER) == vault.totalSupply(), "bootstrap incomplete");
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
