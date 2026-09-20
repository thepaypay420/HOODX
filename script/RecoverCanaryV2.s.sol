// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";

/// @notice Explicit recovery for a failed canary. It never marks production release ready.
contract RecoverCanaryV2 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
        }
        HoodxIndexV2 v = HoodxIndexV2(payable(vm.envAddress("HOODX_CANARY_VAULT")));
        uint256 shares = v.balanceOf(DEPLOYER);
        require(shares > 0, "no deployer shares");
        vm.startBroadcast(DEPLOYER);
        v.emergencyRedeemInKind(shares, DEPLOYER);
        vm.stopBroadcast();
        require(v.balanceOf(DEPLOYER) == 0, "shares remain");
        // Token balances/claims must be accounted for before any final ETH sweep.
    }
}
