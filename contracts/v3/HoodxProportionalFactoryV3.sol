// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {HoodxFactoryV2} from "../v2/HoodxFactoryV2.sol";

interface IProportionalIdentity {
    function accountingMode() external pure returns (bytes32);
}

/// @notice Separate factory namespace for opt-in proportional vaults.
contract HoodxProportionalFactoryV3 is HoodxFactoryV2 {
    constructor(address admin, address treasury_, address implementation_)
        HoodxFactoryV2(admin, treasury_, implementation_)
    {
        if (IProportionalIdentity(implementation_).accountingMode() != keccak256("HOODX_PROPORTIONAL_V1")) {
            revert Invalid();
        }
    }
}
