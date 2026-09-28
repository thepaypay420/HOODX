// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxLiquiditySleeveV1} from "../../contracts/liquidity/HoodxLiquiditySleeveV1.sol";
import {HoodxLiquidityIndexV1} from "../../contracts/liquidity/HoodxLiquidityIndexV1.sol";
import {HoodxLiquidityControllerV1} from "../../contracts/liquidity/HoodxLiquidityControllerV1.sol";
import {IUniswapV3PoolLike} from "../../contracts/liquidity/UniswapV3Types.sol";

/// @notice Pinned-fork lifecycle evidence against the canonical Robinhood Uniswap V3 manager.
contract LiquiditySleeveForkTest is Test {
    uint256 internal constant REVIEW_BLOCK = 74_572_742;
    address internal constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address internal constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address internal constant WETH_SPY = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;
    address internal constant WETH_PONS = 0xEd50bDeeA8aDC232f159486192a4157281D722ff;
    address internal constant CASHCAT_WETH = 0xd42A491087a15E5afd51FEb3606066Cc152d2b09;
    address internal curator = makeAddr("curator");
    address internal user = makeAddr("user");

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com"));
        uint256 forkBlock = vm.envOr("HOODX_FORK_BLOCK", REVIEW_BLOCK);
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        assertEq(block.chainid, 4663);
    }

    function testCanonicalManagerMintAndDirectFullRecovery() public {
        _exercise(WETH_USDG, 2_000);
    }

    function testAllFourPilotSleevesMintAndRecoverThroughCanonicalManager() public {
        _exercise(WETH_USDG, 2_000);
        _exercise(WETH_SPY, 4_000);
        _exercise(WETH_PONS, 6_000);
        _exercise(CASHCAT_WETH, 7_200);
    }

    function testCompleteFourSleeveIndexBootstrapUnwrapAndRecovery() public {
        address[4] memory pools = [WETH_USDG, WETH_SPY, WETH_PONS, CASHCAT_WETH];
        int24[4] memory widths = [int24(2_000), int24(4_000), int24(6_000), int24(7_200)];
        address[] memory sleeves = new address[](4);
        for (uint256 i; i < pools.length; ++i) {
            IUniswapV3PoolLike pool = IUniswapV3PoolLike(pools[i]);
            (, int24 tick,,,,,) = pool.slot0();
            int24 spacing = pool.tickSpacing();
            int24 center = tick - (tick % spacing);
            sleeves[i] = address(
                new HoodxLiquiditySleeveV1(
                    curator,
                    POSITION_MANAGER,
                    FACTORY,
                    pools[i],
                    center - widths[i],
                    center + widths[i],
                    "HOODX LP Sleeve",
                    "hxLP"
                )
            );
        }
        HoodxLiquidityIndexV1 index = new HoodxLiquidityIndexV1(
            curator, IUniswapV3PoolLike(WETH_USDG).token0(), sleeves, "Liquidity Prime", "HLPX"
        );
        // WETH is token0 of the reviewed WETH/USDG pool.
        assertEq(index.weth(), IUniswapV3PoolLike(WETH_USDG).token0());
        HoodxLiquidityControllerV1.Policy[] memory policies = new HoodxLiquidityControllerV1.Policy[](4);
        policies[0] = HoodxLiquidityControllerV1.Policy(2_000, 300, 120, 2_000, 30 minutes, 1 hours, 12 hours);
        policies[1] = HoodxLiquidityControllerV1.Policy(4_000, 600, 300, 4_000, 1 hours, 4 hours, 24 hours);
        policies[2] = HoodxLiquidityControllerV1.Policy(6_000, 900, 600, 6_000, 30 minutes, 30 minutes, 6 hours);
        policies[3] = HoodxLiquidityControllerV1.Policy(7_200, 1_200, 720, 7_200, 30 minutes, 30 minutes, 6 hours);
        HoodxLiquidityControllerV1 controller =
            new HoodxLiquidityControllerV1(address(index), curator, sleeves, policies);

        vm.startPrank(curator);
        index.transferOwnership(address(controller));
        for (uint256 i; i < sleeves.length; ++i) {
            HoodxLiquiditySleeveV1(sleeves[i]).transferOwnership(address(controller));
        }
        controller.activate();
        for (uint256 i; i < sleeves.length; ++i) {
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(sleeves[i]);
            deal(sleeve.token0(), curator, 1 ether);
            deal(sleeve.token1(), curator, 1 ether);
            IERC20(sleeve.token0()).approve(address(sleeve), 1 ether);
            IERC20(sleeve.token1()).approve(address(sleeve), 1 ether);
            controller.seedSleeve(i, 1 ether, 1 ether, 0, 0, block.timestamp + 5 minutes);
        }
        deal(index.weth(), curator, 1 ether);
        IERC20(index.weth()).transfer(address(index), 1 ether);
        controller.bootstrap(user, 100 ether);
        vm.stopPrank();

        vm.startPrank(user);
        index.unwrap(100 ether, user);
        for (uint256 i; i < sleeves.length; ++i) {
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(sleeves[i]);
            uint256 shares = sleeve.balanceOf(user);
            assertGt(shares, 0);
            sleeve.redeem(shares, user, 0, 0, block.timestamp + 5 minutes);
            assertEq(sleeve.totalSupply(), 0);
        }
        vm.stopPrank();
        assertEq(index.totalSupply(), 0);
    }

    function _exercise(address poolAddress, int24 halfWidth) internal {
        IUniswapV3PoolLike pool = IUniswapV3PoolLike(poolAddress);
        (, int24 tick,,,,,) = pool.slot0();
        int24 spacing = pool.tickSpacing();
        int24 center = tick - (tick % spacing);
        int24 lower = center - halfWidth;
        int24 upper = center + halfWidth;

        HoodxLiquiditySleeveV1 sleeve = new HoodxLiquiditySleeveV1(
            curator, POSITION_MANAGER, FACTORY, poolAddress, lower, upper, "HOODX LP WETH-USDG", "hxLP-WU"
        );
        address token0 = pool.token0();
        address token1 = pool.token1();
        uint256 amount0 = 1 ether;
        uint256 amount1 = 1 ether;
        deal(token0, curator, amount0);
        deal(token1, curator, amount1);

        vm.startPrank(curator);
        IERC20(token0).approve(address(sleeve), amount0);
        IERC20(token1).approve(address(sleeve), amount1);
        (uint256 shares, uint128 liquidity) =
            sleeve.fund(curator, user, amount0, amount1, 0, 0, block.timestamp + 5 minutes);
        vm.stopPrank();
        assertGt(shares, 0);
        assertGt(liquidity, 0);
        assertEq(sleeve.balanceOf(user), shares);

        uint256 before0 = IERC20(token0).balanceOf(user);
        uint256 before1 = IERC20(token1).balanceOf(user);
        vm.prank(user);
        sleeve.redeem(shares, user, 0, 0, block.timestamp + 5 minutes);
        assertEq(sleeve.totalSupply(), 0);
        assertEq(sleeve.tokenId(), 0);
        assertGt(IERC20(token0).balanceOf(user) + IERC20(token1).balanceOf(user), before0 + before1);
    }
}
