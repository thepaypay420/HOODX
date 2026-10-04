// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal external interfaces used by the HOODX Boosted ETH vault (Robinhood Chain deployments).

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

interface IMorphoBlue {
    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, bytes memory data) external;
    function withdrawCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, address receiver) external;
    function borrow(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256 assetsBorrowed, uint256 sharesBorrowed);
    function repay(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256 assetsRepaid, uint256 sharesRepaid);
    function accrueInterest(MarketParams memory marketParams) external;
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
    function idToMarketParams(bytes32 id)
        external
        view
        returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv);
}

struct MorphoMarket {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

interface IMorphoIrm {
    function borrowRateView(MarketParams memory marketParams, MorphoMarket memory market) external view returns (uint256);
}

interface IMorphoFlashLoanCallback {
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
}

/// @dev Morpho oracle: price of 1 collateral unit in loan units, scaled by 1e36 (adjusted for decimals).
interface IMorphoOracle {
    function price() external view returns (uint256);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @dev What the vault needs from the signal engine.
interface IBoostSignal {
    function target() external view returns (uint256 leverage);
    function isFresh() external view returns (bool);
    function cap() external view returns (uint256);
    function lastHour() external view returns (uint256);
}
