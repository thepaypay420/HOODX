// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {HoodxIndexV2} from "../v2/HoodxIndexV2.sol";

/// @notice Separate opt-in deployment; reuses proven accounting and in-kind exits.
contract HoodxIndexV3 is HoodxIndexV2 {
    constructor(address successorPolicy) HoodxIndexV2(successorPolicy) {}

    function version() external pure returns (uint256) {
        return 3;
    }
}
