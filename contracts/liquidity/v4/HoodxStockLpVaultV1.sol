// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IV4PoolManager, IV4UnlockCallback, PoolKey, SwapParams, V4Delta} from "./V4Types.sol";

/// @dev Mirrors HoodxStockLpControllerV1.Policy (ABI-identical).
struct HoodxStockLpControllerPolicy {
    int24 halfWidth;
    int24 makerWidth;
    uint16 maxDivergenceBps;
    uint32 breachDelay;
    uint32 cooldown;
    address priceRef;
    uint8 tokenDecimals;
    uint8 quoteDecimals;
}

interface IStockLpController {
    function sleeves() external view returns (address[] memory);
    function divergenceBps(uint256 i) external view returns (uint256);
    function policy(uint256 i) external view returns (HoodxStockLpControllerPolicy memory);
}

interface IStockSleeve {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickLower() external view returns (int24);
    function tickUpper() external view returns (int24);
    function positionLiquidity() external view returns (uint128);
    function spot() external view returns (uint160 sqrtPriceX96, int24 tick);
    function quoteDepositShares(uint256 shares) external returns (uint256 need0, uint256 need1);
    function depositShares(uint256 shares, uint256 max0, uint256 max1) external returns (uint256 paid0, uint256 paid1);
    function redeem(uint256 shares, address receiver, uint256 min0, uint256 min1, uint256 deadline)
        external
        returns (uint256 amount0, uint256 amount1);
}

