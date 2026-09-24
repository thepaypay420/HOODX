// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HoodxProportionalFactoryV3} from "../contracts/v3/HoodxProportionalFactoryV3.sol";
import {HoodxProportionalPolicyV3} from "../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxProportionalV3} from "../contracts/v3/HoodxProportionalV3.sol";
import {ProportionalWatchlistV3} from "./ProportionalWatchlistV3.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Shared identity and route checks for disposable successor-canary capital steps.
abstract contract ProportionalCanaryGuardV3 {
    Vm private constant GUARD_VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address internal constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address internal constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address internal constant FEE_MODEL = 0xE274bc33C5dCD3Ee1dd603a3e08509E46c2B3dFb;
    address internal constant EXECUTOR = 0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750;
    address internal constant IMPLEMENTATION = 0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7;
    address internal constant FACTORY = 0xb0a89074d2f88207698aC99f39061463eeabeC8a;
    string internal constant SLUG = "696xcanary";

    function _verifiedCanary() internal view returns (HoodxProportionalV3 vault) {
        require(block.chainid == 4663, "wrong chain");
        HoodxProportionalFactoryV3 factory = HoodxProportionalFactoryV3(FACTORY);
        require(factory.implementation() == IMPLEMENTATION, "implementation changed");
        address candidate = factory.bySlug(SLUG);
        require(candidate != address(0), "canary missing");
        bytes memory runtime =
            abi.encodePacked(hex"363d3d373d3d3d363d73", bytes20(IMPLEMENTATION), hex"5af43d82803e903d91602b57fd5bf3");
        require(candidate.codehash == keccak256(runtime), "clone changed");
        vault = HoodxProportionalV3(payable(candidate));
        require(vault.accountingMode() == keccak256("HOODX_PROPORTIONAL_V1"), "accounting changed");
        require(address(vault.policy()) == POLICY && address(vault.feeModel()) == FEE_MODEL, "dependencies changed");
        require(address(vault.executor()) == EXECUTOR, "executor changed");
        require(vault.owner() == CURATOR && vault.creator() == DEPLOYER, "roles changed");
        require(vault.creatorRecipient() == CURATOR && vault.treasury() == CURATOR, "recipients changed");
        require(vault.creatorFeeBps() == 40 && vault.protocolFeeBps() == 10, "fees changed");
        require(vault.cashTargetBps() == 2500 && vault.minFirstDeposit() == 0.02 ether, "limits changed");
        address[] memory tokens = vault.constituents();
        require(tokens.length == ProportionalWatchlistV3.count(), "basket changed");
        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(POLICY);
        for (uint256 i; i < tokens.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = ProportionalWatchlistV3.routeFor(i);
            bytes32 id = keccak256(abi.encode(token, token.codehash, buy, sell, ProportionalWatchlistV3.evidence()));
            require(tokens[i] == token && vault.configId(token) == id, "config changed");
            require(vault.targetBps(token) == 375, "target changed");
            (address admitted,, bytes memory storedBuy, bytes memory storedSell) = policy.config(id);
            require(admitted == token && keccak256(storedBuy) == keccak256(buy), "buy route changed");
            require(keccak256(storedSell) == keccak256(sell), "sell route changed");
        }
    }

    function _quoteBuys(HoodxProportionalV3 vault, uint256[] memory budgets, uint256 funding)
        internal
        returns (uint256[] memory outputs)
    {
        (bool ok, bytes memory reason) = address(vault).call{value: funding}(abi.encodeCall(vault.quoteBuys, (budgets)));
        require(
            !ok && reason.length >= 4 && bytes4(reason) == HoodxProportionalV3.BuyQuote.selector, "buy quote failed"
        );
        outputs = abi.decode(_payload(reason), (uint256[]));
    }

    function _quoteWithdrawal(HoodxProportionalV3 vault, address holder, uint256 shares)
        internal
        returns (uint256 cash, uint256[] memory outputs)
    {
        GUARD_VM.prank(holder);
        (bool ok, bytes memory reason) = address(vault).call(abi.encodeCall(vault.quoteWithdrawal, (shares)));
        require(
            !ok && reason.length >= 4 && bytes4(reason) == HoodxProportionalV3.WithdrawalQuote.selector,
            "withdraw quote failed"
        );
        (cash, outputs) = abi.decode(_payload(reason), (uint256, uint256[]));
    }

    function _payload(bytes memory reason) private pure returns (bytes memory data) {
        data = new bytes(reason.length - 4);
        for (uint256 i; i < data.length; ++i) {
            data[i] = reason[i + 4];
        }
    }
}
