// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3PoolLike} from "../../contracts/boost/BoostTypes.sol";

/// @dev Moves the WETH/USDG pool to an exact price with its own funds (an attacker or a large trader).
contract PoolPusher {
    address immutable pool;

    constructor(address p) {
        pool = p;
    }

    function push(bool wethIn, uint160 limit) external {
        IUniswapV3PoolLike(pool).swap(address(this), wethIn, type(int128).max, limit, "");
    }

    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata) external {
        if (a0 > 0) IERC20(IUniswapV3PoolLike(pool).token0()).transfer(pool, uint256(a0));
        if (a1 > 0) IERC20(IUniswapV3PoolLike(pool).token1()).transfer(pool, uint256(a1));
    }
}
