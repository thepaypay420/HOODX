// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {UniTwap, IUniV3Pool} from "../UniTwap.sol";
import {IV2Oracle} from "../v2/Types.sol";

interface IClIdentityV3 {
    function getPool(address, address, int24) external view returns (address);
    function isPool(address) external view returns (bool);
}

interface IClObservationV3 {
    function factory() external view returns (address);
    function tickSpacing() external view returns (int24);
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, bool);
    function observations(uint256) external view returns (uint32, int56, uint160, bool);
}

/// @notice Candidate adapter for reviewed fixed-implementation CL clones, not arbitrary V3-like pools.
/// Source provenance, economic depth and the quote oracle require separate qualification.
contract HoodxClTwapV3 is IV2Oracle {
    address public immutable token;
    address public immutable quote;
    address public immutable pool;
    address public immutable implementation;
    address public immutable quoteOracle;
    bytes32 public immutable implementationHash;
    bytes32 public immutable poolHash;
    bytes32 public immutable quoteOracleHash;
    uint32 public immutable window;
    uint32 public immutable maxAge;
    uint128 public immutable minLiquidity;
    error InvalidReference();

    constructor(
        address factory,
        address pool_,
        address implementation_,
        address token_,
        address quoteOracle_,
        uint32 window_,
        uint32 maxAge_,
        uint128 depth
    ) {
        if (
            window_ < 1800 || maxAge_ == 0 || maxAge_ > window_ || depth == 0 || implementation_.code.length == 0
                || quoteOracle_.code.length == 0
        ) revert InvalidReference();
        // Pin the exact EIP-1167 delegate target, not just an upgradeable proxy's runtime.
        bytes32 expected = keccak256(
            abi.encodePacked(hex"363d3d373d3d3d363d73", implementation_, hex"5af43d82803e903d91602b57fd5bf3")
        );
        if (pool_.codehash != expected) revert InvalidReference();
        address a = IUniV3Pool(pool_).token0();
        address b = IUniV3Pool(pool_).token1();
        if (a == b || token_.code.length == 0 || (token_ != a && token_ != b)) revert InvalidReference();
        if (
            IClObservationV3(pool_).factory() != factory || !IClIdentityV3(factory).isPool(pool_)
                || IClIdentityV3(factory).getPool(a, b, IClObservationV3(pool_).tickSpacing()) != pool_
        ) revert InvalidReference();
        token = token_;
        quote = token_ == a ? b : a;
        pool = pool_;
        implementation = implementation_;
        quoteOracle = quoteOracle_;
        implementationHash = implementation_.codehash;
        poolHash = expected;
        quoteOracleHash = quoteOracle_.codehash;
        window = window_;
        maxAge = maxAge_;
        minLiquidity = depth;
    }

    function value(address asset, uint256 amount) external view returns (uint256) {
        if (
            asset != token || pool.codehash != poolHash || implementation.codehash != implementationHash
                || quoteOracle.codehash != quoteOracleHash
        ) revert InvalidReference();
        (,, uint16 index, uint16 count,,) = IClObservationV3(pool).slot0();
        (uint32 at,,, bool initialized) = IClObservationV3(pool).observations(index);
        uint32 age;
        unchecked {
            age = uint32(block.timestamp) - at;
        }
        if (count == 0 || !initialized || age > maxAge || IUniV3Pool(pool).liquidity() < minLiquidity) {
            revert InvalidReference();
        }
        uint32[] memory times = new uint32[](2);
        times[0] = window;
        (, uint160[] memory acc) = IUniV3Pool(pool).observe(times);
        if (acc.length != 2) revert InvalidReference();
        uint160 delta;
        unchecked {
            delta = acc[1] - acc[0];
        }
        if (delta == 0 || (uint256(window) << 128) / delta < minLiquidity) revert InvalidReference();
        if (amount == 0) {
            IV2Oracle(quoteOracle).value(quote, 0);
            return 0;
        }
        uint256 out = IV2Oracle(quoteOracle).value(quote, UniTwap.quotePerBase(pool, token, quote, amount, window));
        if (out == 0) revert InvalidReference();
        return out;
    }
}
