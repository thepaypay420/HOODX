// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {HoodxFactoryV2} from "../v2/HoodxFactoryV2.sol";

/// @notice Independent factory namespace; no access to existing vaults or user assets.
contract HoodxFactoryV3 is HoodxFactoryV2 {
    constructor(address admin, address treasury, address implementation)
        HoodxFactoryV2(admin, treasury, implementation)
    {}

    function version() external pure returns (uint256) {
        return 3;
    }
}
