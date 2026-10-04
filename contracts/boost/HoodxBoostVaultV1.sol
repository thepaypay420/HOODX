// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    MarketParams,
    IMorphoBlue,
    IMorphoFlashLoanCallback,
    IMorphoOracle,
    IMorphoIrm,
    MorphoMarket,
    IUniswapV3PoolLike,
    IUniswapV3SwapCallback,
    IWETH9,
    IBoostSignal
} from "./BoostTypes.sol";

/// @notice HOODX Boosted ETH: ETH in, ETH out, any time. Rides ETH up to 2x while crypto trends up and steps into
///         yield-earning dollars when the trend breaks, following an on-chain signal (HoodxBoostSignalV1).
/// @dev Holdings: WETH collateral and USDG debt in one Morpho Blue market (WETH/USDG, 77% LLTV, Chainlink oracle), plus
///      idle dollars in an ERC-4626 USDG vault (Robinhood Earn steakUSDG). Swaps use one Uniswap V3 WETH/USDG pool.
///      - NAV is valued at the Morpho market's own oracle, the same price that governs its liquidations.
///      - Deposits mirror the vault's current mix (collateral, debt, cash) and mint shares on the NAV actually added, so
///        the depositor alone carries entry costs and no pool price can move value between holders. Entry also requires
///        the pool to agree with the oracle (`maxDivBps`), so a stale oracle cannot be arbitraged against holders.
///      - Withdrawals are pro-rata and never paused: repay that share of debt (a free Morpho flash loan bridges any
///        shortfall), release that share of collateral and cash, and return ETH. `exitInKind` needs no swap at all.
///      - `rebalance()` is a permissionless crank: the contract computes the target, the size (at most `maxSlice` dollars
///        per call, at most one call per `minInterval`) and the oracle-bounded swap limits; the caller chooses nothing.
///        Above `hardCap` leverage anyone may cut at once, even if the signal is stale; and if the signal has been silent
///        for DEAD_SIGNAL (e.g. a retired feed), anyone may step leverage down to 1x, never up.
///      - 10% performance fee above a high-water mark of NAV per share, crystallised at most every 30 days.
///      - The owner (curator) can pause deposits and rescue unrelated tokens. It cannot touch funds, parameters or exits.
contract HoodxBoostVaultV1 is ERC20, Ownable2Step, ReentrancyGuard, IMorphoFlashLoanCallback, IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    struct Config {
        address morpho;
        bytes32 marketId;
        address pool;
        address weth;
        address usdg;
        address cash;           // ERC-4626 USDG vault
        address signal;
        address feeRecipient;
        uint256 minDeposit;     // wei
        uint256 tvlCapUsdg;     // 6 decimals
        uint256 maxSliceUsdg;   // largest rebalance trade per call, 6 decimals
        uint32 minInterval;     // seconds between ordinary rebalances
        uint16 maxSlipBps;      // swap bound vs oracle, ordinary rebalances and deposits
        uint16 emergencySlipBps;// swap bound vs oracle when cutting leverage above hardCap
        uint16 maxDivBps;       // pool vs oracle agreement required for deposits and ordinary rebalances
    }

    uint256 public constant WAD = 1e18;
    uint256 public constant BAND = 0.10e18;          // rebalance only when |actual - target| > 0.10x
    uint256 public constant HARD_CAP = 2.05e18;      // above this anyone may cut leverage immediately
    uint256 public constant DEAD_SIGNAL = 24 hours;  // a signal silent this long lets anyone step leverage down to 1x
    uint256 public constant MAX_LTV_WAD = 0.5625e18; // no action may leave LTV above 56.25% (leverage 2.29x); LLTV is 77%
    uint256 public constant PERF_FEE_BPS = 1_000;    // 10% of gains above the high-water mark
    uint256 public constant FEE_PERIOD = 30 days;
    uint256 public constant MAX_DEADLINE = 5 minutes;
    uint256 public constant DEAD_SHARES = 1e15;
    uint256 public constant MIN_SHARES = 1e12;
    uint256 internal constant ORACLE_SCALE = 1e36;
    uint256 internal constant VIRTUAL_SHARES = 1e6;  // Morpho SharesMathLib
    uint256 internal constant VIRTUAL_ASSETS = 1;
    address private constant DEAD = address(0xdead);
    uint160 private constant MIN_SQRT = 4295128739 + 1;
    uint160 private constant MAX_SQRT = 1461446703485210103287273052203988822378723970342 - 1;
    uint8 private constant FLASH_WITHDRAW = 1;
    uint8 private constant FLASH_DELEVER = 2;
    uint8 private constant FLASH_LEVER = 3;

    IMorphoBlue public immutable morpho;
    bytes32 public immutable marketId;
    IUniswapV3PoolLike public immutable pool;
    IERC20 public immutable weth;
    IERC20 public immutable usdg;
    IERC4626 public immutable cash;
    IBoostSignal public immutable signal;
    address public immutable feeRecipient;
    address public immutable oracle;
    address public immutable irm;
    uint256 public immutable lltv;
    uint256 public immutable minDeposit;
    uint256 public immutable tvlCapUsdg;
    uint256 public immutable maxSliceUsdg;
    uint32 public immutable minInterval;
    uint16 public immutable maxSlipBps;
    uint16 public immutable emergencySlipBps;
    uint16 public immutable maxDivBps;

    bool public bootstrapped;
    bool public depositsPaused;
    uint64 public lastRebalance;
    uint64 public lastFeeTime;
    uint256 public highWaterMark;   // NAV per share (USDG units per 1e18 shares, WAD-scaled)
    uint256 public launchEthPrice;  // oracle price at bootstrap, for "since launch in ETH" displays
    bool private _swapping;
    bool private _flashing;

    error Unauthorized();
    error Invalid();
    error Stale();
    error Slippage();
    error BelowMinimum();
    error CapExceeded();
    error Illiquid();
    error Divergence();
    error NotNeeded();
    error Unhealthy();
    error Paused();

    event Bootstrapped(address indexed receiver, uint256 shares, uint256 ethIn, uint256 navUsdg);
    event Deposited(address indexed account, address indexed receiver, uint256 ethIn, uint256 shares, uint256 navAddedUsdg);
    event Withdrawn(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut);
    event ExitedInKind(address indexed account, address indexed receiver, uint256 shares, uint256 wethOut, uint256 cashSharesOut, uint256 usdgRepaid);
    event Rebalanced(uint256 leverageBefore, uint256 target, uint256 leverageAfter, int256 exposureChangeUsdg, bool emergency, address indexed by);
    event FeesCrystallised(uint256 navPerShare, uint256 feeShares, uint256 highWaterMark);
    event DepositsPaused(bool paused);

    constructor(address admin, Config memory c, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Ownable(admin)
    {
        if (
            admin == address(0) || c.morpho.code.length == 0 || c.pool.code.length == 0 || c.weth.code.length == 0
                || c.usdg.code.length == 0 || c.cash.code.length == 0 || c.signal.code.length == 0
                || c.feeRecipient == address(0) || c.minDeposit == 0 || c.tvlCapUsdg == 0 || c.maxSliceUsdg == 0
                || c.minInterval < 15 minutes || c.minInterval > 6 hours || c.maxSlipBps == 0 || c.maxSlipBps > 200
                || c.emergencySlipBps < c.maxSlipBps || c.emergencySlipBps > 1_000 || c.maxDivBps == 0 || c.maxDivBps > 300
        ) revert Invalid();
        (address loan, address coll, address oracle_, address irm_, uint256 lltv_) = IMorphoBlue(c.morpho).idToMarketParams(c.marketId);
        if (loan != c.usdg || coll != c.weth || oracle_ == address(0) || lltv_ < 0.7e18) revert Invalid();
        if (IUniswapV3PoolLike(c.pool).token0() != c.weth || IUniswapV3PoolLike(c.pool).token1() != c.usdg) revert Invalid();
        if (IERC4626(c.cash).asset() != c.usdg) revert Invalid();
        if (IBoostSignal(c.signal).cap() > 2e18) revert Invalid();
        morpho = IMorphoBlue(c.morpho);
        marketId = c.marketId;
        pool = IUniswapV3PoolLike(c.pool);
        weth = IERC20(c.weth);
        usdg = IERC20(c.usdg);
        cash = IERC4626(c.cash);
        signal = IBoostSignal(c.signal);
        feeRecipient = c.feeRecipient;
        oracle = oracle_;
        irm = irm_;
        lltv = lltv_;
        minDeposit = c.minDeposit;
        tvlCapUsdg = c.tvlCapUsdg;
        maxSliceUsdg = c.maxSliceUsdg;
        minInterval = c.minInterval;
        maxSlipBps = c.maxSlipBps;
        emergencySlipBps = c.emergencySlipBps;
        maxDivBps = c.maxDivBps;
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert Unauthorized();
    }

    // ================================================================== views

    struct State {
        uint256 price;        // oracle: USDG units per WETH wei, x1e36
        uint256 collateral;   // WETH in Morpho
        uint256 borrowShares;
        uint256 debt;         // USDG owed (rounded up)
        uint256 cashShares;   // ERC-4626 shares held
        uint256 cashUsdg;     // their USDG value
        uint256 idleUsdg;
        uint256 idleWeth;
        uint256 nav;          // USDG, 6 decimals
        uint256 leverage;     // WAD: ETH exposure / NAV
    }

    /// @notice Current holdings and value. Debt includes interest accrued since Morpho's last update (computed the way
    ///         Morpho does: the IRM's current rate, compounded with the same 3-term Taylor expansion).
    function state() public view returns (State memory s) {
        s.price = IMorphoOracle(oracle).price();
        (, uint128 bs, uint128 coll) = morpho.position(marketId, address(this));
        s.collateral = coll;
        s.borrowShares = bs;
        s.debt = _toAssetsUp(bs);
        s.cashShares = cash.balanceOf(address(this));
        s.cashUsdg = s.cashShares == 0 ? 0 : cash.previewRedeem(s.cashShares);
        s.idleUsdg = usdg.balanceOf(address(this));
        s.idleWeth = weth.balanceOf(address(this));
        uint256 exposure = _usdgOf(s.collateral + s.idleWeth, s.price);
        uint256 gross = exposure + s.cashUsdg + s.idleUsdg;
        s.nav = gross > s.debt ? gross - s.debt : 0;
        s.leverage = s.nav == 0 ? 0 : Math.mulDiv(exposure, WAD, s.nav);
    }

    /// @notice NAV per 1e18 shares in USDG units, WAD-scaled (1e6 * 1e18 at launch = 1 USDG per share).
    function navPerShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 0 : Math.mulDiv(state().nav, WAD * WAD, supply);
    }

    /// @notice What a keeper needs: whether rebalance() would act now, and why not if not.
    function rebalanceStatus() external view returns (bool ready, bool emergency, uint256 leverage, uint256 target_, bool fresh) {
        State memory s = state();
        leverage = s.leverage;
        fresh = signal.isFresh();
        target_ = signal.target();
        emergency = leverage > HARD_CAP;
        if (emergency) return (true, true, leverage, target_, fresh);
        if (!fresh && _signalDead() && leverage > WAD) target_ = WAD;
        uint256 gap = leverage > target_ ? leverage - target_ : target_ - leverage;
        ready = (fresh || (_signalDead() && leverage > WAD)) && gap > BAND && block.timestamp >= uint256(lastRebalance) + minInterval && s.nav > 0
            && _poolAgrees(s.price, maxDivBps);
    }

    /// @notice What `exitInKind(shares)` would hand over now, and the USDG the caller must approve for its debt share.
    function previewExitInKind(uint256 shares)
        external
        view
        returns (uint256 wethOut, uint256 usdgToApprove, uint256 cashSharesOut, uint256 usdgOut)
    {
        if (shares == 0 || shares > totalSupply()) revert Invalid();
        (uint256 collOut,, uint256 repayAssets, uint256 cs, uint256 u, uint256 w) = _slice(shares);
        return (collOut + w, repayAssets, cs, u);
    }

    // ================================================================== curator

    /// @notice Seeds the vault with the curator's ETH (held unlevered until the first rebalance) and locks DEAD_SHARES.
    function bootstrap(address receiver) external payable onlyOwner nonReentrant {
        if (bootstrapped || !_recipient(receiver) || msg.value < minDeposit) revert Invalid();
        _accrue();
        IWETH9(address(weth)).deposit{value: msg.value}();
        _supplyCollateral(msg.value);
        State memory s = state();
        uint256 shares = s.nav * 1e12; // 1 share = 1 USDG at launch
        if (shares <= DEAD_SHARES + MIN_SHARES) revert BelowMinimum();
        bootstrapped = true;
        launchEthPrice = s.price;
        lastFeeTime = uint64(block.timestamp);
        _mint(DEAD, DEAD_SHARES);
        _mint(receiver, shares - DEAD_SHARES);
        highWaterMark = navPerShare();
        emit Bootstrapped(receiver, shares - DEAD_SHARES, msg.value, s.nav);
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external onlyOwner {
        if (token == address(weth) || token == address(usdg) || token == address(cash) || !_recipient(receiver)) revert Invalid();
        IERC20(token).safeTransfer(receiver, amount);
    }

    // ================================================================== deposit (ETH in)

    /// @notice Deposits ETH; the vault takes the same shape it has now (collateral, debt, dollars) and mints shares on the
    ///         NAV actually added. `minShares` is the depositor's slippage bound.
    function deposit(address receiver, uint256 minShares, uint256 deadline) external payable nonReentrant returns (uint256 shares) {
        if (!bootstrapped || depositsPaused) revert Paused();
        if (msg.value < minDeposit || !_recipient(receiver)) revert Invalid();
        _checkDeadline(deadline);
        _accrue();
        State memory s = state();
        if (!_poolAgrees(s.price, maxDivBps)) revert Divergence();
        uint256 supply = totalSupply();
        if (s.nav == 0 || supply == 0) revert Invalid();

        uint256 v = msg.value;
        IWETH9(address(weth)).deposit{value: v}();
        uint256 f = Math.mulDiv(_usdgOf(v, s.price), WAD, s.nav);     // the deposit's size as a fraction of NAV
        uint256 addColl = Math.mulDiv(s.collateral + s.idleWeth, f, WAD);
        uint256 addDebt = Math.mulDiv(s.debt, f, WAD);
        uint256 addCash = Math.mulDiv(s.cashUsdg + s.idleUsdg, f, WAD);

        if (addColl >= v) {
            // Levered vault: post the ETH, then flash-borrow the deposit's share of debt, buy WETH with it, post that and
            // borrow against the larger position to repay the flash. Borrowing before buying could exceed LLTV on a
            // deposit that is large relative to the vault.
            _supplyCollateral(v);
            uint256 borrowed = Math.min(addDebt > addCash ? addDebt - addCash : 0, _available());
            if (borrowed != 0) _flash(borrowed, abi.encode(FLASH_LEVER, uint256(0), uint256(0), uint256(0), uint256(maxSlipBps)));
        } else {
            if (addColl != 0) _supplyCollateral(addColl);
            _swapBounded(true, v - addColl, s.price, maxSlipBps);
            uint256 borrowed = Math.min(addDebt, _available());
            if (borrowed != 0) morpho.borrow(_mp(), borrowed, 0, address(this), address(this));
        }
        _sweepToCash();

        State memory a = state();
        _requireHealthy(a);
        if (a.nav <= s.nav) revert Slippage();
        uint256 added = a.nav - s.nav;
        if (a.nav > tvlCapUsdg) revert CapExceeded();
        shares = Math.mulDiv(added, supply, s.nav);
        if (shares < MIN_SHARES || shares < minShares) revert Slippage();
        _mint(receiver, shares);
        emit Deposited(msg.sender, receiver, v, shares, added);
    }

    // ================================================================== withdraw (ETH out)

    /// @notice Burns `shares` for their pro-rata slice of collateral, debt and dollars, settled in ETH. Never paused.
    function withdraw(uint256 shares, address payable receiver, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (shares == 0 || shares > balanceOf(msg.sender) || minEthOut == 0 || !_recipient(receiver)) revert Invalid();
        _checkDeadline(deadline);
        _accrue();
        (uint256 collOut, uint256 repayShares, uint256 repayAssets, uint256 cashSharesOut, uint256 idleUOut, uint256 idleWOut) =
            _slice(shares);
        _burn(msg.sender, shares);
        uint256 othersWeth = weth.balanceOf(address(this)) - idleWOut; // loose WETH that stays with remaining holders

        uint256 usdgHave = idleUOut + (cashSharesOut == 0 ? 0 : cash.redeem(cashSharesOut, address(this), address(this)));
        if (repayShares == 0) {
            if (collOut != 0) morpho.withdrawCollateral(_mp(), collOut, address(this), address(this));
        } else if (usdgHave >= repayAssets) {
            usdgHave -= _repayShares(repayShares, usdgHave);
            morpho.withdrawCollateral(_mp(), collOut, address(this), address(this));
        } else {
            // Flash the shortfall: repay, release collateral, buy back exactly the flashed USDG with that collateral.
            uint256 shortfall = repayAssets - usdgHave;
            _flash(shortfall, abi.encode(FLASH_WITHDRAW, repayShares, collOut, usdgHave, uint256(0)));
            usdgHave = 0;
        }
        if (usdgHave != 0) _swap(false, usdgHave); // leftover dollars -> WETH (the withdrawer's own slippage)
        ethOut = weth.balanceOf(address(this)) - othersWeth;
        if (ethOut < minEthOut) revert Slippage();
        IWETH9(address(weth)).withdraw(ethOut);
        Address.sendValue(receiver, ethOut);
        emit Withdrawn(msg.sender, receiver, shares, ethOut);
    }

    /// @notice Emergency exit with no swap and no price: the caller brings the USDG for its share of debt (approve it
    ///         first; zero when the vault holds no debt) and receives its share of WETH and of the dollar-vault shares.
    function exitInKind(uint256 shares, address receiver) external nonReentrant returns (uint256 wethOut, uint256 cashOut, uint256 repaid) {
        if (shares == 0 || shares > balanceOf(msg.sender) || !_recipient(receiver)) revert Invalid();
        _accrue();
        (uint256 collOut, uint256 repayShares, uint256 repayAssets, uint256 cashSharesOut, uint256 idleUOut, uint256 idleWOut) =
            _slice(shares);
        _burn(msg.sender, shares);
        if (repayShares != 0) {
            usdg.safeTransferFrom(msg.sender, address(this), repayAssets);
            repaid = _repayShares(repayShares, repayAssets);
            if (repaid < repayAssets) usdg.safeTransfer(msg.sender, repayAssets - repaid);
        }
        if (collOut != 0) morpho.withdrawCollateral(_mp(), collOut, address(this), receiver);
        if (idleWOut != 0) weth.safeTransfer(receiver, idleWOut);
        if (idleUOut != 0) usdg.safeTransfer(receiver, idleUOut);
        if (cashSharesOut != 0) IERC20(address(cash)).safeTransfer(receiver, cashSharesOut);
        wethOut = collOut + idleWOut;
        cashOut = cashSharesOut;
        emit ExitedInKind(msg.sender, receiver, shares, wethOut, cashSharesOut, repaid);
    }

    // ================================================================== rebalance (permissionless)

    /// @notice Moves the vault one slice toward the signal's target leverage. Anyone may call; the contract decides
    ///         whether, which way and how much. Above HARD_CAP it may be called at once, even with a stale signal.
    function rebalance() external nonReentrant returns (uint256 leverageAfter) {
        if (!bootstrapped) revert Invalid();
        _accrue();
        State memory s = state();
        if (s.nav == 0) revert Invalid();
        bool emergency = s.leverage > HARD_CAP;
        uint256 goal;
        uint16 slip;
        if (emergency) {
            goal = signal.isFresh() ? Math.min(signal.target(), signal.cap()) : signal.cap();
            slip = emergencySlipBps;
        } else {
            if (block.timestamp < uint256(lastRebalance) + minInterval) revert NotNeeded();
            if (!_poolAgrees(s.price, maxDivBps)) revert Divergence();
            if (signal.isFresh()) goal = signal.target();
            else if (_signalDead() && s.leverage > WAD) goal = WAD; // dead-man switch: de-risk only
            else revert Stale();
            uint256 gap = s.leverage > goal ? s.leverage - goal : goal - s.leverage;
            if (gap <= BAND) revert NotNeeded();
            slip = maxSlipBps;
        }
        uint256 exposure = _usdgOf(s.collateral + s.idleWeth, s.price);
        uint256 want = Math.mulDiv(goal, s.nav, WAD);
        int256 change;
        if (want > exposure) {
            // Dollars on hand first; the rest is borrowed through a free flash loan so collateral is in place before the
            // loan that pays it back (borrowing first could exceed the market's LLTV on a large step).
            uint256 amt = Math.min(want - exposure, maxSliceUsdg);
            uint256 own = Math.min(amt, s.idleUsdg + s.cashUsdg);
            if (own > s.idleUsdg) cash.withdraw(own - s.idleUsdg, address(this), address(this));
            uint256 borrowPart = Math.min(amt - own, _available());
            if (own + borrowPart == 0) revert Illiquid();
            if (borrowPart != 0) _flash(borrowPart, abi.encode(FLASH_LEVER, uint256(0), uint256(0), own, uint256(slip)));
            else _supplyCollateral(_swapBounded(false, own, s.price, slip));
            change = int256(own + borrowPart);
        } else {
            uint256 amt = Math.min(exposure - want, maxSliceUsdg);
            uint256 sellWeth = Math.min(Math.mulDiv(amt, ORACLE_SCALE, s.price), s.collateral + s.idleWeth);
            uint256 floor = Math.mulDiv(_usdgOf(sellWeth, s.price), 10_000 - slip, 10_000);
            if (s.debt == 0) {
                _releaseWeth(sellWeth, s.idleWeth);
                _swapBounded(true, sellWeth, s.price, slip);
            } else {
                uint256 repay = Math.min(s.debt, floor);
                _flash(repay, abi.encode(FLASH_DELEVER, uint256(0), sellWeth, uint256(slip), repay >= s.debt ? s.borrowShares : 0));
            }
            change = -int256(_usdgOf(sellWeth, s.price));
        }
        _sweepToCash();
        State memory a = state();
        _requireHealthy(a);
        lastRebalance = uint64(block.timestamp);
        leverageAfter = a.leverage;
        emit Rebalanced(s.leverage, goal, leverageAfter, change, emergency, msg.sender);
    }

    // ================================================================== fees

    /// @notice Mints the 10% performance fee on NAV-per-share gains above the high-water mark. Anyone may call, at most
    ///         once per FEE_PERIOD.
    function crystalliseFees() external nonReentrant returns (uint256 feeShares) {
        if (!bootstrapped || block.timestamp < uint256(lastFeeTime) + FEE_PERIOD) revert NotNeeded();
        _accrue();
        lastFeeTime = uint64(block.timestamp);
        uint256 supply = totalSupply();
        uint256 nav = state().nav;
        uint256 nps = Math.mulDiv(nav, WAD * WAD, supply);
        if (nps > highWaterMark) {
            uint256 gainUsdg = Math.mulDiv(nps - highWaterMark, supply, WAD * WAD);
            uint256 feeUsdg = gainUsdg * PERF_FEE_BPS / 10_000;
            if (feeUsdg != 0 && nav > feeUsdg) {
                feeShares = Math.mulDiv(feeUsdg, supply, nav - feeUsdg);
                _mint(feeRecipient, feeShares);
            }
            highWaterMark = navPerShare();
        }
        emit FeesCrystallised(nps, feeShares, highWaterMark);
    }

    // ================================================================== callbacks

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        if (msg.sender != address(morpho) || !_flashing) revert Unauthorized();
        (uint8 action, uint256 repayShares, uint256 wethAmount, uint256 extra, uint256 allShares) =
            abi.decode(data, (uint8, uint256, uint256, uint256, uint256));
        if (action == FLASH_WITHDRAW) {
            // extra = USDG already on hand from the withdrawer's cash slice
            _repayShares(repayShares, assets + extra);
            morpho.withdrawCollateral(_mp(), wethAmount, address(this), address(this));
            _swapExactOut(assets); // buy back exactly the flashed USDG with the released WETH
        } else if (action == FLASH_LEVER) {
            // extra = dollars already on hand; allShares carries the slippage bound
            uint256 price = IMorphoOracle(oracle).price();
            _supplyCollateral(_swapBounded(false, assets + extra, price, uint16(allShares)));
            morpho.borrow(_mp(), assets, 0, address(this), address(this));
        } else if (action == FLASH_DELEVER) {
            if (allShares != 0) _repayShares(allShares, assets);
            else {
                usdg.forceApprove(address(morpho), assets);
                morpho.repay(_mp(), assets, 0, address(this), "");
            }
            State memory s = state();
            _releaseWeth(wethAmount, s.idleWeth);
            uint256 out = _swapBounded(true, wethAmount, s.price, uint16(extra));
            if (out < assets) revert Slippage();
        } else {
            revert Invalid();
        }
        usdg.forceApprove(address(morpho), assets); // Morpho pulls the flash repayment after this returns
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != address(pool) || !_swapping) revert Unauthorized();
        if (amount0Delta > 0) weth.safeTransfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) usdg.safeTransfer(msg.sender, uint256(amount1Delta));
    }

    // ================================================================== internals

    function _slice(uint256 shares)
        internal
        view
        returns (uint256 collOut, uint256 repayShares, uint256 repayAssets, uint256 cashSharesOut, uint256 idleUOut, uint256 idleWOut)
    {
        uint256 supply = totalSupply();
        (, uint128 bs, uint128 coll) = morpho.position(marketId, address(this));
        collOut = Math.mulDiv(coll, shares, supply);
        repayShares = Math.min(Math.mulDiv(bs, shares, supply, Math.Rounding.Ceil), bs); // holders left behind never inherit debt
        repayAssets = _toAssetsUp(repayShares);
        cashSharesOut = Math.mulDiv(cash.balanceOf(address(this)), shares, supply);
        idleUOut = Math.mulDiv(usdg.balanceOf(address(this)), shares, supply);
        idleWOut = Math.mulDiv(weth.balanceOf(address(this)), shares, supply);
    }

    function _signalDead() internal view returns (bool) {
        return block.timestamp >= (signal.lastHour() + 1) * 1 hours + DEAD_SIGNAL;
    }

    function _releaseWeth(uint256 amount, uint256 idle) internal {
        if (amount > idle) morpho.withdrawCollateral(_mp(), amount - idle, address(this), address(this));
    }

    function _sweepToCash() internal {
        uint256 w = weth.balanceOf(address(this));
        if (w != 0) _supplyCollateral(w);
        uint256 u = usdg.balanceOf(address(this));
        if (u == 0) return;
        (, uint128 bs,) = morpho.position(marketId, address(this));
        if (bs != 0) {
            // spare dollars first pay down debt rather than sit in the dollar vault while borrowing
            uint256 owed = _toAssetsUp(bs);
            if (u >= owed) u -= _repayShares(bs, u);
            else {
                usdg.forceApprove(address(morpho), u);
                morpho.repay(_mp(), u, 0, address(this), "");
                u = 0;
            }
        }
        if (u != 0) {
            usdg.forceApprove(address(cash), u);
            cash.deposit(u, address(this));
        }
    }

    function _repayShares(uint256 shares, uint256 maxAssets) internal returns (uint256 paid) {
        usdg.forceApprove(address(morpho), maxAssets);
        (paid,) = morpho.repay(_mp(), 0, shares, address(this), "");
        usdg.forceApprove(address(morpho), 0);
    }

    function _supplyCollateral(uint256 amount) internal {
        if (amount == 0) return;
        weth.forceApprove(address(morpho), amount);
        morpho.supplyCollateral(_mp(), amount, address(this), "");
    }

    function _flash(uint256 amount, bytes memory data) internal {
        if (amount == 0) revert Invalid();
        _flashing = true;
        morpho.flashLoan(address(usdg), amount, data);
        _flashing = false;
        usdg.forceApprove(address(morpho), 0);
    }

    /// @dev Exact-input swap whose output must be within `slip` of the oracle value.
    function _swapBounded(bool wethIn, uint256 amountIn, uint256 price, uint16 slip) internal returns (uint256 out) {
        out = _swap(wethIn, amountIn);
        uint256 fair = wethIn ? _usdgOf(amountIn, price) : Math.mulDiv(amountIn, ORACLE_SCALE, price);
        if (out * 10_000 < fair * (10_000 - slip)) revert Slippage();
    }

    function _swap(bool wethIn, uint256 amountIn) internal returns (uint256 out) {
        if (amountIn == 0) return 0;
        _swapping = true;
        (int256 a0, int256 a1) = pool.swap(address(this), wethIn, int256(amountIn), wethIn ? MIN_SQRT : MAX_SQRT, "");
        _swapping = false;
        out = uint256(-(wethIn ? a1 : a0));
    }

    /// @dev Exact-output WETH -> USDG (used only to buy back a withdrawal's flash loan; the withdrawer's minEthOut bounds it).
    function _swapExactOut(uint256 usdgOut) internal {
        _swapping = true;
        (, int256 a1) = pool.swap(address(this), true, -int256(usdgOut), MIN_SQRT, "");
        _swapping = false;
        if (uint256(-a1) < usdgOut) revert Illiquid();
    }

    function _accrue() internal {
        morpho.accrueInterest(_mp());
    }

    function _available() internal view returns (uint256) {
        (uint128 tsa,, uint128 tba,,,) = morpho.market(marketId);
        return tsa > tba ? tsa - tba : 0;
    }

    function _toAssetsUp(uint256 shares) internal view returns (uint256) {
        if (shares == 0) return 0;
        (uint256 tba, uint256 tbs) = _expectedBorrow();
        return Math.mulDiv(shares, tba + VIRTUAL_ASSETS, tbs + VIRTUAL_SHARES, Math.Rounding.Ceil);
    }

    /// @dev Morpho's total borrow assets and shares as they will be after accrueInterest (MorphoBalancesLib logic).
    function _expectedBorrow() internal view returns (uint256 tba, uint256 tbs) {
        (uint128 a, uint128 b, uint128 c, uint128 d, uint128 e, uint128 f) = morpho.market(marketId);
        tba = c;
        tbs = d;
        uint256 elapsed = block.timestamp - e;
        if (elapsed == 0 || c == 0) return (tba, tbs);
        uint256 rate = IMorphoIrm(irm).borrowRateView(_mp(), MorphoMarket(a, b, c, d, e, f));
        uint256 first = rate * elapsed;
        uint256 second = Math.mulDiv(first, first, 2 * WAD);
        uint256 third = Math.mulDiv(second, first, 3 * WAD);
        tba += Math.mulDiv(tba, first + second + third, WAD);
    }

    function _usdgOf(uint256 wethAmount, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(wethAmount, price, ORACLE_SCALE);
    }

    /// @dev The pool's spot price must be within `bps` of the oracle (token0 WETH, token1 USDG).
    function _poolAgrees(uint256 price, uint256 bps) internal view returns (bool) {
        (uint160 sp,,,,,,) = pool.slot0();
        uint256 poolPrice = Math.mulDiv(Math.mulDiv(uint256(sp), uint256(sp), 1 << 96), ORACLE_SCALE, 1 << 96);
        uint256 hi = Math.max(poolPrice, price);
        uint256 lo = Math.min(poolPrice, price);
        return (hi - lo) * 10_000 <= hi * bps;
    }

    function _requireHealthy(State memory s) internal pure {
        uint256 collValue = _usdgOf(s.collateral, s.price);
        if (s.debt != 0 && s.debt * WAD > collValue * MAX_LTV_WAD) revert Unhealthy();
    }

    function _mp() internal view returns (MarketParams memory) {
        return MarketParams(address(usdg), address(weth), oracle, irm, lltv);
    }

    function _checkDeadline(uint256 deadline) internal view {
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE) revert Stale();
    }

    function _recipient(address a) internal view returns (bool) {
        return a != address(0) && a != address(this) && a != DEAD && a != address(weth) && a != address(usdg)
            && a != address(morpho) && a != address(pool) && a != address(cash);
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
}
