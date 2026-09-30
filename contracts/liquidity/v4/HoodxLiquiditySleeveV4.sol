// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    IV4PoolManager,
    IV4StateView,
    IV4UnlockCallback,
    ModifyLiquidityParams,
    PoolKey,
    V4Delta
} from "./V4Types.sol";

/// @notice Fungible ownership of one Uniswap V4 range position held directly in the PoolManager.
/// @dev Mirrors HoodxLiquiditySleeveV1: controller-owned management, no swaps anywhere, and an
///      always-available pro-rata redeem into the two underlying tokens. The position is keyed by
///      (this, tickLower, tickUpper, salt 0) inside the PoolManager; only one range exists at a time.
///      Unhooked ERC-20/ERC-20 pools only (no native ETH, no hooks) to keep settlement exact.
contract HoodxLiquiditySleeveV4 is ERC20, Ownable2Step, ReentrancyGuard, IV4UnlockCallback {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    int24 public constant MIN_TICK = -887272;
    int24 public constant MAX_TICK = 887272;

    IV4PoolManager public immutable poolManager;
    IV4StateView public immutable stateView;
    bytes32 public immutable poolId;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    uint24 public immutable expectedProtocolFee;

    int24 public tickLower;
    int24 public tickUpper;
    uint128 public positionLiquidity;
    bool public managementPaused;

    // Transient-by-convention guard: only set while this contract is inside its own unlock.
    bool private _unlocking;

    error Unauthorized();
    error Invalid();
    error Stale();
    error Slippage();

    event PositionFunded(uint128 liquidityAdded, uint256 sharesMinted);
    event FeesCollected(uint256 amount0, uint256 amount1);
    event Compounded(uint128 liquidityAdded, uint256 amount0Used, uint256 amount1Used);
    event PositionRebanded(int24 tickLower, int24 tickUpper, uint128 liquidity);
    event Redeemed(address indexed owner, address indexed receiver, uint256 shares, uint256 amount0, uint256 amount1);
    event ManagementPauseSet(bool paused);

    constructor(
        address admin,
        address poolManager_,
        address stateView_,
        PoolKey memory key,
        uint24 expectedProtocolFee_,
        int24 initialLower,
        int24 initialUpper,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(admin) {
        if (
            admin == address(0) || poolManager_.code.length == 0 || stateView_.code.length == 0
                || key.hooks != address(0) || key.currency0 == address(0) || key.currency0 >= key.currency1
                || key.tickSpacing <= 0 || key.currency0.code.length == 0 || key.currency1.code.length == 0
        ) revert Invalid();
        poolManager = IV4PoolManager(poolManager_);
        stateView = IV4StateView(stateView_);
        token0 = key.currency0;
        token1 = key.currency1;
        fee = key.fee;
        tickSpacing = key.tickSpacing;
        poolId = V4Delta.poolId(key);
        expectedProtocolFee = expectedProtocolFee_;
        (uint160 sqrtPrice,,,) = IV4StateView(stateView_).getSlot0(poolId);
        if (sqrtPrice == 0) revert Invalid();
        _validateTicks(initialLower, initialUpper);
        tickLower = initialLower;
        tickUpper = initialUpper;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(token0, token1, fee, tickSpacing, address(0));
    }

    function spot() public view returns (uint160 sqrtPriceX96, int24 tick) {
        (sqrtPriceX96, tick,,) = stateView.getSlot0(poolId);
    }

    // ------------------------------------------------------------------ management (controller only)

    /// @notice Adds `liquidity` using tokens pulled from `funder`; unused tokens are refunded.
    function fund(address funder, address receiver, uint128 liquidity, uint256 max0, uint256 max1, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint256 shares)
    {
        if (managementPaused || funder == address(0) || receiver == address(0) || liquidity == 0) revert Invalid();
        _validateEconomics();
        _validateDeadline(deadline);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        if (max0 != 0) IERC20(token0).safeTransferFrom(funder, address(this), max0);
        if (max1 != 0) IERC20(token1).safeTransferFrom(funder, address(this), max1);

        uint256 supplyBefore = totalSupply();
        uint128 liquidityBefore = positionLiquidity;
        if (supplyBefore != 0 && liquidityBefore == 0) revert Invalid();
        (uint256 paid0, uint256 paid1) = _modify(tickLower, tickUpper, int256(uint256(liquidity)));
        if (paid0 > max0 || paid1 > max1) revert Slippage();
        positionLiquidity = liquidityBefore + liquidity;
        shares = supplyBefore == 0 ? uint256(liquidity) : Math.mulDiv(liquidity, supplyBefore, liquidityBefore);
        if (shares == 0) revert Slippage();
        _mint(receiver, shares);

        uint256 excess0 = IERC20(token0).balanceOf(address(this)) - b0;
        uint256 excess1 = IERC20(token1).balanceOf(address(this)) - b1;
        if (excess0 != 0) IERC20(token0).safeTransfer(funder, excess0);
        if (excess1 != 0) IERC20(token1).safeTransfer(funder, excess1);
        emit PositionFunded(liquidity, shares);
    }

    /// @notice Collects accrued fees into the sleeve's idle balance (a zero-liquidity modify).
    function collectFees() external onlyOwner nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (managementPaused || positionLiquidity == 0) revert Invalid();
        (amount0, amount1) = _collect();
        emit FeesCollected(amount0, amount1);
    }

    /// @notice Reinvests idle tokens (including collected fees) into the current range. No swap.
    function compound(uint128 liquidityToAdd, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint256 used0, uint256 used1)
    {
        if (managementPaused || liquidityToAdd == 0 || positionLiquidity == 0) revert Invalid();
        _validateEconomics();
        _validateDeadline(deadline);
        _collect();
        (used0, used1) = _modify(tickLower, tickUpper, int256(uint256(liquidityToAdd)));
        positionLiquidity += liquidityToAdd;
        emit Compounded(liquidityToAdd, used0, used1);
    }

    /// @notice Moves all liquidity to [newLower, newUpper] funded only from the sleeve's own balances.
    /// @dev No swap. The controller chooses the geometry (one-sided "maker" range or centered) and the
    ///      exact liquidity from a fresh simulation; this call fails if balances cannot fund it.
    function reband(int24 newLower, int24 newUpper, uint128 newLiquidity, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        if (managementPaused || positionLiquidity == 0 || newLiquidity == 0) revert Invalid();
        _validateEconomics();
        _validateDeadline(deadline);
        _validateTicks(newLower, newUpper);
        _modify(tickLower, tickUpper, -int256(uint256(positionLiquidity)));
        tickLower = newLower;
        tickUpper = newUpper;
        _modify(newLower, newUpper, int256(uint256(newLiquidity)));
        positionLiquidity = newLiquidity;
        emit PositionRebanded(newLower, newUpper, newLiquidity);
    }

    function setManagementPaused(bool paused) external onlyOwner {
        managementPaused = paused;
        emit ManagementPauseSet(paused);
    }

    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external onlyOwner {
        if (token == token0 || token == token1 || receiver == address(0)) revert Invalid();
        IERC20(token).safeTransfer(receiver, amount);
    }

    // ------------------------------------------------------------------ exit (always available)

    /// @notice Burns shares for a pro-rata slice of the position plus idle tokens. Works while paused.
    function redeem(uint256 shares, address receiver, uint256 min0, uint256 min1, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        _validateDeadline(deadline);
        uint256 supply = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender) || receiver == address(0) || supply == 0) revert Invalid();
        if (positionLiquidity != 0) _collect();
        uint256 idle0 = Math.mulDiv(IERC20(token0).balanceOf(address(this)), shares, supply);
        uint256 idle1 = Math.mulDiv(IERC20(token1).balanceOf(address(this)), shares, supply);
        uint128 liquidityOut = uint128(Math.mulDiv(positionLiquidity, shares, supply));
        uint256 p0;
        uint256 p1;
        if (liquidityOut != 0) {
            (p0, p1) = _removeTo(liquidityOut);
            positionLiquidity -= liquidityOut;
        }
        amount0 = idle0 + p0;
        amount1 = idle1 + p1;
        if (amount0 < min0 || amount1 < min1) revert Slippage();
        _burn(msg.sender, shares);
        if (totalSupply() == 0) {
            amount0 = IERC20(token0).balanceOf(address(this));
            amount1 = IERC20(token1).balanceOf(address(this));
        }
        if (amount0 != 0) IERC20(token0).safeTransfer(receiver, amount0);
        if (amount1 != 0) IERC20(token1).safeTransfer(receiver, amount1);
        emit Redeemed(msg.sender, receiver, shares, amount0, amount1);
    }

    // ------------------------------------------------------------------ PoolManager plumbing

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_unlocking) revert Unauthorized();
        (int24 lower, int24 upper, int256 delta) = abi.decode(data, (int24, int24, int256));
        (int256 callerDelta,) =
            poolManager.modifyLiquidity(poolKey(), ModifyLiquidityParams(lower, upper, delta, bytes32(0)), "");
        uint256 paid0 = _settle(token0, V4Delta.amount0(callerDelta));
        uint256 paid1 = _settle(token1, V4Delta.amount1(callerDelta));
        return abi.encode(paid0, paid1);
    }

    /// @dev Returns what the sleeve PAID in (positive = paid). Receipts are taken to this contract.
    function _modify(int24 lower, int24 upper, int256 delta) internal returns (uint256 paid0, uint256 paid1) {
        _unlocking = true;
        bytes memory r = poolManager.unlock(abi.encode(lower, upper, delta));
        _unlocking = false;
        (paid0, paid1) = abi.decode(r, (uint256, uint256));
    }

    function _collect() internal returns (uint256 amount0, uint256 amount1) {
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        _modify(tickLower, tickUpper, 0);
        amount0 = IERC20(token0).balanceOf(address(this)) - b0;
        amount1 = IERC20(token1).balanceOf(address(this)) - b1;
    }

    function _removeTo(uint128 liquidity) internal returns (uint256 amount0, uint256 amount1) {
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        _modify(tickLower, tickUpper, -int256(uint256(liquidity)));
        amount0 = IERC20(token0).balanceOf(address(this)) - b0;
        amount1 = IERC20(token1).balanceOf(address(this)) - b1;
    }

    function _settle(address token, int128 d) internal returns (uint256 paid) {
        if (d < 0) {
            paid = uint256(uint128(-d));
            poolManager.sync(token);
            IERC20(token).safeTransfer(address(poolManager), paid);
            poolManager.settle();
        } else if (d > 0) {
            poolManager.take(token, address(this), uint256(uint128(d)));
        }
    }

    function _validateDeadline(uint256 deadline) internal view {
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert Stale();
    }

    function _validateEconomics() internal view {
        (,, uint24 protocolFee, uint24 lpFee) = stateView.getSlot0(poolId);
        if (protocolFee != expectedProtocolFee || lpFee != fee) revert Invalid();
    }

    function _validateTicks(int24 lower, int24 upper) internal view {
        if (
            lower >= upper || lower < MIN_TICK || upper > MAX_TICK || lower % tickSpacing != 0
                || upper % tickSpacing != 0
        ) revert Invalid();
    }
}
