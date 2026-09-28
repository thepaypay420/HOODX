// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface IUniswapV3PoolResearch {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function liquidity() external view returns (uint128);
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool unlocked);
}

/// @notice Read-only evidence for the first HOODX LP-index candidate set.
/// These tests intentionally do not transact with or modify the live pools.
contract LiquidityIndexPoolsForkTest is Test {
    uint256 internal constant REVIEW_BLOCK = 74_572_742;
    address internal constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant CASHCAT = 0x020bfC650A365f8BB26819deAAbF3E21291018b4;
    address internal constant AI = 0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18;
    address internal constant PONS = 0x39dBED3a2bd333467115dE45665cC57F813C4571;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;

    address internal constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address internal constant CASHCAT_WETH = 0xd42A491087a15E5afd51FEb3606066Cc152d2b09;
    address internal constant WETH_AI = 0xc4a21f9d6485FC5893DD4A491B320a83DAF4Da1D;
    address internal constant WETH_PONS = 0xEd50bDeeA8aDC232f159486192a4157281D722ff;
    address internal constant WETH_SPY = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com"));
        vm.createSelectFork(rpc, REVIEW_BLOCK);
        assertEq(block.chainid, 4663);
    }

    function testCandidatePoolsHaveReviewedIdentityAndLiveLiquidity() public view {
        _assertPool(WETH_USDG, WETH, USDG, 100, 1);
        _assertPool(CASHCAT_WETH, CASHCAT, WETH, 3_000, 60);
        _assertPool(WETH_AI, WETH, AI, 10_000, 200);
        _assertPool(WETH_PONS, WETH, PONS, 3_000, 60);
        _assertPool(WETH_SPY, WETH, SPY, 500, 10);
    }

    function _assertPool(address poolAddress, address token0, address token1, uint24 fee, int24 tickSpacing)
        internal
        view
    {
        assertGt(poolAddress.code.length, 0, "pool has no code");
        IUniswapV3PoolResearch pool = IUniswapV3PoolResearch(poolAddress);
        assertEq(pool.factory(), FACTORY, "unexpected factory");
        assertEq(pool.token0(), token0, "unexpected token0");
        assertEq(pool.token1(), token1, "unexpected token1");
        assertEq(pool.fee(), fee, "unexpected fee tier");
        assertEq(pool.tickSpacing(), tickSpacing, "unexpected tick spacing");
        assertGt(pool.liquidity(), 0, "no active liquidity");
        (uint160 sqrtPriceX96,,,,,, bool unlocked) = pool.slot0();
        assertGt(sqrtPriceX96, 0, "pool is uninitialized");
        assertTrue(unlocked, "pool is locked");
    }
}
