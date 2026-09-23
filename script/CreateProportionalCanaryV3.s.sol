// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {HoodxProportionalFactoryV3} from "../contracts/v3/HoodxProportionalFactoryV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";

/// @notice Creates an empty disposable 20-asset successor canary. It cannot move canary capital.
contract CreateProportionalCanaryV3 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant FACTORY = 0xb0a89074d2f88207698aC99f39061463eeabeC8a;
    string constant SLUG = "696xcanary";

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        HoodxProportionalFactoryV3 factory = HoodxProportionalFactoryV3(FACTORY);
        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(POLICY);
        require(factory.bySlug(SLUG) == address(0), "canary exists");
        bytes32[] memory ids = new bytes32[](ProportionalWatchlistV3.count());
        uint16[] memory weights = new uint16[](ProportionalWatchlistV3.count());
        for (uint256 i; i < ids.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = ProportionalWatchlistV3.routeFor(i);
            ids[i] = keccak256(abi.encode(token, token.codehash, buy, sell, ProportionalWatchlistV3.evidence()));
            (address admitted,, bytes memory storedBuy, bytes memory storedSell) = policy.config(ids[i]);
            require(admitted == token && keccak256(storedBuy) == keccak256(buy), "buy route changed");
            require(keccak256(storedSell) == keccak256(sell), "sell route changed");
            weights[i] = 375;
        }
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(_stage("successor-canary-create"), "wrong stage");
            require(vm.envBytes32("HOODX_REVIEWED_ROUTES") == ProportionalWatchlistV3.fingerprint(), "route mismatch");
        }
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init({
            curator: CURATOR,
            creator: DEPLOYER,
            recipient: CURATOR,
            treasury: CURATOR,
            name: "696X Successor Canary",
            symbol: "696XC",
            creatorFee: 40,
            protocolFee: 10,
            cashBps: 2500,
            firstDeposit: 0.02 ether,
            image: ""
        });
        vm.startBroadcast(DEPLOYER);
        address vaultAddress = factory.create(SLUG, init, ids, weights);
        vm.stopBroadcast();
        HoodxProportionalV3 vault = HoodxProportionalV3(payable(vaultAddress));
        require(vault.owner() == CURATOR && vault.creator() == DEPLOYER, "roles changed");
        require(vault.creatorRecipient() == CURATOR && vault.treasury() == CURATOR, "recipients changed");
        require(vault.totalSupply() == 0 && address(vault).balance == 0, "canary not empty");
    }

    function _stage(string memory expected) private view returns (bool) {
        return keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256(bytes(expected));
    }
}
