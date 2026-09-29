// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxFeeMachineLaunchV1} from "../../contracts/liquidity/HoodxFeeMachineLaunchV1.sol";
import {HoodxLiquidityIndexV1} from "../../contracts/liquidity/HoodxLiquidityIndexV1.sol";
import {HoodxLiquiditySleeveV1} from "../../contracts/liquidity/HoodxLiquiditySleeveV1.sol";
import {HoodxLiquidityControllerV1} from "../../contracts/liquidity/HoodxLiquidityControllerV1.sol";
import {IUniswapV3PoolLike} from "../../contracts/liquidity/UniswapV3Types.sol";

interface IFeeMachineQuoterV3 {
    struct Params {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(Params calldata) external returns (uint256, uint160, uint32, uint256);
}

contract FeeMachineLaunchForkTest is Test {
    uint256 internal constant REVIEW_BLOCK = 75_495_049;
    address internal constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant V3_QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address[4] internal pools = [
        0xD64FbdA67E1015dF43Fa5e49F02cA844729E5F94,
        0xdEc8F541FF159D2B4ABD3c3b041CD739BD7C486F,
        0x28f26FB95Ef30218E0090d0776A5cDF65BA44E73,
        0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca
    ];

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envString("ROBINHOOD_RPC_URL");
        vm.createSelectFork(rpc, vm.envOr("HOODX_FORK_BLOCK", REVIEW_BLOCK));
        assertEq(block.chainid, 4663);
    }

    function testAtomicFullDeploymentBootstrapAndIndependentRecovery() public {
        uint256 seed = 0.05 ether;
        int24[4] memory centers;
        for (uint256 i; i < 4; ++i) {
            centers[i] = _center(pools[i], i == 3 ? 30 minutes : 1 hours);
        }
        HoodxFeeMachineLaunchV1 launch = new HoodxFeeMachineLaunchV1(CURATOR, seed, 200 ether, centers);
        HoodxLiquidityIndexV1 index = launch.index();
        HoodxLiquidityControllerV1 controller = launch.controller();
        assertEq(index.owner(), address(controller));
        assertEq(controller.curator(), CURATOR);
        assertEq(controller.bootstrapAuthority(), address(launch));

        vm.deal(CURATOR, seed);
        (uint256[4] memory minTokenOut, uint256[4] memory minWethUsed, uint256[4] memory minTokenUsed) =
            _protectedMinimums(launch, seed);
        vm.prank(CURATOR);
        launch.bootstrapFromEth{value: seed}(minTokenOut, minWethUsed, minTokenUsed, block.timestamp + 5 minutes);

        assertTrue(launch.bootstrapped());
        assertTrue(index.bootstrapped());
        assertEq(index.totalSupply(), 200 ether);
        assertEq(index.balanceOf(CURATOR), 200 ether);
        assertEq(IERC20(WETH).balanceOf(address(index)), 0);
        for (uint256 i; i < 4; ++i) {
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(launch.sleeves(i));
            assertGt(sleeve.positionLiquidity(), 0);
            assertGt(sleeve.balanceOf(address(index)), 0);
            assertEq(controller.lastReband(i), block.timestamp);
        }

        vm.prank(CURATOR);
        controller.setManagementPaused(true);
        vm.prank(CURATOR);
        index.unwrap(200 ether, CURATOR);
        for (uint256 i; i < 4; ++i) {
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(launch.sleeves(i));
            uint256 shares = sleeve.balanceOf(CURATOR);
            assertGt(shares, 0);
            vm.prank(CURATOR);
            sleeve.redeem(shares, CURATOR, 0, 0, block.timestamp + 5 minutes);
            assertEq(sleeve.totalSupply(), 0);
            assertEq(sleeve.tokenId(), 0);
        }
        assertEq(index.totalSupply(), 0);
    }

