// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UniTwap} from "../../UniTwap.sol";
import {IV4PoolManager, IV4UnlockCallback, PoolKey, SwapParams, V4Delta} from "./V4Types.sol";

interface ISeedController {
    function sleeves() external view returns (address[] memory);
    function index() external view returns (address);
    function seedSleeve(uint256 i, uint128 liquidity, uint256 max0, uint256 max1, uint256 deadline)
        external
        returns (uint256 shares);
    function bootstrap(address receiver, uint256 initialShares) external;
}

interface ISeedSleeve {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickLower() external view returns (int24);
    function tickUpper() external view returns (int24);
    function spot() external view returns (uint160 sqrtPriceX96, int24 tick);
}

interface ISeedVault {
    function holding(uint256 i) external view returns (address sleeve, address stock, PoolKey memory swapKey);
}

/// @notice One-shot launch helper: turns the operator's ETH into the 8 seed positions and bootstraps the vault,
///         in one transaction. It is the controller's immutable bootstrap authority, callable only by the
///         operator, and useless after bootstrap (the controller refuses further seeding). It never holds
///         funds between transactions: leftovers are sold back and the ETH is refunded in the same call.
contract HoodxStockLpSeederV1 is IV4UnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint160 private constant MIN_SQRT = 4295128739 + 1;
    uint160 private constant MAX_SQRT = 1461446703485210103287273052203988822378723970342 - 1;
    uint256 private constant Q96 = 1 << 96;
    uint8 private constant ETH_TO_USDG = 1;
    uint8 private constant BUY = 2;
    uint8 private constant SELL_ALL = 3;

    IV4PoolManager public immutable poolManager;
    address public immutable usdg;
    address public immutable operator;
    uint24 public immutable ethPoolFee;
    int24 public immutable ethPoolTickSpacing;
    bool private _unlocking;
    ISeedVault private _vault;

    error Unauthorized();
    error Invalid();
    error Illiquid();

    event Seeded(address indexed controller, address indexed receiver, uint256 ethUsed, uint256 initialShares);

    constructor(address poolManager_, address usdg_, address operator_, uint24 ethPoolFee_, int24 ethPoolTickSpacing_) {
        if (poolManager_.code.length == 0 || usdg_.code.length == 0 || operator_ == address(0)) revert Invalid();
        poolManager = IV4PoolManager(poolManager_);
        usdg = usdg_;
        operator = operator_;
        ethPoolFee = ethPoolFee_;
        ethPoolTickSpacing = ethPoolTickSpacing_;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert Unauthorized();
    }

    /// @notice Seeds every sleeve with an equal USDG-valued slice of `msg.value` and bootstraps the vault.
    /// @param receiver gets the initial vault shares (1 share ≈ $1 of seed value).
    /// @param reserveBps part of the USDG kept back to cover swap costs and the in-range ratio (e.g. 500 = 5%).
    function seed(ISeedController controller, address receiver, uint16 reserveBps)
        external
        payable
        nonReentrant
        returns (uint256 initialShares)
    {
        if (msg.sender != operator || receiver == address(0) || msg.value == 0 || reserveBps > 3_000) revert Invalid();
        _vault = ISeedVault(controller.index());
        address[] memory sl = controller.sleeves();
        uint256 n = sl.length;
        uint256 usdgIn = abi.decode(_unlock(abi.encode(ETH_TO_USDG, msg.value)), (uint256));
        uint256 budget = Math.mulDiv(usdgIn, 10_000 - reserveBps, 10_000) / n;
        uint256[] memory stockLeft = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            stockLeft[i] = _seedOne(controller, i, ISeedSleeve(sl[i]), budget);
        }
        uint256 usdgLeft = IERC20(usdg).balanceOf(address(this));
        initialShares = (usdgIn - usdgLeft) * 1e12; // ≈ $1 per share at seed
        controller.bootstrap(receiver, initialShares);
        uint256 ethBack = abi.decode(_unlock(abi.encode(SELL_ALL, stockLeft, usdgLeft)), (uint256));
        if (ethBack != 0) Address.sendValue(payable(operator), ethBack);
        emit Seeded(address(controller), receiver, msg.value - ethBack, initialShares);
    }

    function _seedOne(ISeedController controller, uint256 i, ISeedSleeve s, uint256 budget)
        internal
        returns (uint256 stockLeft)
    {
        (address sleeve, address stock, PoolKey memory swapKey) = _vault.holding(i);
        if (sleeve != address(s)) revert Invalid();
        bool usdgIs0 = s.token0() == usdg;
        (uint128 L, uint256 needStock, uint256 needUsdg) = _plan(s, usdgIs0, budget);
        uint256 buy = needStock + needStock / 100 + 1;
        if (needStock != 0) _unlock(abi.encode(BUY, swapKey, stock, buy));
        uint256 maxUsdg = needUsdg + needUsdg / 100 + 1;
        IERC20(stock).forceApprove(address(s), buy);
        IERC20(usdg).forceApprove(address(s), maxUsdg);
        (uint256 max0, uint256 max1) = usdgIs0 ? (maxUsdg, buy) : (buy, maxUsdg);
        controller.seedSleeve(i, L, max0, max1, block.timestamp);
        IERC20(stock).forceApprove(address(s), 0);
        IERC20(usdg).forceApprove(address(s), 0);
        stockLeft = IERC20(stock).balanceOf(address(this));
    }

    /// @dev Liquidity that a `budget` (USDG, raw) buys in the sleeve's range at the current price, with 3% headroom.
    function _plan(ISeedSleeve s, bool usdgIs0, uint256 budget)
        internal
        view
        returns (uint128 L, uint256 needStock, uint256 needUsdg)
    {
        (uint160 sp,) = s.spot();
        uint256 sP = sp;
        uint256 sL = UniTwap.getSqrtRatioAtTick(s.tickLower());
        uint256 sU = UniTwap.getSqrtRatioAtTick(s.tickUpper());
        uint256 unit = 1e18;
        (uint256 a0, uint256 a1) = _amounts(unit, sP, sL, sU);
        // value of one liquidity unit in USDG raw
        uint256 v = usdgIs0
            ? a0 + Math.mulDiv(Math.mulDiv(a1, Q96, sP), Q96, sP)
            : a1 + Math.mulDiv(Math.mulDiv(a0, sP, Q96), sP, Q96);
        if (v == 0) revert Invalid();
        L = uint128(Math.mulDiv(budget, unit, v) * 97 / 100);
        (uint256 n0, uint256 n1) = _amounts(L, sP, sL, sU);
        (needUsdg, needStock) = usdgIs0 ? (n0, n1) : (n1, n0);
    }

    function _amounts(uint256 L, uint256 sP, uint256 sL, uint256 sU) internal pure returns (uint256 a0, uint256 a1) {
        if (sP <= sL) {
            a0 = Math.mulDiv(Math.mulDiv(L, Q96, sL), sU - sL, sU);
        } else if (sP >= sU) {
            a1 = Math.mulDiv(L, sU - sL, Q96);
        } else {
            a0 = Math.mulDiv(Math.mulDiv(L, Q96, sP), sU - sP, sU);
            a1 = Math.mulDiv(L, sP - sL, Q96);
        }
    }

    // ------------------------------------------------------------------ PoolManager plumbing

    function _unlock(bytes memory data) internal returns (bytes memory r) {
        _unlocking = true;
        r = poolManager.unlock(data);
        _unlocking = false;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_unlocking) revert Unauthorized();
        uint8 action = abi.decode(data, (uint8));
        if (action == ETH_TO_USDG) {
            (, uint256 ethIn) = abi.decode(data, (uint8, uint256));
            int256 d = _swap(_ethKey(), true, -int256(ethIn));
            if (V4Delta.amount0(d) != -int256(ethIn)) revert Illiquid();
            uint256 out = uint256(int256(V4Delta.amount1(d)));
            poolManager.settle{value: ethIn}();
            poolManager.take(usdg, address(this), out);
            return abi.encode(out);
        }
        if (action == BUY) {
            (, PoolKey memory key, address stock, uint256 amountOut) = abi.decode(data, (uint8, PoolKey, address, uint256));
            bool usdgIs0 = key.currency0 == usdg;
            int256 d = _swap(key, usdgIs0, int256(amountOut));
            (int128 dU, int128 dS) = usdgIs0 ? (V4Delta.amount0(d), V4Delta.amount1(d)) : (V4Delta.amount1(d), V4Delta.amount0(d));
            if (dS != int256(amountOut)) revert Illiquid();
            _pay(usdg, uint256(-int256(dU)));
            poolManager.take(stock, address(this), amountOut);
            return "";
        }
        if (action == SELL_ALL) {
            (, uint256[] memory stockIn, uint256 usdgIn) = abi.decode(data, (uint8, uint256[], uint256));
            uint256 usdgTotal = usdgIn;
            for (uint256 i; i < stockIn.length; ++i) {
                if (stockIn[i] == 0) continue;
                (, address stock, PoolKey memory key) = _vault.holding(i);
                bool stockIs0 = key.currency0 == stock;
                int256 d = _swap(key, stockIs0, -int256(stockIn[i]));
                (int128 dS, int128 dU) = stockIs0 ? (V4Delta.amount0(d), V4Delta.amount1(d)) : (V4Delta.amount1(d), V4Delta.amount0(d));
                if (dS != -int256(stockIn[i])) revert Illiquid();
                _pay(stock, stockIn[i]);
                usdgTotal += uint256(int256(dU));
            }
            uint256 ethOut;
            if (usdgTotal != 0) {
                int256 d = _swap(_ethKey(), false, -int256(usdgTotal));
                if (V4Delta.amount1(d) != -int256(usdgTotal)) revert Illiquid();
                ethOut = uint256(int256(V4Delta.amount0(d)));
                if (usdgIn != 0) _pay(usdg, usdgIn);
                if (ethOut != 0) poolManager.take(address(0), address(this), ethOut);
            }
            return abi.encode(ethOut);
        }
        revert Invalid();
    }

    function _ethKey() internal view returns (PoolKey memory) {
        return PoolKey(address(0), usdg, ethPoolFee, ethPoolTickSpacing, address(0));
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified) internal returns (int256) {
        return poolManager.swap(key, SwapParams(zeroForOne, amountSpecified, zeroForOne ? MIN_SQRT : MAX_SQRT), "");
    }

    function _pay(address token, uint256 amount) internal {
        poolManager.sync(token);
        IERC20(token).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}