/// @notice HOODX Stock LP vault: one-click ETH in, one-click ETH out.
/// @dev Holds shares of up to 8 HoodxLiquiditySleeveV4 sleeves (tokenized-stock/USDG Uniswap V4 ranges).
///      Entry: ETH -> USDG (native ETH/USDG V4 pool) -> each sleeve's stock (its swap pool) -> a pro-rata
///      deposit into every sleeve; leftovers are sold back and refunded as ETH in the same transaction.
///      Exit: pro-rata sleeve redemption -> stocks and USDG sold -> ETH. `exitToSleeveShares` is the
///      emergency exit: no swap, pool, price or manager dependency.
///      Deposits are in-kind pro-rata (every sleeve grows by at least the depositor's fraction), so pool
///      prices cannot move value between depositors; the depositor alone carries swap costs. Owner
///      (the controller) can only bootstrap and rescue unrelated tokens; management pauses (on the
///      sleeves) stop deposits but never exits.
contract HoodxStockLpVaultV1 is ERC20, Ownable2Step, ReentrancyGuard, IV4UnlockCallback {
    using SafeERC20 for IERC20;

    struct Holding {
        IStockSleeve sleeve;
        address stock;
        PoolKey swapKey; // pool used to buy/sell `stock` against USDG (may be the sleeve's own pool)
    }

    struct HoldingView {
        address sleeve;
        address stock;
        uint256 sleeveShares;
        uint256 sleeveSupply;
        int24 tickLower;
        int24 tickUpper;
        int24 tick;
        uint128 positionLiquidity;
    }

    uint256 public constant MAX_HOLDINGS = 8;
    uint256 public constant MAX_DEADLINE = 5 minutes;
    uint256 public constant MIN_SHARES = 1e12;
    uint256 public constant DEAD_SHARES = 1e15; // locked forever at bootstrap: supply never returns to zero
    address private constant DEAD = address(0xdead);
    uint24 private constant MAX_STATIC_FEE = 1_000_000; // >= this is the dynamic-fee flag
    uint16 public constant MAX_BUFFER_BPS = 1_000;
    uint160 private constant MIN_SQRT = 4295128739 + 1;
    uint160 private constant MAX_SQRT = 1461446703485210103287273052203988822378723970342 - 1;
    uint8 private constant ETH_TO_USDG = 1;
    uint8 private constant BUY_STOCK = 2;
    uint8 private constant SELL_ALL = 3;

    IV4PoolManager public immutable poolManager;
    address public immutable usdg;
    uint24 public immutable ethPoolFee;
    int24 public immutable ethPoolTickSpacing;
    uint256 public immutable minDepositUsdg; // e.g. 10e6 = $10
    uint256 public immutable tvlCapUsdg; // e.g. 2_000e6 = $2k
    uint16 public immutable bufferBps; // extra stock bought per sleeve, sold back after the deposit
    string public strategy;

    Holding[] private _holdings;
    bool public bootstrapped;
    bool private _unlocking;

    error Unauthorized();
    error Invalid();
    error Stale();
    error Slippage();
    error BelowMinimum();
    error CapExceeded();
    error Illiquid();
    error Divergence();

    event Bootstrapped(address indexed receiver, uint256 shares);
    event DepositedEth(address indexed account, address indexed receiver, uint256 shares, uint256 ethUsed, uint256 usdgValue);
    event WithdrawnEth(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut);
    event ExitedToSleeveShares(address indexed account, address indexed receiver, uint256 shares);

    constructor(
        address admin,
        address poolManager_,
        address usdg_,
        uint24 ethPoolFee_,
        int24 ethPoolTickSpacing_,
        address[] memory sleeves_,
        PoolKey[] memory swapKeys_,
        uint256 minDepositUsdg_,
        uint256 tvlCapUsdg_,
        uint16 bufferBps_,
        string memory strategy_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(admin) {
        if (
            admin == address(0) || poolManager_.code.length == 0 || usdg_.code.length == 0 || sleeves_.length == 0
                || sleeves_.length > MAX_HOLDINGS || sleeves_.length != swapKeys_.length || minDepositUsdg_ == 0
                || tvlCapUsdg_ < minDepositUsdg_ || bufferBps_ > MAX_BUFFER_BPS || ethPoolTickSpacing_ <= 0
                || ethPoolFee_ >= MAX_STATIC_FEE
        ) revert Invalid();
        poolManager = IV4PoolManager(poolManager_);
        usdg = usdg_;
        ethPoolFee = ethPoolFee_;
        ethPoolTickSpacing = ethPoolTickSpacing_;
        minDepositUsdg = minDepositUsdg_;
        tvlCapUsdg = tvlCapUsdg_;
        bufferBps = bufferBps_;
        strategy = strategy_;
        for (uint256 i; i < sleeves_.length; ++i) {
            IStockSleeve sleeve = IStockSleeve(sleeves_[i]);
            if (address(sleeve).code.length == 0) revert Invalid();
            address t0 = sleeve.token0();
            address t1 = sleeve.token1();
            if (t0 != usdg_ && t1 != usdg_) revert Invalid();
            address stock = t0 == usdg_ ? t1 : t0;
            PoolKey memory k = swapKeys_[i];
            bool pairOk = (k.currency0 == usdg_ && k.currency1 == stock) || (k.currency0 == stock && k.currency1 == usdg_);
            if (!pairOk || k.hooks != address(0) || k.tickSpacing <= 0 || k.fee >= MAX_STATIC_FEE) revert Invalid();
            for (uint256 j; j < i; ++j) {
                if (address(_holdings[j].sleeve) == sleeves_[i] || _holdings[j].stock == stock) revert Invalid();
            }
            _holdings.push(Holding(sleeve, stock, k));
        }
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert Unauthorized();
    }

    // ------------------------------------------------------------------ views

    /// @notice Controller compatibility: the vault's quote asset (USDG). The vault never holds WETH.
    function weth() external view returns (address) {
        return usdg;
    }

    function holdingCount() external view returns (uint256) {
        return _holdings.length;
    }

    function holding(uint256 i) external view returns (Holding memory) {
        return _holdings[i];
    }

    /// @notice Everything the site needs to display the strategy: every sleeve, its range and our share.
    function holdings() external view returns (HoldingView[] memory out) {
        out = new HoldingView[](_holdings.length);
        for (uint256 i; i < _holdings.length; ++i) {
            IStockSleeve s = _holdings[i].sleeve;
            (, int24 tick) = s.spot();
            out[i] = HoldingView(
                address(s),
                _holdings[i].stock,
                IERC20(address(s)).balanceOf(address(this)),
                IERC20(address(s)).totalSupply(),
                s.tickLower(),
                s.tickUpper(),
                tick,
                s.positionLiquidity()
            );
        }
    }

    // ------------------------------------------------------------------ bootstrap (controller)

    /// @notice Mints the first shares against sleeve shares seeded into this vault by the controller.
    /// @dev The owner must be the controller managing exactly these sleeves in this order, because
    ///      deposits read its independent price agreement by sleeve index.
    function bootstrap(address receiver, uint256 initialShares) external onlyOwner {
        if (bootstrapped || !_recipient(receiver) || initialShares < MIN_SHARES) revert Invalid();
        address[] memory managed = IStockLpController(msg.sender).sleeves();
        if (managed.length != _holdings.length) revert Invalid();
        for (uint256 i; i < _holdings.length; ++i) {
            if (managed[i] != address(_holdings[i].sleeve)) revert Invalid();
            if (IERC20(address(_holdings[i].sleeve)).balanceOf(address(this)) == 0) revert Invalid();
        }
        bootstrapped = true;
        _mint(DEAD, DEAD_SHARES);
        _mint(receiver, initialShares);
        emit Bootstrapped(receiver, initialShares);
    }

    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external onlyOwner {
        if (token == usdg || receiver == address(0)) revert Invalid();
        for (uint256 i; i < _holdings.length; ++i) {
            if (token == address(_holdings[i].sleeve) || token == _holdings[i].stock) revert Invalid();
        }
        IERC20(token).safeTransfer(receiver, amount);
    }

    // ------------------------------------------------------------------ one-click ETH entry

    /// @notice Mints exactly `shares` for at most `msg.value` ETH; unused ETH is refunded in the same call.
    /// @dev Size `shares` off-chain with eth_call (returns `ethUsed`). `msg.value` is the slippage bound.
    function depositEth(uint256 shares, address receiver, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 ethUsed)
    {
        uint256 supply = totalSupply();
        if (!bootstrapped || shares < MIN_SHARES || msg.value == 0 || !_recipient(receiver)) revert Invalid();
        _checkDeadline(deadline);
        _requireFairPrices();

        uint256 usdgFromEth = abi.decode(_unlock(abi.encode(ETH_TO_USDG, msg.value)), (uint256));
        uint256 usdgLeft = usdgFromEth;
        uint256 n = _holdings.length;
        uint256[] memory stockLeft = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            (stockLeft[i], usdgLeft) = _depositSleeve(i, supply, shares, usdgLeft);
        }
        uint256 ethBack = abi.decode(_unlock(abi.encode(SELL_ALL, stockLeft, usdgLeft)), (uint256));
        if (ethBack >= msg.value) revert Invalid();
        ethUsed = msg.value - ethBack;

        uint256 usdgValue = Math.mulDiv(usdgFromEth, ethUsed, msg.value);
        if (usdgValue < minDepositUsdg) revert BelowMinimum();
        // Soft capacity cap: NAV implied by this deposit's own execution (includes its costs, so conservative).
        if (Math.mulDiv(usdgValue, supply, shares) + usdgValue > tvlCapUsdg) revert CapExceeded();

        _mint(receiver, shares);
        if (ethBack != 0) Address.sendValue(payable(msg.sender), ethBack);
        emit DepositedEth(msg.sender, receiver, shares, ethUsed, usdgValue);
    }

    // ------------------------------------------------------------------ one-click ETH exit

    /// @notice Burns `shares` for their pro-rata slice of every sleeve, converted to ETH.
    function withdrawEth(uint256 shares, address payable receiver, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        uint256 supply = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender) || minEthOut == 0 || !_recipient(receiver)) revert Invalid();
        _checkDeadline(deadline);
        _burn(msg.sender, shares);
        uint256 n = _holdings.length;
        uint256[] memory stockOut = new uint256[](n);
        uint256 usdgOut;
        for (uint256 i; i < n; ++i) {
            Holding memory h = _holdings[i];
            uint256 s = Math.mulDiv(IERC20(address(h.sleeve)).balanceOf(address(this)), shares, supply);
            if (s == 0) continue;
            (uint256 a0, uint256 a1) = h.sleeve.redeem(s, address(this), 0, 0, block.timestamp);
            bool usdgIs0 = h.sleeve.token0() == usdg;
            stockOut[i] = usdgIs0 ? a1 : a0;
            usdgOut += usdgIs0 ? a0 : a1;
        }
        ethOut = abi.decode(_unlock(abi.encode(SELL_ALL, stockOut, usdgOut)), (uint256));
        if (ethOut < minEthOut) revert Slippage();
        Address.sendValue(receiver, ethOut);
        emit WithdrawnEth(msg.sender, receiver, shares, ethOut);
    }

    /// @notice Emergency exit: burns `shares` for the pro-rata sleeve shares themselves. No swap, no pool,
    ///         no price and no manager is involved; each sleeve share is redeemable for its two tokens.
    function exitToSleeveShares(uint256 shares, address receiver) external nonReentrant {
        uint256 supply = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender) || !_recipient(receiver)) revert Invalid();
        _burn(msg.sender, shares);
        for (uint256 i; i < _holdings.length; ++i) {
            IERC20 sleeve = IERC20(address(_holdings[i].sleeve));
            uint256 s = Math.mulDiv(sleeve.balanceOf(address(this)), shares, supply);
            if (s != 0) sleeve.safeTransfer(receiver, s);
        }
        emit ExitedToSleeveShares(msg.sender, receiver, shares);
    }

    // ------------------------------------------------------------------ guards (carried over from the live vaults)

    function _checkDeadline(uint256 deadline) internal view {
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE) revert Stale();
    }

    /// @dev Entry only: every sleeve pool must agree with the controller's independent TWAP reference
    ///      (fails closed when a reference is unavailable). Exits never depend on a price reference.
    function _requireFairPrices() internal view {
        IStockLpController c = IStockLpController(owner());
        for (uint256 i; i < _holdings.length; ++i) {
            if (c.divergenceBps(i) > c.policy(i).maxDivergenceBps) revert Divergence();
        }
    }

    function _recipient(address a) internal view returns (bool) {
        return a != address(0) && a != address(this) && a != DEAD && a != usdg && a != address(poolManager);
    }

    function transferOwnership(address next) public override onlyOwner {
        if (!_recipient(next)) revert Invalid();
        super.transferOwnership(next);
    }

    function renounceOwnership() public view override onlyOwner {
        revert Invalid();
    }

    /// @dev Share transfers cannot target the vault or the dead address, and cannot happen mid-operation.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (_reentrancyGuardEntered() || to == address(this) || to == DEAD) revert Invalid();
        }
        super._update(from, to, value);
    }

    // ------------------------------------------------------------------ entry internals

    /// @dev Buys what sleeve `i` needs for the depositor's ceil pro-rata share, re-quoting after the
    ///      purchase (our own swap may move the sleeve's pool), then deposits. Returns leftovers.
    function _depositSleeve(uint256 i, uint256 supply, uint256 shares, uint256 usdgAvail)
        internal
        returns (uint256 stockLeft, uint256 usdgLeft)
    {
        Holding memory h = _holdings[i];
        uint256 s = Math.mulDiv(IERC20(address(h.sleeve)).balanceOf(address(this)), shares, supply, Math.Rounding.Ceil);
        bool usdgIs0 = h.sleeve.token0() == usdg;
        (uint256 needStock,) = _quote(h.sleeve, s, usdgIs0);
        uint256 have;
        if (needStock != 0) {
            uint256 buy = needStock + Math.mulDiv(needStock, bufferBps, 10_000) + 1;
            usdgAvail -= abi.decode(_unlock(abi.encode(BUY_STOCK, i, buy)), (uint256));
            have = buy;
            (needStock,) = _quote(h.sleeve, s, usdgIs0);
            if (needStock > have) {
                // Our purchase moved the pool beyond the buffer: top up the exact shortfall.
                uint256 more = needStock - have;
                usdgAvail -= abi.decode(_unlock(abi.encode(BUY_STOCK, i, more)), (uint256));
                have += more;
            }
        }
        (uint256 max0, uint256 max1) = usdgIs0 ? (usdgAvail, have) : (have, usdgAvail);
        IERC20(h.stock).forceApprove(address(h.sleeve), have);
        IERC20(usdg).forceApprove(address(h.sleeve), usdgAvail);
        (uint256 p0, uint256 p1) = h.sleeve.depositShares(s, max0, max1);
        (uint256 paidUsdg, uint256 paidStock) = usdgIs0 ? (p0, p1) : (p1, p0);
        stockLeft = have - paidStock;
        usdgLeft = usdgAvail - paidUsdg;
    }

    function _quote(IStockSleeve sleeve, uint256 s, bool usdgIs0) internal returns (uint256 stock, uint256 quote) {
        (uint256 n0, uint256 n1) = sleeve.quoteDepositShares(s);
        (stock, quote) = usdgIs0 ? (n1, n0) : (n0, n1);
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
            // ETH is currency0 of the ETH/USDG pool: exact-input zeroForOne.
            int256 d = _swap(_ethKey(), true, -int256(ethIn));
            if (V4Delta.amount0(d) != -int256(ethIn)) revert Illiquid();
            uint256 out = uint256(int256(V4Delta.amount1(d)));
            poolManager.settle{value: ethIn}();
            poolManager.take(usdg, address(this), out);
            return abi.encode(out);
        }
        if (action == BUY_STOCK) {
            (, uint256 i, uint256 amountOut) = abi.decode(data, (uint8, uint256, uint256));
            Holding memory h = _holdings[i];
            bool usdgIs0 = h.swapKey.currency0 == usdg;
            int256 d = _swap(h.swapKey, usdgIs0, int256(amountOut));
            (int128 dUsdg, int128 dStock) = usdgIs0 ? (V4Delta.amount0(d), V4Delta.amount1(d)) : (V4Delta.amount1(d), V4Delta.amount0(d));
            if (dStock != int256(amountOut)) revert Illiquid();
            uint256 cost = uint256(-int256(dUsdg));
            _pay(usdg, cost);
            poolManager.take(h.stock, address(this), amountOut);
            return abi.encode(cost);
        }
        if (action == SELL_ALL) {
            (, uint256[] memory stockIn, uint256 usdgIn) = abi.decode(data, (uint8, uint256[], uint256));
            uint256 usdgTotal = usdgIn;
            for (uint256 i; i < stockIn.length; ++i) {
                if (stockIn[i] == 0) continue;
                Holding memory h = _holdings[i];
                bool stockIs0 = h.swapKey.currency0 == h.stock;
                int256 d = _swap(h.swapKey, stockIs0, -int256(stockIn[i]));
                (int128 dStock, int128 dUsdg) = stockIs0 ? (V4Delta.amount0(d), V4Delta.amount1(d)) : (V4Delta.amount1(d), V4Delta.amount0(d));
                if (dStock != -int256(stockIn[i])) revert Illiquid();
                _pay(h.stock, stockIn[i]);
                usdgTotal += uint256(int256(dUsdg));
            }
            uint256 ethOut;
            if (usdgTotal != 0) {
                int256 d = _swap(_ethKey(), false, -int256(usdgTotal));
                if (V4Delta.amount1(d) != -int256(usdgTotal)) revert Illiquid();
                ethOut = uint256(int256(V4Delta.amount0(d)));
                // Stock proceeds already net against this USDG debt; pay only what we brought in.
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
