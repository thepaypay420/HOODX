// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HoodxLiquiditySleeveV1} from "./HoodxLiquiditySleeveV1.sol";
import {HoodxLiquidityIndexV1} from "./HoodxLiquidityIndexV1.sol";
import {HoodxLiquidityControllerV1} from "./HoodxLiquidityControllerV1.sol";
import {IUniswapV3PoolLike} from "./UniswapV3Types.sol";

interface IFeeMachineSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IFeeMachineWrappedNative {
    function deposit() external payable;
}

/// @notice One-purpose launcher and atomic WETH bootstrapper for the protocol-controlled Fee Machine pilot.
/// @dev Exact pools, weights, fee settings and operating policy are immutable. After the one-time bootstrap,
///      this contract has no ability to manage the index or any sleeve.
contract HoodxFeeMachineLaunchV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address public constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    address public constant DELTA_POOL = 0xD64FbdA67E1015dF43Fa5e49F02cA844729E5F94;
    address public constant PONGO_POOL = 0xdEc8F541FF159D2B4ABD3c3b041CD739BD7C486F;
    address public constant GIWA_POOL = 0x28f26FB95Ef30218E0090d0776A5cDF65BA44E73;
    address public constant CORE_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;

    address public immutable curator;
    uint256 public immutable seedWeth;
    uint256 public immutable initialShares;
    HoodxLiquidityIndexV1 public immutable index;
    HoodxLiquidityControllerV1 public immutable controller;
    address[4] public sleeves;
    int24[4] public launchCenters;
    bool public bootstrapped;

    error Unauthorized();
    error Invalid();
    error Stale();
    error Divergence();

    event FeeMachineBootstrapped(address indexed curator, uint256 seedWeth, uint256 shares);

    constructor(address curator_, uint256 seedWeth_, uint256 initialShares_, int24[4] memory centers) {
        if (curator_ == address(0) || seedWeth_ == 0 || initialShares_ == 0) revert Invalid();
        curator = curator_;
        seedWeth = seedWeth_;
        initialShares = initialShares_;

        address[4] memory pools = [DELTA_POOL, PONGO_POOL, GIWA_POOL, CORE_POOL];
        int24[4] memory widths = [int24(1_000), int24(1_000), int24(1_000), int24(2_000)];
        uint8[4] memory feeProtocols = [uint8(102), uint8(102), uint8(102), uint8(68)];
        string[4] memory names =
            ["HOODX LP DELTA-WETH", "HOODX LP PONGO-WETH", "HOODX LP GIWA-WETH", "HOODX LP WETH-USDG"];
        string[4] memory symbols = ["hxLP-D", "hxLP-P", "hxLP-G", "hxLP-U"];

        address[] memory deployedSleeves = new address[](4);
        for (uint256 i; i < 4; ++i) {
            IUniswapV3PoolLike pool = IUniswapV3PoolLike(pools[i]);
            if (pool.token0() != WETH || pool.factory() != V3_FACTORY) revert Invalid();
            int24 spacing = pool.tickSpacing();
            if (centers[i] % spacing != 0 || widths[i] % spacing != 0) revert Invalid();
            launchCenters[i] = centers[i];
            _validateMarket(i, pool, centers[i], spacing, feeProtocols[i]);
            HoodxLiquiditySleeveV1 sleeve = new HoodxLiquiditySleeveV1(
                address(this),
                POSITION_MANAGER,
                V3_FACTORY,
                pools[i],
                feeProtocols[i],
                centers[i] - widths[i],
                centers[i] + widths[i],
                names[i],
                symbols[i]
            );
            sleeves[i] = address(sleeve);
            deployedSleeves[i] = address(sleeve);
        }

        index = new HoodxLiquidityIndexV1(address(this), WETH, deployedSleeves, "HOODX Fee Machine", "FEEX");
        HoodxLiquidityControllerV1.Policy[] memory policies = new HoodxLiquidityControllerV1.Policy[](4);
        for (uint256 i; i < 3; ++i) {
            policies[i] = HoodxLiquidityControllerV1.Policy({
                halfWidth: 1_000,
                edgeBuffer: 200,
                maxTwapDeviation: 500,
                maxCenterMove: 1_000,
                twapSeconds: 1 hours,
                breachDelay: 24 hours,
                cooldown: 7 days,
                blockTokenDownside: true
            });
        }
        policies[3] = HoodxLiquidityControllerV1.Policy({
            halfWidth: 2_000,
            edgeBuffer: 300,
            maxTwapDeviation: 120,
            maxCenterMove: 1_000,
            twapSeconds: 30 minutes,
            breachDelay: 24 hours,
            cooldown: 7 days,
            blockTokenDownside: false
        });
        controller = new HoodxLiquidityControllerV1(
            address(index), curator_, address(this), address(this), deployedSleeves, policies
        );
        index.transferOwnership(address(controller));
        for (uint256 i; i < 4; ++i) {
            HoodxLiquiditySleeveV1(sleeves[i]).transferOwnership(address(controller));
        }
        controller.activate();
    }

    /// @notice Converts one exact, pre-reviewed native ETH seed into 30/30/30/10 fee-earning sleeves atomically.
    /// @param minTokenOut Per-pool minimum acquired paired token from the WETH swap.
    /// @param minWethUsed Per-sleeve minimum WETH accepted by the position manager.
    /// @param minTokenUsed Per-sleeve minimum paired token accepted by the position manager.
    function bootstrapFromEth(
        uint256[4] calldata minTokenOut,
        uint256[4] calldata minWethUsed,
        uint256[4] calldata minTokenUsed,
        uint256 deadline
    ) external payable nonReentrant {
        if (msg.sender != curator) revert Unauthorized();
        if (bootstrapped) revert Invalid();
        if (msg.value != seedWeth) revert Invalid();
        if (deadline < block.timestamp || deadline > block.timestamp + 5 minutes) revert Stale();
        address[4] memory pools = [DELTA_POOL, PONGO_POOL, GIWA_POOL, CORE_POOL];
        for (uint256 i; i < 4; ++i) {
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(sleeves[i]);
            _validateMarket(
                i, IUniswapV3PoolLike(pools[i]), launchCenters[i], sleeve.tickSpacing(), sleeve.expectedFeeProtocol()
            );
        }
        bootstrapped = true;
        IFeeMachineWrappedNative(WETH).deposit{value: seedWeth}();

        uint256 allocated;
        for (uint256 i; i < 4; ++i) {
            if (minTokenOut[i] == 0 || minWethUsed[i] == 0 || minTokenUsed[i] == 0) revert Invalid();
            uint256 side = seedWeth * (i == 3 ? 500 : 1_500) / 10_000;
            uint256 directWeth = i == 3 ? seedWeth - allocated - side : side;
            allocated += directWeth + side;
            HoodxLiquiditySleeveV1 sleeve = HoodxLiquiditySleeveV1(sleeves[i]);
            address token = sleeve.token1();
            IERC20(WETH).forceApprove(SWAP_ROUTER, side);
            uint256 tokenOut = IFeeMachineSwapRouter(SWAP_ROUTER)
                .exactInputSingle(
                    IFeeMachineSwapRouter.ExactInputSingleParams({
                        tokenIn: WETH,
                        tokenOut: token,
                        fee: sleeve.fee(),
                        recipient: address(this),
                        amountIn: side,
                        amountOutMinimum: minTokenOut[i],
                        sqrtPriceLimitX96: 0
                    })
                );
            IERC20(WETH).forceApprove(SWAP_ROUTER, 0);
            IERC20(WETH).forceApprove(address(sleeve), directWeth);
            IERC20(token).forceApprove(address(sleeve), tokenOut);
            controller.seedSleeve(i, directWeth, tokenOut, minWethUsed[i], minTokenUsed[i], deadline);
            IERC20(WETH).forceApprove(address(sleeve), 0);
            IERC20(token).forceApprove(address(sleeve), 0);
        }
        if (allocated != seedWeth) revert Invalid();
        controller.bootstrap(curator, initialShares);

        _refund(WETH);
        for (uint256 i; i < 4; ++i) {
            _refund(HoodxLiquiditySleeveV1(sleeves[i]).token1());
        }
        emit FeeMachineBootstrapped(curator, seedWeth, initialShares);
    }

    function _refund(address token) internal {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance != 0) IERC20(token).safeTransfer(curator, balance);
    }

    function _twap(IUniswapV3PoolLike pool, uint32 secondsAgo) internal view returns (int24 tick) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = secondsAgo;
        (int56[] memory cumulative,) = pool.observe(secondsAgos);
        int56 delta = cumulative[1] - cumulative[0];
        tick = int24(delta / int56(uint56(secondsAgo)));
        if (delta < 0 && delta % int56(uint56(secondsAgo)) != 0) --tick;
    }

    function _validateMarket(
        uint256 poolIndex,
        IUniswapV3PoolLike pool,
        int24 center,
        int24 spacing,
        uint8 expectedProtocol
    ) internal view {
        (, int24 spot,,,, uint8 liveFeeProtocol, bool unlocked) = pool.slot0();
        uint24 maxDeployDeviation = poolIndex == 3 ? 120 : 600;
        if (!unlocked || liveFeeProtocol != expectedProtocol || _absDiff(spot, center) > maxDeployDeviation) {
            revert Divergence();
        }
        int24 twap = _twap(pool, poolIndex == 3 ? 30 minutes : 1 hours);
        uint24 maxTwapDeviation = poolIndex == 3 ? 120 : 500;
        if (_absDiff(spot, twap) > maxTwapDeviation || _absDiff(twap, center) > uint24(uint256(int256(spacing / 2)))) {
            revert Divergence();
        }
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint24) {
        int256 d = int256(a) - int256(b);
        return uint24(uint256(d < 0 ? -d : d));
    }
}
