// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IUniV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface IPosm {
    function poolKeys(bytes25 poolId)
        external
        view
        returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @title UniTwap — Uniswap V3 TWAP → WETH per 1e18 token
/// @notice Tick-to-sqrtPrice uses the published 1.0001^(2^n) bit table
///         (Uniswap v3 whitepaper §6.2). No owner price feed.
library UniTwap {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    error BadPool();
    error Unpriced();

    function consult(address pool, uint32 secondsAgo) internal view returns (int24 meanTick) {
        if (secondsAgo == 0) revert Unpriced();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = secondsAgo;
        secondsAgos[1] = 0;
        (int56[] memory ticks, ) = IUniV3Pool(pool).observe(secondsAgos);
        int56 delta = ticks[1] - ticks[0];
        int56 span = int56(uint56(secondsAgo));
        meanTick = int24(delta / span);
        if (delta < 0 && (delta % span != 0)) meanTick--;
    }

    /// @dev WETH wad for 1e18 `token`. Pool must be token/WETH.
    function priceWethWad(address pool, address token, address weth, uint32 secondsAgo)
        internal
        view
        returns (uint256)
    {
        address t0 = IUniV3Pool(pool).token0();
        address t1 = IUniV3Pool(pool).token1();
        if (!((token == t0 && weth == t1) || (token == t1 && weth == t0))) revert BadPool();
        int24 tick = consult(pool, secondsAgo);
        uint256 px = quoteAtTick(tick, 1e18, token == t0);
        if (px == 0) revert Unpriced();
        return px;
    }

    /// @dev V4 has no observe(). Spot tick from StateView. Native ETH counts as WETH.
    function priceWethWadV4(
        address stateView,
        bytes32 poolId,
        address token,
        address c0,
        address c1,
        address weth
    ) internal view returns (uint256) {
        address other = token == c0 ? c1 : (token == c1 ? c0 : address(0));
        if (other != weth && other != address(0)) revert BadPool();
        if (token != c0 && token != c1) revert BadPool();
        (, int24 tick, , ) = IStateView(stateView).getSlot0(poolId);
        uint256 px = quoteAtTick(tick, 1e18, token == c0);
        if (px == 0) revert Unpriced();
        return px;
    }

    function quoteAtTick(int24 tick, uint256 baseAmount, bool token0In) internal pure returns (uint256) {
        uint256 sqrtP = uint256(getSqrtRatioAtTick(tick));
        if (token0In) {
            return mulDiv(mulDiv(baseAmount, sqrtP, 1 << 96), sqrtP, 1 << 96);
        }
        return mulDiv(mulDiv(baseAmount, 1 << 96, sqrtP), 1 << 96, sqrtP);
    }

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
            if (absTick > uint256(uint24(MAX_TICK))) revert Unpriced();

            uint256 ratio = absTick & 0x1 != 0
                ? 0xfffcb933bd6fad37aa2d162d1a594001
                : 0x100000000000000000000000000000000;
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

            if (tick > 0) ratio = type(uint256).max / ratio;
            sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
        }
    }

    /// @dev 512-bit mulDiv (solmate-style).
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 z) {
        unchecked {
            if (denominator == 0) revert Unpriced();
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                return prod0 / denominator;
            }
            if (prod1 >= denominator) revert Unpriced();

            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, denominator)
            }
            assembly {
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = denominator & (0 - denominator);
            assembly {
                denominator := div(denominator, twos)
            }
            assembly {
                prod0 := div(prod0, twos)
            }
            assembly {
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            z = prod0 * inv;
        }
    }
}
