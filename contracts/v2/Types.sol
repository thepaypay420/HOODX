// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct V2PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct V2Hop {
    uint8 kind; // 3 or 4
    address tokenIn; // native currency only for V4; normalized to WETH between hops
    address tokenOut;
    uint24 fee;
    V2PoolKey key;
    uint256 minHopPriceX36;
    bytes hookData;
}

interface IV2Oracle {
    function value(address token, uint256 amount) external view returns (uint256);
}

interface IV2Executor {
    function weth() external view returns (address);
    function validateRoute(bytes calldata route, address tokenIn, address tokenOut) external view;
    function execute(
        address tokenIn,
        address tokenOut,
        uint256 amount,
        uint256 minOut,
        bytes calldata route,
        uint256 deadline
    ) external returns (uint256);
}

interface IV2Policy {
    function executor() external view returns (address);
    function config(bytes32 id)
        external
        view
        returns (address token, address oracle, bytes memory buy, bytes memory sell);
}

interface IV2Weth {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
