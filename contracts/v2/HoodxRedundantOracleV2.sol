// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IV2Oracle} from "./Types.sol";

/// @notice Two immutable, code-pinned independent references for an existing V2 asset.
/// If both references are healthy they must agree; if one loses its own depth/history
/// checks, the other can preserve exits without weakening either source's threshold.
contract HoodxRedundantOracleV2 is IV2Oracle {
    uint256 private constant BPS = 10_000;
    address public immutable token;
    address public immutable primary;
    address public immutable secondary;
    bytes32 public immutable primaryCodeHash;
    bytes32 public immutable secondaryCodeHash;
    uint16 public immutable maxDivergenceBps;
    error InvalidReference();

    constructor(address token_, address primary_, address secondary_, uint16 maxDivergenceBps_) {
        if (
            token_.code.length == 0 || primary_.code.length == 0 || secondary_.code.length == 0
                || primary_ == secondary_ || maxDivergenceBps_ == 0 || maxDivergenceBps_ > 500
        ) revert InvalidReference();
        token = token_;
        primary = primary_;
        secondary = secondary_;
        primaryCodeHash = primary_.codehash;
        secondaryCodeHash = secondary_.codehash;
        maxDivergenceBps = maxDivergenceBps_;
        (bool first,) = _read(primary_, 1 ether);
        (bool second,) = _read(secondary_, 1 ether);
        if (!first && !second) revert InvalidReference();
    }

    function value(address asset, uint256 amount) external view returns (uint256) {
        if (asset != token) revert InvalidReference();
        if (amount == 0) return 0;
        if (primary.codehash != primaryCodeHash || secondary.codehash != secondaryCodeHash) revert InvalidReference();
        (bool first, uint256 a) = _read(primary, amount);
        (bool second, uint256 b) = _read(secondary, amount);
        if (!first && !second) revert InvalidReference();
        if (!first) return b;
        if (!second) return a;
        uint256 high = Math.max(a, b);
        uint256 low = Math.min(a, b);
        if (Math.mulDiv(high - low, BPS, high) > maxDivergenceBps) revert InvalidReference();
        return low + (high - low) / 2;
    }

    function _read(address source, uint256 amount) private view returns (bool ok, uint256 result) {
        bytes memory data;
        (ok, data) = source.staticcall(abi.encodeCall(IV2Oracle.value, (token, amount)));
        if (!ok || data.length != 32) return (false, 0);
        result = abi.decode(data, (uint256));
        ok = result != 0;
    }
}