    function testOnlyCuratorCanBootstrapAndBootstrapCannotReplay() public {
        uint256 seed = 0.01 ether;
        int24[4] memory centers;
        for (uint256 i; i < 4; ++i) {
            centers[i] = _center(pools[i], i == 3 ? 30 minutes : 1 hours);
        }
        HoodxFeeMachineLaunchV1 launch = new HoodxFeeMachineLaunchV1(CURATOR, seed, 40 ether, centers);
        uint256[4] memory minimums;
        for (uint256 i; i < 4; ++i) {
            minimums[i] = 1;
        }
        vm.expectRevert(HoodxFeeMachineLaunchV1.Unauthorized.selector);
        launch.bootstrapFromEth(minimums, minimums, minimums, block.timestamp + 5 minutes);

        vm.deal(CURATOR, seed * 2);
        vm.startPrank(CURATOR);
        launch.bootstrapFromEth{value: seed}(minimums, minimums, minimums, block.timestamp + 5 minutes);
        vm.expectRevert(HoodxFeeMachineLaunchV1.Invalid.selector);
        launch.bootstrapFromEth{value: seed}(minimums, minimums, minimums, block.timestamp + 5 minutes);
        vm.stopPrank();
    }

    function testBootstrapRevalidatesMarketAtFundingTime() public {
        uint256 seed = 0.01 ether;
        int24[4] memory centers;
        for (uint256 i; i < 4; ++i) {
            centers[i] = _center(pools[i], i == 3 ? 30 minutes : 1 hours);
        }
        HoodxFeeMachineLaunchV1 launch = new HoodxFeeMachineLaunchV1(CURATOR, seed, 40 ether, centers);
        uint256[4] memory minimums;
        for (uint256 i; i < 4; ++i) {
            minimums[i] = 1;
        }
        vm.mockCall(
            pools[0],
            abi.encodeWithSignature("slot0()"),
            abi.encode(uint160(1), centers[0] + int24(601), uint16(0), uint16(1), uint16(1), uint8(102), true)
        );
        vm.deal(CURATOR, seed);
        vm.expectRevert(HoodxFeeMachineLaunchV1.Divergence.selector);
        vm.prank(CURATOR);
        launch.bootstrapFromEth{value: seed}(minimums, minimums, minimums, block.timestamp + 5 minutes);
        assertFalse(launch.bootstrapped());
    }

    function _protectedMinimums(HoodxFeeMachineLaunchV1 launch, uint256 seed)
        internal
        returns (uint256[4] memory tokenOut, uint256[4] memory wethUsed, uint256[4] memory tokenUsed)
    {
        for (uint256 i; i < 4; ++i) {
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(launch.sleeves(i));
            uint256 side = seed * (i == 3 ? 500 : 1_500) / 10_000;
            (uint256 quote,,,) = IFeeMachineQuoterV3(V3_QUOTER)
                .quoteExactInputSingle(IFeeMachineQuoterV3.Params(WETH, sleeve.token1(), side, sleeve.fee(), 0));
            tokenOut[i] = quote * 95 / 100;
            // Mint utilization varies with range geometry and the swap's own price impact. The live
            // signer derives tighter floors from a full eth_call; the fork still proves non-dust floors.
            wethUsed[i] = side * 50 / 100;
            tokenUsed[i] = quote * 50 / 100;
        }
    }

    function _center(address poolAddress, uint32 secondsAgo) internal view returns (int24 center) {
        IUniswapV3PoolLike pool = IUniswapV3PoolLike(poolAddress);
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = secondsAgo;
        (int56[] memory cumulative,) = pool.observe(secondsAgos);
        int56 delta = cumulative[1] - cumulative[0];
        int24 tick = int24(delta / int56(uint56(secondsAgo)));
        if (delta < 0 && delta % int56(uint56(secondsAgo)) != 0) --tick;
        int24 spacing = pool.tickSpacing();
        int24 remainder = tick % spacing;
        center = tick - remainder;
        if (remainder >= spacing / 2) center += spacing;
        if (remainder <= -(spacing / 2)) center -= spacing;
    }
}
