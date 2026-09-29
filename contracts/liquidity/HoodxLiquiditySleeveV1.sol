// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUniswapV3FactoryLike, IUniswapV3PoolLike, INonfungiblePositionManagerLike} from "./UniswapV3Types.sol";

/// @notice Fungible ownership of one reviewed Uniswap V3 position.
/// @dev Pilot sleeves are funded and managed only by their controller. Any sleeve-share holder can
///      always redeem directly to the underlying pair, so an index or controller outage cannot trap it.
contract HoodxLiquiditySleeveV1 is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    int24 public constant MIN_TICK = -887272;
    int24 public constant MAX_TICK = 887272;

    INonfungiblePositionManagerLike public immutable positionManager;
    address public immutable factory;
    address public immutable pool;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    uint8 public immutable expectedFeeProtocol;

    uint256 public tokenId;
    uint128 public positionLiquidity;
    int24 public tickLower;
    int24 public tickUpper;
    bool public managementPaused;

    error Unauthorized();
    error Invalid();
    error Stale();
    error Slippage();

    event PositionFunded(uint256 indexed tokenId, uint128 liquidityAdded, uint256 sharesMinted);
    event FeesCollected(uint256 amount0, uint256 amount1);
    event Compounded(uint128 liquidityAdded, uint256 amount0Used, uint256 amount1Used);
    event PositionRebanded(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 tickLower, int24 tickUpper);
    event Redeemed(address indexed owner, address indexed receiver, uint256 shares, uint256 amount0, uint256 amount1);
    event ManagementPauseSet(bool paused);

    constructor(
        address admin,
        address positionManager_,
        address factory_,
        address pool_,
        uint8 expectedFeeProtocol_,
        int24 initialLower,
        int24 initialUpper,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(admin) {
        if (
            admin == address(0) || positionManager_.code.length == 0 || factory_.code.length == 0
                || pool_.code.length == 0
        ) revert Invalid();
        positionManager = INonfungiblePositionManagerLike(positionManager_);
        factory = factory_;
        pool = pool_;
        IUniswapV3PoolLike p = IUniswapV3PoolLike(pool_);
        token0 = p.token0();
        token1 = p.token1();
        fee = p.fee();
        tickSpacing = p.tickSpacing();
        (,,,,, uint8 feeProtocol,) = p.slot0();
        expectedFeeProtocol = expectedFeeProtocol_;
        if (
            p.factory() != factory_ || IUniswapV3FactoryLike(factory_).getPool(token0, token1, fee) != pool_
                || token0 >= token1 || tickSpacing <= 0 || feeProtocol != expectedFeeProtocol_
        ) revert Invalid();
        _validateTicks(initialLower, initialUpper);
        tickLower = initialLower;
        tickUpper = initialUpper;
    }

    /// @notice Adds the pair to the sleeve and sends all new sleeve shares to `receiver`.
    /// @dev Controller-only in the pilot. Unused inputs are returned to `funder`.
    function fund(
        address funder,
        address receiver,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external onlyOwner nonReentrant returns (uint256 shares, uint128 liquidityAdded) {
        if (managementPaused || funder == address(0) || receiver == address(0)) revert Invalid();
        _validateEconomics();
        _validateDeadline(deadline);
        if (amount0Desired == 0 && amount1Desired == 0) revert Invalid();

        uint256 balance0Before = IERC20(token0).balanceOf(address(this));
        uint256 balance1Before = IERC20(token1).balanceOf(address(this));
        if (amount0Desired != 0) IERC20(token0).safeTransferFrom(funder, address(this), amount0Desired);
        if (amount1Desired != 0) IERC20(token1).safeTransferFrom(funder, address(this), amount1Desired);
        _approveManager(amount0Desired, amount1Desired);

        uint256 supplyBefore = totalSupply();
        uint128 liquidityBefore = positionLiquidity;
        uint256 used0;
        uint256 used1;
        if (tokenId == 0) {
            (uint256 id, uint128 liq, uint256 amount0, uint256 amount1) = positionManager.mint(
                INonfungiblePositionManagerLike.MintParams({
                    token0: token0,
                    token1: token1,
                    fee: fee,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    recipient: address(this),
                    deadline: deadline
                })
            );
            if (id == 0 || liq == 0 || positionManager.ownerOf(id) != address(this)) revert Invalid();
            tokenId = id;
            liquidityAdded = liq;
            used0 = amount0;
            used1 = amount1;
            shares = uint256(liq);
        } else {
            if (liquidityBefore == 0 || supplyBefore == 0) revert Invalid();
            (uint128 liq, uint256 amount0, uint256 amount1) = positionManager.increaseLiquidity(
                INonfungiblePositionManagerLike.IncreaseLiquidityParams({
                    tokenId: tokenId,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    deadline: deadline
                })
            );
            liquidityAdded = liq;
            used0 = amount0;
            used1 = amount1;
            shares = Math.mulDiv(uint256(liq), supplyBefore, uint256(liquidityBefore));
        }
        if (liquidityAdded == 0 || shares == 0 || used0 < amount0Min || used1 < amount1Min) revert Slippage();
        positionLiquidity = liquidityBefore + liquidityAdded;
        _mint(receiver, shares);
        _clearManagerApproval();

        uint256 excess0 = IERC20(token0).balanceOf(address(this)) - balance0Before;
        uint256 excess1 = IERC20(token1).balanceOf(address(this)) - balance1Before;
        if (excess0 != 0) IERC20(token0).safeTransfer(funder, excess0);
        if (excess1 != 0) IERC20(token1).safeTransfer(funder, excess1);
        emit PositionFunded(tokenId, liquidityAdded, shares);
    }

    function collectFees() external onlyOwner nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (managementPaused || tokenId == 0) revert Invalid();
        (amount0, amount1) = _collectAll();
        emit FeesCollected(amount0, amount1);
    }

    /// @notice Reinvests collected and idle pair tokens without a swap.
    /// @dev The curator supplies a minimum liquidity increase from a fresh simulation, preventing a
    ///      gas-wasting or unexpectedly ineffective compound from succeeding.
    function compound(uint256 amount0Min, uint256 amount1Min, uint128 minLiquidityAdded, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint128 liquidityAdded, uint256 amount0Used, uint256 amount1Used)
    {
        if (managementPaused || tokenId == 0 || minLiquidityAdded == 0) revert Invalid();
        _validateEconomics();
        _validateDeadline(deadline);
        _collectAll();
        uint256 desired0 = IERC20(token0).balanceOf(address(this));
        uint256 desired1 = IERC20(token1).balanceOf(address(this));
        if (desired0 == 0 && desired1 == 0) revert Invalid();
        _approveManager(desired0, desired1);
        (liquidityAdded, amount0Used, amount1Used) = positionManager.increaseLiquidity(
            INonfungiblePositionManagerLike.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: desired0,
                amount1Desired: desired1,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            })
        );
        if (liquidityAdded < minLiquidityAdded) revert Slippage();
        positionLiquidity += liquidityAdded;
        _clearManagerApproval();
        emit Compounded(liquidityAdded, amount0Used, amount1Used);
    }

    /// @notice Moves all liquidity to a new range without swaps. Residual pair tokens remain recoverable.
    function reband(
        int24 newLower,
        int24 newUpper,
        uint256 amount0Min,
        uint256 amount1Min,
        uint128 minNewLiquidity,
        uint256 deadline
    ) external onlyOwner nonReentrant returns (uint256 newTokenId, uint128 newLiquidity) {
        if (managementPaused || tokenId == 0 || positionLiquidity == 0 || minNewLiquidity == 0) {
            revert Invalid();
        }
        _validateEconomics();
        _validateDeadline(deadline);
        _validateTicks(newLower, newUpper);

        uint256 oldId = tokenId;
        uint128 oldLiquidity = positionLiquidity;
        _collectAll();
        positionManager.decreaseLiquidity(
            INonfungiblePositionManagerLike.DecreaseLiquidityParams({
                tokenId: oldId,
                liquidity: oldLiquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            })
        );
        _collectAll();
        positionManager.burn(oldId);

        uint256 desired0 = IERC20(token0).balanceOf(address(this));
        uint256 desired1 = IERC20(token1).balanceOf(address(this));
        _approveManager(desired0, desired1);
        uint256 used0;
        uint256 used1;
        (newTokenId, newLiquidity, used0, used1) = positionManager.mint(
            INonfungiblePositionManagerLike.MintParams({
                token0: token0,
                token1: token1,
                fee: fee,
                tickLower: newLower,
                tickUpper: newUpper,
                amount0Desired: desired0,
                amount1Desired: desired1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: deadline
            })
        );
        used0;
        used1;
        if (newTokenId == 0 || newLiquidity < minNewLiquidity || positionManager.ownerOf(newTokenId) != address(this)) {
            revert Invalid();
        }
        tokenId = newTokenId;
        positionLiquidity = newLiquidity;
        tickLower = newLower;
        tickUpper = newUpper;
        _clearManagerApproval();
        emit PositionRebanded(oldId, newTokenId, newLower, newUpper);
    }

    /// @notice Burns sleeve shares for the underlying pair. This path is always available.
    function redeem(uint256 shares, address receiver, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        _validateDeadline(deadline);
        uint256 supply = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender) || receiver == address(0) || supply == 0) revert Invalid();

        _collectAll();
        uint256 idle0 = IERC20(token0).balanceOf(address(this));
        uint256 idle1 = IERC20(token1).balanceOf(address(this));
        uint256 idlePayout0 = Math.mulDiv(idle0, shares, supply);
        uint256 idlePayout1 = Math.mulDiv(idle1, shares, supply);
        uint128 liquidityOut = uint128(Math.mulDiv(uint256(positionLiquidity), shares, supply));

        uint256 principal0;
        uint256 principal1;
        if (liquidityOut != 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManagerLike.DecreaseLiquidityParams({
                    tokenId: tokenId, liquidity: liquidityOut, amount0Min: 0, amount1Min: 0, deadline: deadline
                })
            );
            (principal0, principal1) = _collectAll();
            positionLiquidity -= liquidityOut;
        }
        amount0 = idlePayout0 + principal0;
        amount1 = idlePayout1 + principal1;
        if (amount0 < amount0Min || amount1 < amount1Min) revert Slippage();
        _burn(msg.sender, shares);

        if (totalSupply() == 0 && tokenId != 0) {
            if (positionLiquidity != 0) revert Invalid();
            positionManager.burn(tokenId);
            tokenId = 0;
            amount0 = IERC20(token0).balanceOf(address(this));
            amount1 = IERC20(token1).balanceOf(address(this));
        }
        if (amount0 != 0) IERC20(token0).safeTransfer(receiver, amount0);
        if (amount1 != 0) IERC20(token1).safeTransfer(receiver, amount1);
        emit Redeemed(msg.sender, receiver, shares, amount0, amount1);
    }

    function setManagementPaused(bool paused) external onlyOwner {
        managementPaused = paused;
        emit ManagementPauseSet(paused);
    }

    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external onlyOwner {
        if (token == token0 || token == token1 || receiver == address(0)) revert Invalid();
        IERC20(token).safeTransfer(receiver, amount);
    }

    function _collectAll() internal returns (uint256 amount0, uint256 amount1) {
        if (tokenId == 0) return (0, 0);
        return positionManager.collect(
            INonfungiblePositionManagerLike.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
    }

    function _approveManager(uint256 amount0, uint256 amount1) internal {
        IERC20(token0).forceApprove(address(positionManager), amount0);
        IERC20(token1).forceApprove(address(positionManager), amount1);
    }

    function _clearManagerApproval() internal {
        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);
    }

    function _validateDeadline(uint256 deadline) internal view {
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert Stale();
    }

    function _validateEconomics() internal view {
        (,,,,, uint8 feeProtocol,) = IUniswapV3PoolLike(pool).slot0();
        if (feeProtocol != expectedFeeProtocol) revert Invalid();
    }

    function _validateTicks(int24 lower, int24 upper) internal view {
        if (
            lower >= upper || lower < MIN_TICK || upper > MAX_TICK || lower % tickSpacing != 0
                || upper % tickSpacing != 0
        ) revert Invalid();
    }
}
