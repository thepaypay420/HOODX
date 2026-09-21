// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {HoodxTwapV2} from "../v2/HoodxTwapV2.sol";
import {IV2Oracle} from "../v2/Types.sol";

interface IObservationAgeV3 {
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
    function observations(uint256 index) external view returns (uint32, int56, uint160, bool);
}

/// @notice Adds source activity freshness to an independently reviewed V3 TWAP reference.
/// A recent observation alone is not proof of trading; liquidity operations can write observations.
contract HoodxFreshTwapV3 is IV2Oracle {
    HoodxTwapV2 public immutable referenceOracle;
    bytes32 public immutable referenceCodeHash;
    uint32 public immutable maxObservationAge;
    error StaleReference();

    constructor(address reference_, uint32 maxAge) {
        if (reference_.code.length == 0 || maxAge == 0) revert StaleReference();
        referenceOracle = HoodxTwapV2(reference_);
        if (maxAge > referenceOracle.window()) revert StaleReference();
        referenceCodeHash = reference_.codehash;
        maxObservationAge = maxAge;
    }

    function value(address token, uint256 amount) external view returns (uint256) {
        if (address(referenceOracle).codehash != referenceCodeHash) revert StaleReference();
        _fresh(referenceOracle.pool());
        address bridge = referenceOracle.bridge();
        if (bridge != address(0)) _fresh(bridge);
        return referenceOracle.value(token, amount);
    }

    function _fresh(address pool) private view {
        (,, uint16 index, uint16 count,,,) = IObservationAgeV3(pool).slot0();
        if (count == 0) revert StaleReference();
        (uint32 at,,, bool initialized) = IObservationAgeV3(pool).observations(index);
        uint32 age;
        unchecked {
            age = uint32(block.timestamp) - at;
        }
        if (!initialized || age > maxObservationAge) revert StaleReference();
    }
}
