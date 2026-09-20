// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {UniTwap, IUniV3Pool} from "../UniTwap.sol";
import {IV2Oracle} from "./Types.sol";

interface IV3IdentityV2 {
    function getPool(address, address, uint24) external view returns (address);
}

/// @notice Immutable V3 reference separate from execution. Depth thresholds require economic review.
contract HoodxTwapV2 is IV2Oracle {
    address public immutable token;
    address public immutable quote;
    address public immutable weth;
    address public immutable pool;
    address public immutable bridge;
    uint32 public immutable window;
    uint128 public immutable minLiquidity;
    uint128 public immutable minBridgeLiquidity;
    error InvalidReference();

    constructor(
        address factory,
        address token_,
        address weth_,
        address pool_,
        address bridge_,
        uint32 window_,
        uint128 depth,
        uint128 bridgeDepth
    ) {
        if (token_ == weth_ || token_.code.length == 0 || weth_.code.length == 0 || window_ < 1800 || depth == 0) {
            revert InvalidReference();
        }
        IUniV3Pool p = IUniV3Pool(pool_);
        address t0 = p.token0();
        address t1 = p.token1();
        if (token_ != t0 && token_ != t1) revert InvalidReference();
        address q = token_ == t0 ? t1 : t0;
        if (IV3IdentityV2(factory).getPool(t0, t1, p.fee()) != pool_) revert InvalidReference();
        if (q != weth_) {
            IUniV3Pool b = IUniV3Pool(bridge_);
            address b0 = b.token0();
            address b1 = b.token1();
            if (
                !((q == b0 && weth_ == b1) || (q == b1 && weth_ == b0))
                    || IV3IdentityV2(factory).getPool(b0, b1, b.fee()) != bridge_ || bridgeDepth == 0
            ) revert InvalidReference();
        } else if (bridge_ != address(0)) {
            revert InvalidReference();
        }
        token = token_;
        quote = q;
        weth = weth_;
        pool = pool_;
        bridge = bridge_;
        window = window_;
        minLiquidity = depth;
        minBridgeLiquidity = bridgeDepth;
    }

    function value(address asset, uint256 amount) external view returns (uint256) {
        if (asset != token) revert InvalidReference();
        _checkDepth(pool, minLiquidity);
        if (amount == 0) return 0;
        uint256 out = UniTwap.quotePerBase(pool, token, quote, amount, window);
        if (quote == weth) return out;
        _checkDepth(bridge, minBridgeLiquidity);
        return UniTwap.quotePerBase(bridge, quote, weth, out, window);
    }

    // A momentary liquidity top-up cannot satisfy the historical depth requirement.
    function _checkDepth(address referencePool, uint128 minimum) private view {
        if (IUniV3Pool(referencePool).liquidity() < minimum) revert InvalidReference();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        (, uint160[] memory accumulators) = IUniV3Pool(referencePool).observe(secondsAgos);
        if (accumulators.length != 2) revert InvalidReference();
        uint160 delta;
        unchecked {
            delta = accumulators[1] - accumulators[0];
        }
        if (delta == 0) revert InvalidReference();
        uint256 harmonicLiquidity = (uint256(window) << 128) / delta;
        if (harmonicLiquidity < minimum) revert InvalidReference();
    }
}
