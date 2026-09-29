// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IUniswapV3PoolLike} from "./UniswapV3Types.sol";

interface ILiquiditySleeveV1 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function pool() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
    function tickLower() external view returns (int24);
    function tickUpper() external view returns (int24);
    function expectedFeeProtocol() external view returns (uint8);
    function fund(
        address funder,
        address receiver,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256 shares, uint128 liquidityAdded);
    function collectFees() external returns (uint256 amount0, uint256 amount1);
    function compound(uint256 amount0Min, uint256 amount1Min, uint128 minLiquidityAdded, uint256 deadline)
        external
        returns (uint128 liquidityAdded, uint256 amount0Used, uint256 amount1Used);
    function reband(
        int24 lower,
        int24 upper,
        uint256 amount0Min,
        uint256 amount1Min,
        uint128 minNewLiquidity,
        uint256 deadline
    ) external returns (uint256 tokenId, uint128 liquidity);
    function setManagementPaused(bool paused) external;
    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external;
}

interface ILiquidityIndexV1 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function bootstrapped() external view returns (bool);
    function weth() external view returns (address);
    function bootstrap(address receiver, uint256 initialShares) external;
    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external;
}

/// @notice Deterministic, protocol-controlled manager for the first HOODX LP index.
/// @dev Anyone may record a sustained edge condition. Only the curator may move liquidity, and only
///      after TWAP agreement, a dwell period and a per-pool cooldown all pass on-chain.
contract HoodxLiquidityControllerV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Policy {
        int24 halfWidth;
        int24 edgeBuffer;
        int24 maxTwapDeviation;
        int24 maxCenterMove;
        uint32 twapSeconds;
        uint32 breachDelay;
        uint32 cooldown;
        bool blockTokenDownside;
    }

    ILiquidityIndexV1 public immutable index;
    address public immutable curator;
    address public immutable activationAuthority;
    address public immutable bootstrapAuthority;
    address[] private _sleeves;
    Policy[] private _policies;
    mapping(uint256 => uint64) public breachSince;
    mapping(uint256 => uint64) public lastEdgeObservation;
    mapping(uint256 => uint64) public lastReband;
    bool public activated;

    uint256 public constant MAX_OBSERVATION_GAP = 30 minutes;

    error Unauthorized();
    error Invalid();
    error NotReady();
    error Divergence();

    event Activated(address indexed index, address indexed curator);
    event EdgeSignal(uint256 indexed sleeve, uint64 since, int24 spotTick, int24 twapTick);
    event EdgeCleared(uint256 indexed sleeve, int24 spotTick, int24 twapTick);
    event Rebanded(uint256 indexed sleeve, int24 lower, int24 upper, int24 spotTick, int24 twapTick);

    modifier onlyCurator() {
        if (msg.sender != curator || !activated) revert Unauthorized();
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
        index = ILiquidityIndexV1(index_);
        curator = curator_;
        activationAuthority = activationAuthority_;
        bootstrapAuthority = bootstrapAuthority_;
        for (uint256 i; i < sleeves_.length; ++i) {
            if (sleeves_[i].code.length == 0) revert Invalid();
            int24 spacing = ILiquiditySleeveV1(sleeves_[i]).tickSpacing();
            Policy memory p = policies_[i];
            if (
                p.halfWidth < spacing * 2 || p.halfWidth % spacing != 0 || p.edgeBuffer < spacing
                    || p.edgeBuffer >= p.halfWidth || p.maxTwapDeviation <= 0 || p.maxTwapDeviation >= p.halfWidth
                    || p.maxCenterMove < spacing || p.twapSeconds < 5 minutes || p.twapSeconds > 2 hours
                    || p.breachDelay < 15 minutes || p.breachDelay > 24 hours || p.cooldown < 1 hours
                    || p.cooldown > 7 days
            ) revert Invalid();
            _sleeves.push(sleeves_[i]);
            _policies.push(p);
        }
    }

    /// @notice Accepts ownership only after every exact contract has been reviewed and nominated.
    function activate() external nonReentrant {
        if (
            msg.sender != activationAuthority || activated || index.owner() != activationAuthority
                || index.pendingOwner() != address(this)
        ) {
            revert Unauthorized();
        }
        for (uint256 i; i < _sleeves.length; ++i) {
            ILiquiditySleeveV1 sleeve = ILiquiditySleeveV1(_sleeves[i]);
            if (sleeve.owner() != activationAuthority || sleeve.pendingOwner() != address(this)) revert Unauthorized();
        }
        index.acceptOwnership();
        for (uint256 i; i < _sleeves.length; ++i) {
            ILiquiditySleeveV1(_sleeves[i]).acceptOwnership();
        }
        activated = true;
        emit Activated(address(index), curator);
    }

    function sleeves() external view returns (address[] memory) {
        return _sleeves;
    }

    function policy(uint256 sleeveIndex) external view returns (Policy memory) {
        if (sleeveIndex >= _policies.length) revert Invalid();
        return _policies[sleeveIndex];
    }

    function seedSleeve(
        uint256 sleeveIndex,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external nonReentrant returns (uint256 shares, uint128 liquidityAdded) {
        if (!activated || msg.sender != bootstrapAuthority) revert Unauthorized();
        // Adding sleeve shares after index issuance would require full NAV accounting and would
        // dilute holders. V1 therefore makes the reviewed seed a one-time pre-bootstrap operation.
        if (sleeveIndex >= _sleeves.length || index.bootstrapped()) revert Invalid();
        (shares, liquidityAdded) = ILiquiditySleeveV1(_sleeves[sleeveIndex])
            .fund(msg.sender, address(index), amount0Desired, amount1Desired, amount0Min, amount1Min, deadline);
        if (lastReband[sleeveIndex] == 0) lastReband[sleeveIndex] = uint64(block.timestamp);
    }

    function bootstrap(address receiver, uint256 initialShares) external nonReentrant {
        if (!activated || msg.sender != bootstrapAuthority) revert Unauthorized();
        index.bootstrap(receiver, initialShares);
    }

    function harvest(uint256 sleeveIndex) external onlyCurator nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (sleeveIndex >= _sleeves.length) revert Invalid();
        return ILiquiditySleeveV1(_sleeves[sleeveIndex]).collectFees();
    }

    function compound(
        uint256 sleeveIndex,
        uint256 amount0Min,
        uint256 amount1Min,
        uint128 minLiquidityAdded,
        uint256 deadline
    ) external onlyCurator nonReentrant returns (uint128 liquidityAdded, uint256 amount0Used, uint256 amount1Used) {
        if (sleeveIndex >= _sleeves.length) revert Invalid();
        return ILiquiditySleeveV1(_sleeves[sleeveIndex]).compound(amount0Min, amount1Min, minLiquidityAdded, deadline);
    }

    /// @notice Records when price first remains near/outside a configured range edge.
    function signal(uint256 sleeveIndex) external returns (bool ready) {
        (ILiquiditySleeveV1 sleeve, Policy memory p, int24 spot, int24 twap) = _state(sleeveIndex);
        if (_absDiff(spot, twap) > uint24(p.maxTwapDeviation)) revert Divergence();
        // The dwell timer follows the manipulation-resistant TWAP. Spot is only a divergence guard,
        // so a one-block trade cannot cheaply start or clear the timer.
        bool atEdge = twap <= sleeve.tickLower() + p.edgeBuffer || twap >= sleeve.tickUpper() - p.edgeBuffer;
        if (!atEdge) {
            if (breachSince[sleeveIndex] != 0) emit EdgeCleared(sleeveIndex, spot, twap);
            breachSince[sleeveIndex] = 0;
            lastEdgeObservation[sleeveIndex] = 0;
            return false;
        }
        uint64 last = lastEdgeObservation[sleeveIndex];
        if (breachSince[sleeveIndex] == 0 || last == 0 || block.timestamp > uint256(last) + MAX_OBSERVATION_GAP) {
            breachSince[sleeveIndex] = uint64(block.timestamp);
        }
        lastEdgeObservation[sleeveIndex] = uint64(block.timestamp);
        emit EdgeSignal(sleeveIndex, breachSince[sleeveIndex], spot, twap);
        ready = block.timestamp >= uint256(breachSince[sleeveIndex]) + p.breachDelay
            && block.timestamp >= uint256(lastReband[sleeveIndex]) + p.cooldown;
    }

    function executeReband(
        uint256 sleeveIndex,
        uint256 amount0Min,
        uint256 amount1Min,
        uint128 minNewLiquidity,
        uint256 deadline
    ) external onlyCurator nonReentrant returns (int24 lower, int24 upper) {
        (ILiquiditySleeveV1 sleeve, Policy memory p, int24 spot, int24 twap) = _state(sleeveIndex);
        uint64 since = breachSince[sleeveIndex];
        uint64 last = lastEdgeObservation[sleeveIndex];
        if (
            since == 0 || last == 0 || block.timestamp > uint256(last) + MAX_OBSERVATION_GAP
                || block.timestamp < uint256(since) + p.breachDelay
                || block.timestamp < uint256(lastReband[sleeveIndex]) + p.cooldown
        ) revert NotReady();
        if (_absDiff(spot, twap) > uint24(p.maxTwapDeviation)) revert Divergence();
        if (twap > sleeve.tickLower() + p.edgeBuffer && twap < sleeve.tickUpper() - p.edgeBuffer) revert NotReady();

        int24 spacing = sleeve.tickSpacing();
        int24 center = _nearestUsableTick(twap, spacing);
        int24 oldCenter = (sleeve.tickLower() + sleeve.tickUpper()) / 2;
        if (_absDiff(center, oldCenter) > uint24(p.maxCenterMove)) revert Divergence();
        if (p.blockTokenDownside) {
            address quote = index.weth();
            if (sleeve.token0() != quote && sleeve.token1() != quote) revert Invalid();
            // Tick is token1/token0. When WETH is token0, a higher tick means the paired token
            // is cheaper in WETH; when WETH is token1, a lower tick means the paired token is cheaper.
            bool tokenPriceFell = sleeve.token0() == quote ? center > oldCenter : center < oldCenter;
            if (tokenPriceFell) revert Divergence();
        }
        lower = center - p.halfWidth;
        upper = center + p.halfWidth;
        sleeve.reband(lower, upper, amount0Min, amount1Min, minNewLiquidity, deadline);
        breachSince[sleeveIndex] = 0;
        lastEdgeObservation[sleeveIndex] = 0;
        lastReband[sleeveIndex] = uint64(block.timestamp);
        emit Rebanded(sleeveIndex, lower, upper, spot, twap);
    }

    function setManagementPaused(bool paused) external onlyCurator {
        for (uint256 i; i < _sleeves.length; ++i) {
            ILiquiditySleeveV1(_sleeves[i]).setManagementPaused(paused);
        }
    }

    /// @notice Recovers only assets that are neither WETH nor a configured sleeve.
    function rescueIndexToken(address token, address receiver, uint256 amount) external onlyCurator nonReentrant {
        index.rescueUnexpectedToken(token, receiver, amount);
    }

    /// @notice Recovers only assets that are neither underlying token of the selected sleeve.
    function rescueSleeveToken(uint256 sleeveIndex, address token, address receiver, uint256 amount)
        external
        onlyCurator
        nonReentrant
    {
        if (sleeveIndex >= _sleeves.length) revert Invalid();
        ILiquiditySleeveV1(_sleeves[sleeveIndex]).rescueUnexpectedToken(token, receiver, amount);
    }

    function _state(uint256 sleeveIndex)
        internal
        view
        returns (ILiquiditySleeveV1 sleeve, Policy memory p, int24 spot, int24 twap)
    {
        if (sleeveIndex >= _sleeves.length) revert Invalid();
        sleeve = ILiquiditySleeveV1(_sleeves[sleeveIndex]);
        p = _policies[sleeveIndex];
        IUniswapV3PoolLike pool = IUniswapV3PoolLike(sleeve.pool());
        (,,,,, uint8 feeProtocol,) = pool.slot0();
        if (feeProtocol != sleeve.expectedFeeProtocol()) revert Divergence();
        (, spot,,,,,) = pool.slot0();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = p.twapSeconds;
        secondsAgos[1] = 0;
        (int56[] memory cumulative,) = pool.observe(secondsAgos);
        int56 delta = cumulative[1] - cumulative[0];
        twap = int24(delta / int56(uint56(p.twapSeconds)));
        if (delta < 0 && delta % int56(uint56(p.twapSeconds)) != 0) --twap;
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint24) {
        int256 d = int256(a) - int256(b);
        return uint24(uint256(d < 0 ? -d : d));
    }

    function _nearestUsableTick(int24 tick, int24 spacing) internal pure returns (int24 center) {
        int24 remainder = tick % spacing;
        center = tick - remainder;
        if (remainder >= spacing / 2) center += spacing;
        if (remainder <= -(spacing / 2)) center -= spacing;
    }
}
