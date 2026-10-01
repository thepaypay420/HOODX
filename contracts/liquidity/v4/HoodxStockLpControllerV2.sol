// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceReference} from "./V4Types.sol";

interface IStockSleeveV2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
    function tickLower() external view returns (int24);
    function tickUpper() external view returns (int24);
    function positionLiquidity() external view returns (uint128);
    function spot() external view returns (uint160 sqrtPriceX96, int24 tick);
    function fund(address funder, address receiver, uint128 liquidity, uint256 max0, uint256 max1, uint256 deadline)
        external
        returns (uint256 shares);
    function collectFees() external returns (uint256 amount0, uint256 amount1);
    function compoundMax(uint256 deadline) external returns (uint128 added, uint256 used0, uint256 used1);
    function rebandMax(int24 newLower, int24 newUpper, uint256 deadline) external returns (uint128 newLiquidity);
    function setManagementPaused(bool paused) external;
    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external;
}

interface IStockLpIndexV2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function bootstrapped() external view returns (bool);
    function weth() external view returns (address);
    function bootstrap(address receiver, uint256 initialShares) external;
    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external;
}

/// @notice Deterministic manager for a HOODX stock-token LP index (USDG-quoted Uniswap V4 sleeves).
/// @dev Research basis: docs/HUNTX-VAULT-STRATEGY-RESEARCH-2026-09-30.md. Narrow ranges, no swaps,
///      one-sided "maker" rebands after a sustained breach. V4 unhooked pools have no TWAP, so every
///      price-sensitive step requires the pool spot to agree with an independent reference
///      (e.g. HOODX CL TWAPs over the stock token's V3 pools).
///      V2 "autopilot": every operational step is a permissionless crank. Anyone (normally the keeper bot)
///      may record breaches, harvest, compound and reband, but only when the on-chain rules allow (dwell,
///      cooldown, reference agreement) and with amounts the sleeve computes from its own balances, so the
///      caller chooses nothing. The curator keeps only pause and rescue of unrelated tokens.
contract HoodxStockLpControllerV2 is ReentrancyGuard {
    struct Policy {
        int24 halfWidth;            // initial/centered half-width in ticks (≈ ±2.5% at 250)
        int24 makerWidth;           // total width of a one-sided reband range in ticks
        uint16 maxDivergenceBps;    // pool spot vs reference price
        uint32 breachDelay;         // continuous out-of-range time before a reband
        uint32 cooldown;            // minimum time between rebands
        IPriceReference priceRef;  // independent price of the non-quote token in the quote asset
        uint8 tokenDecimals;        // decimals of the non-quote token
        uint8 quoteDecimals;        // decimals of the quote asset
    }

    /// @dev A breach stays continuous while observed at least this often (keeper cadence: hourly).
    uint256 public constant MAX_OBSERVATION_GAP = 2 hours;
    uint256 private constant BPS = 10_000;

    IStockLpIndexV2 public immutable index;
    address public immutable quote;
    address public immutable curator;
    address public immutable activationAuthority;
    address public immutable bootstrapAuthority;
    address[] private _sleeves;
    Policy[] private _policies;
    mapping(uint256 => uint64) public breachSince;
    mapping(uint256 => uint64) public lastObservation;
    mapping(uint256 => uint64) public lastReband;
    bool public activated;

    error Unauthorized();
    error Invalid();
    error NotReady();
    error Divergence();

    event Activated(address indexed index, address indexed curator);
    event BreachSignal(uint256 indexed sleeve, uint64 since, int24 spotTick);
    event BreachCleared(uint256 indexed sleeve, int24 spotTick);
    event Rebanded(uint256 indexed sleeve, int24 lower, int24 upper, uint128 liquidity, bool oneSided);

    modifier onlyCurator() {
        if (msg.sender != curator || !activated) revert Unauthorized();
        _;
    }

    modifier onlyActive() {
        if (!activated) revert Unauthorized();
        _;
    }

    constructor(
        address index_,
        address curator_,
        address activationAuthority_,
        address bootstrapAuthority_,
        address[] memory sleeves_,
        Policy[] memory policies_
    ) {
        if (
            index_.code.length == 0 || curator_ == address(0) || activationAuthority_ == address(0)
                || bootstrapAuthority_ == address(0) || sleeves_.length == 0 || sleeves_.length != policies_.length
                || sleeves_.length > 8
        ) revert Invalid();
        index = IStockLpIndexV2(index_);
        quote = IStockLpIndexV2(index_).weth();
        curator = curator_;
        activationAuthority = activationAuthority_;
        bootstrapAuthority = bootstrapAuthority_;
        for (uint256 i; i < sleeves_.length; ++i) {
            IStockSleeveV2 sleeve = IStockSleeveV2(sleeves_[i]);
            if (address(sleeve).code.length == 0) revert Invalid();
            if (sleeve.token0() != quote && sleeve.token1() != quote) revert Invalid();
            int24 spacing = sleeve.tickSpacing();
            Policy memory p = policies_[i];
            if (
                p.halfWidth < spacing || p.halfWidth % spacing != 0 || p.makerWidth < spacing
                    || p.makerWidth % spacing != 0 || p.maxDivergenceBps == 0 || p.maxDivergenceBps > 500
                    || p.breachDelay < 15 minutes || p.breachDelay > 3 days || p.cooldown < 1 hours
                    || p.cooldown > 7 days || address(p.priceRef).code.length == 0
            ) revert Invalid();
            for (uint256 j; j < i; ++j) {
                if (_sleeves[j] == sleeves_[i]) revert Invalid();
            }
            _sleeves.push(sleeves_[i]);
            _policies.push(p);
        }
    }

    function activate() external nonReentrant {
        if (
            msg.sender != activationAuthority || activated || index.owner() != activationAuthority
                || index.pendingOwner() != address(this)
        ) revert Unauthorized();
        for (uint256 i; i < _sleeves.length; ++i) {
            IStockSleeveV2 s = IStockSleeveV2(_sleeves[i]);
            if (s.owner() != activationAuthority || s.pendingOwner() != address(this)) revert Unauthorized();
        }
        index.acceptOwnership();
        for (uint256 i; i < _sleeves.length; ++i) {
            IStockSleeveV2(_sleeves[i]).acceptOwnership();
        }
        activated = true;
        emit Activated(address(index), curator);
    }

    function sleeves() external view returns (address[] memory) {
        return _sleeves;
    }

    function policy(uint256 i) external view returns (Policy memory) {
        if (i >= _policies.length) revert Invalid();
        return _policies[i];
    }

    // ------------------------------------------------------------------ seeding (pre-bootstrap only)

    function seedSleeve(uint256 i, uint128 liquidity, uint256 max0, uint256 max1, uint256 deadline)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (!activated || msg.sender != bootstrapAuthority) revert Unauthorized();
        // Post-bootstrap funding would need NAV accounting and could dilute holders (as in V1).
        if (i >= _sleeves.length || index.bootstrapped()) revert Invalid();
        _requireAgreement(i);
        shares = IStockSleeveV2(_sleeves[i]).fund(msg.sender, address(index), liquidity, max0, max1, deadline);
        if (lastReband[i] == 0) lastReband[i] = uint64(block.timestamp);
    }

    function bootstrap(address receiver, uint256 initialShares) external nonReentrant {
        if (!activated || msg.sender != bootstrapAuthority) revert Unauthorized();
        index.bootstrap(receiver, initialShares);
    }

    // ------------------------------------------------------------------ permissionless cranks (autopilot)

    /// @notice Realizes accrued LP fees into the sleeve (performance fee set aside). Anyone may call.
    function harvest(uint256 i) external onlyActive nonReentrant returns (uint256 a0, uint256 a1) {
        if (i >= _sleeves.length) revert Invalid();
        return IStockSleeveV2(_sleeves[i]).collectFees();
    }

    /// @notice Reinvests the sleeve's idle balances into its current range (amount computed by the sleeve).
    ///         Anyone may call; requires reference agreement.
    function compound(uint256 i) external onlyActive nonReentrant returns (uint128 added) {
        _requireAgreement(i);
        (added,,) = IStockSleeveV2(_sleeves[i]).compoundMax(block.timestamp);
    }

    /// @notice Records breaches for every sleeve in one call; sleeves whose reference disagrees are skipped.
    function signalAll() external onlyActive returns (uint256 readyMask) {
        for (uint256 i; i < _sleeves.length; ++i) {
            if (_agrees(i)) {
                (, int24 tick) = IStockSleeveV2(_sleeves[i]).spot();
                if (_signal(i, IStockSleeveV2(_sleeves[i]), tick)) readyMask |= 1 << i;
            }
        }
    }

    /// @notice Records when the pool price is, and stays, outside the sleeve's range.
    /// @dev Reverts on reference disagreement, so a manipulated spot cannot start or refresh the timer.
    function signal(uint256 i) external onlyActive returns (bool ready) {
        (IStockSleeveV2 sleeve, int24 tick) = _requireAgreement(i);
        return _signal(i, sleeve, tick);
    }

    function _signal(uint256 i, IStockSleeveV2 sleeve, int24 tick) internal returns (bool ready) {
        bool outside = tick < sleeve.tickLower() || tick >= sleeve.tickUpper();
        if (!outside) {
            if (breachSince[i] != 0) emit BreachCleared(i, tick);
            breachSince[i] = 0;
            lastObservation[i] = 0;
            return false;
        }
        uint64 last = lastObservation[i];
        if (breachSince[i] == 0 || last == 0 || block.timestamp > uint256(last) + MAX_OBSERVATION_GAP) {
            breachSince[i] = uint64(block.timestamp);
        }
        lastObservation[i] = uint64(block.timestamp);
        emit BreachSignal(i, breachSince[i], tick);
        ready = _ready(i);
    }

    /// @notice One-sided "maker" reband: all balances into a range adjacent to price on the side the
    ///         sleeve already holds. No swap. Anyone may call once the breach has lasted `breachDelay`
    ///         and the cooldown has passed; the sleeve computes the liquidity from its own balances.
    function executeReband(uint256 i) external onlyActive nonReentrant returns (int24 lower, int24 upper) {
        (IStockSleeveV2 sleeve, int24 tick) = _requireAgreement(i);
        uint64 last = lastObservation[i];
        if (breachSince[i] == 0 || last == 0 || block.timestamp > uint256(last) + MAX_OBSERVATION_GAP || !_ready(i)) {
            revert NotReady();
        }
        Policy memory p = _policies[i];
        int24 spacing = sleeve.tickSpacing();
        if (tick >= sleeve.tickUpper()) {
            // Price moved up through the range: the sleeve holds token1. Token1-only range below price.
            upper = _floor(tick, spacing);
            if (upper > tick) upper -= spacing;
            lower = upper - p.makerWidth;
        } else if (tick < sleeve.tickLower()) {
            // Price moved down through the range: the sleeve holds token0. Token0-only range above price.
            lower = _floor(tick, spacing) + spacing;
            upper = lower + p.makerWidth;
        } else {
            revert NotReady();
        }
        // A price that only just crossed the edge maps back onto the current range: nothing to do.
        if (lower == sleeve.tickLower() && upper == sleeve.tickUpper()) revert NotReady();
        uint128 newLiquidity = sleeve.rebandMax(lower, upper, block.timestamp);
        breachSince[i] = 0;
        lastObservation[i] = 0;
        lastReband[i] = uint64(block.timestamp);
        emit Rebanded(i, lower, upper, newLiquidity, true);
    }

    function setManagementPaused(bool paused) external onlyCurator {
        for (uint256 i; i < _sleeves.length; ++i) {
            IStockSleeveV2(_sleeves[i]).setManagementPaused(paused);
        }
    }

    function rescueIndexToken(address token, address receiver, uint256 amount) external onlyCurator nonReentrant {
        index.rescueUnexpectedToken(token, receiver, amount);
    }

    function rescueSleeveToken(uint256 i, address token, address receiver, uint256 amount)
        external
        onlyCurator
        nonReentrant
    {
        if (i >= _sleeves.length) revert Invalid();
        IStockSleeveV2(_sleeves[i]).rescueUnexpectedToken(token, receiver, amount);
    }

    // ------------------------------------------------------------------ views / internals

    /// @notice Pool spot vs reference, in basis points (reverts if the reference is unavailable).
    function divergenceBps(uint256 i) public view returns (uint256) {
        if (i >= _sleeves.length) revert Invalid();
        IStockSleeveV2 sleeve = IStockSleeveV2(_sleeves[i]);
        Policy memory p = _policies[i];
        (uint160 sqrtP,) = sleeve.spot();
        address token = sleeve.token0() == quote ? sleeve.token1() : sleeve.token0();
        uint256 unit = 10 ** p.tokenDecimals;
        uint256 refValue = p.priceRef.value(token, unit);           // quote units per 1 token
        if (refValue == 0) revert Divergence();
        // Pool price of one token, in raw quote units: token1/token0 = sqrtP^2 / 2^192.
        uint256 poolValue = sleeve.token0() == quote
            ? Math.mulDiv(Math.mulDiv(unit, uint256(1) << 96, uint256(sqrtP)), uint256(1) << 96, uint256(sqrtP))
            : Math.mulDiv(Math.mulDiv(unit, uint256(sqrtP), uint256(1) << 96), uint256(sqrtP), uint256(1) << 96);
        uint256 hi = Math.max(poolValue, refValue);
        uint256 lo = Math.min(poolValue, refValue);
        return Math.mulDiv(hi - lo, BPS, hi);
    }

    /// @notice Everything a keeper or dashboard needs for sleeve `i`.
    function status(uint256 i)
        external
        view
        returns (bool inRange, bool referenceAgrees, uint64 breachStart, uint64 lastSeen, bool rebandReady, int24 tick)
    {
        if (i >= _sleeves.length) revert Invalid();
        IStockSleeveV2 sleeve = IStockSleeveV2(_sleeves[i]);
        (, tick) = sleeve.spot();
        inRange = tick >= sleeve.tickLower() && tick < sleeve.tickUpper();
        referenceAgrees = _agrees(i);
        breachStart = breachSince[i];
        lastSeen = lastObservation[i];
        rebandReady = !inRange && referenceAgrees && breachStart != 0 && lastSeen != 0
            && block.timestamp <= uint256(lastSeen) + MAX_OBSERVATION_GAP && _ready(i);
    }

    /// @dev Reference agreement without reverting (an unavailable reference counts as disagreement).
    function _agrees(uint256 i) internal view returns (bool) {
        try this.divergenceBps(i) returns (uint256 bps) {
            return bps <= _policies[i].maxDivergenceBps;
        } catch {
            return false;
        }
    }

    function _requireAgreement(uint256 i) internal view returns (IStockSleeveV2 sleeve, int24 tick) {
        if (i >= _sleeves.length) revert Invalid();
        if (divergenceBps(i) > _policies[i].maxDivergenceBps) revert Divergence();
        sleeve = IStockSleeveV2(_sleeves[i]);
        (, tick) = sleeve.spot();
    }

    function _ready(uint256 i) internal view returns (bool) {
        Policy memory p = _policies[i];
        return block.timestamp >= uint256(breachSince[i]) + p.breachDelay
            && block.timestamp >= uint256(lastReband[i]) + p.cooldown;
    }

    function _floor(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 c = tick / spacing * spacing;
        if (tick < 0 && tick % spacing != 0) c -= spacing;
        return c;
    }
}
