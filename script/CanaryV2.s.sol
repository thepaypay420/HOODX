// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {v2BuildFingerprint} from "./V2Build.sol";
import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxOfficialFactoryV2} from "../contracts/v2/HoodxBootstrapV2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Strict normal-exit canary. Emergency recovery is separate and never counts as passing.
contract CanaryV2 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(vm.envOr("HOODX_REVIEWED_BUILD", bytes32(0)) == v2BuildFingerprint(), "reviewed build mismatch");
        }
        HoodxOfficialFactoryV2 factory = HoodxOfficialFactoryV2(vm.envAddress("HOODX_CANARY_FACTORY"));
        require(factory.owner() == CURATOR, "factory role mismatch");
        _cycle(HoodxIndexV2(payable(factory.bySlug("696x"))), 0.08 ether);
        _cycle(HoodxIndexV2(payable(factory.bySlug("faangx"))), 0.02 ether);
    }

    function _cycle(HoodxIndexV2 v, uint256 capital) private {
        require(
            v.owner() == CURATOR && v.creator() == CURATOR && v.creatorRecipient() == CURATOR
                && v.treasury() == CURATOR,
            "role mismatch"
        );
        require(v.totalSupply() == 0 && v.totalAssets() == 0, "canary not empty");
        uint256 floor = v.previewDeposit(capital) * 99 / 100;
        vm.startBroadcast(DEPLOYER);
        uint256 shares = v.deposit{value: capital}(floor, block.timestamp + 600);
        vm.stopBroadcast();
        address[] memory tokens = v.constituents();
        for (uint256 i; i < tokens.length; ++i) {
            if (v.targetBps(tokens[i]) > 0) {
                require(IERC20(tokens[i]).balanceOf(address(v)) > 0, "intended buy deferred");
            }
        }
        vm.startBroadcast(DEPLOYER);
        v.withdraw(shares / 2, capital * 45 / 100, block.timestamp + 600);
        v.withdraw(v.balanceOf(DEPLOYER), capital * 45 / 100, block.timestamp + 600);
        vm.stopBroadcast();
        require(v.balanceOf(DEPLOYER) == 0 && v.totalSupply() == 0 && v.totalAssets() == 0, "canary exit incomplete");
        require(address(v).balance == 0 && IERC20(v.weth()).balanceOf(address(v)) == 0, "cash dust");
        for (uint256 i; i < tokens.length; ++i) {
            require(IERC20(tokens[i]).balanceOf(address(v)) == 0, "constituent dust");
        }
    }
}
