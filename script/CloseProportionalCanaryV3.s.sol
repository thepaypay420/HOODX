// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {ProportionalCanaryGuardV3} from "./ProportionalCanaryGuardV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Closes the deployer's position only after every participant share has been recovered.
contract CloseProportionalCanaryV3 is Script, ProportionalCanaryGuardV3 {
    function run() external {
        HoodxProportionalV3 vault = _verifiedCanary();
        uint256 shares = vault.balanceOf(DEPLOYER);
        require(shares != 0 && shares == vault.totalSupply(), "participant shares remain");
        require(vault.paused() && vault.planNonce() == ProportionalWatchlistV3.count() + 2, "recovery stage missing");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("successor-canary-close"), "wrong stage");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == ProportionalWatchlistV3.fingerprint(), "route mismatch");
        }
        (uint256 cash, uint256[] memory outputs) = _quoteWithdrawal(vault, DEPLOYER, shares);
        require(outputs.length == ProportionalWatchlistV3.count(), "quote length");
        uint256 minimum = cash;
        for (uint256 i; i < outputs.length; ++i) {
            outputs[i] = outputs[i] * 9700 / 10000;
            require(outputs[i] != 0, "zero floor");
            minimum += outputs[i];
        }
        uint256 nonce = vault.planNonce();
        vm.startBroadcast(DEPLOYER);
        vault.withdraw(shares, minimum, outputs, nonce, block.timestamp + 180);
        vm.stopBroadcast();
        require(vault.totalSupply() == 0 && vault.freeBalance(vault.weth()) == 0, "close incomplete");
        address[] memory tokens = vault.constituents();
        for (uint256 i; i < tokens.length; ++i) {
            require(vault.freeBalance(tokens[i]) == 0, "asset remains");
        }
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
