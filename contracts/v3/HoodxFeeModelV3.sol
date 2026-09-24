// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {V2Hop} from "../v2/Types.sol";

interface IQuotronFeeV3 {
    function currentFeeBps(address account) external view returns (uint256);
}

interface IPonsFeeV3 {
    struct Launch {
        bool registered;
        bool direction;
        address token;
        address quote;
        address creator;
        address buybackRecipient;
        address protocolRecipient;
        uint16 creatorTax;
        uint16 protocolShare;
        uint16 burn;
        uint16 hookFee;
        uint16 impact;
        bool buyback;
    }
    function launches(bytes32 pool) external view returns (Launch memory);
}

/// @notice Disclosed execution costs, separate from the vault's 3% price-movement protection.
/// Only explicitly understood fee mechanisms are accepted. This is never a valuation oracle.
contract HoodxFeeModelV3 {
    address public immutable executor;
    address public immutable quotronHook;
    address public immutable ponsHook;
    bytes32 public immutable quotronHash;
    bytes32 public immutable ponsHash;
    error UnsupportedFee();

    constructor(address executor_, address quotronHook_, address ponsHook_) {
        if (executor_.code.length == 0) revert UnsupportedFee();
        executor = executor_;
        quotronHook = quotronHook_;
        ponsHook = ponsHook_;
        quotronHash = quotronHook_.codehash;
        ponsHash = ponsHook_.codehash;
    }

    function factor(bytes memory route) external view returns (uint256 retained) {
        V2Hop[] memory h = abi.decode(route, (V2Hop[]));
        if (h.length == 0 || h.length > 4) revert UnsupportedFee();
        retained = 1e18;
        for (uint256 i; i < h.length; i++) {
            uint256 hop = 1e18;
            if (h[i].kind == 2) {
                hop = 997e15;
            } else if (h[i].kind == 3) {
                if (h[i].fee >= 1e6) revert UnsupportedFee();
                hop = 1e18 - uint256(h[i].fee) * 1e12;
            } else if (h[i].kind == 4) {
                if (h[i].key.fee >= 1e6) revert UnsupportedFee();
                hop = 1e18 - uint256(h[i].key.fee) * 1e12;
                if (h[i].key.hooks != address(0)) {
                    if (h[i].key.hooks != ponsHook || ponsHook.code.length == 0 || ponsHook.codehash != ponsHash) {
                        revert UnsupportedFee();
                    }
                    IPonsFeeV3.Launch memory p = IPonsFeeV3(ponsHook).launches(keccak256(abi.encode(h[i].key)));
                    uint256 cost = uint256(p.creatorTax) + p.hookFee;
                    if (!p.registered || cost > 2000) revert UnsupportedFee();
                    hop = Math.mulDiv(hop, 10000 - cost, 10000);
                }
            } else if (h[i].kind == 5) {
                if (h.length != 1 || quotronHook.code.length == 0 || quotronHook.codehash != quotronHash) {
                    revert UnsupportedFee();
                }
                uint256 fee = IQuotronFeeV3(quotronHook).currentFeeBps(executor);
                if (fee > 2000) revert UnsupportedFee();
                hop = (10000 - fee) * 1e14;
            } else if (h[i].kind == 6) {
                if (h.length != 1 || h[i].hookData.length != 32) revert UnsupportedFee();
                uint256 tax = abi.decode(h[i].hookData, (uint256));
                if (tax > 2000) revert UnsupportedFee();
                // Direct pair route: one taxed asset transfer per side, plus the 0.3% pair fee.
                hop = Math.mulDiv(997e15, 10000 - tax, 10000);
            } else {
                revert UnsupportedFee();
            }
            retained = Math.mulDiv(retained, hop, 1e18);
        }
        if (retained < 800e15) revert UnsupportedFee();
    }

    function transferFactor(bytes memory route) external pure returns (uint256) {
        V2Hop[] memory h = abi.decode(route, (V2Hop[]));
        if (h.length == 1 && h[0].kind == 6) {
            if (h[0].hookData.length != 32) revert UnsupportedFee();
            uint256 tax = abi.decode(h[0].hookData, (uint256));
            if (tax > 2000) revert UnsupportedFee();
            return (10000 - tax) * 1e14;
        }
        return 1e18;
    }
}
