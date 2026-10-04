// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3} from "./BoostTypes.sol";

/// @notice HOODX Boosted ETH signal: the strategy's brain, fully on-chain, with no owner and no parameters to change.
/// @dev Research basis: docs/SMART-ETH-HIGH-VARIANT-2026-10-04.md (ETH 2016-26, BTC and SOL cross-checks, walk-forward,
///      Monte Carlo). Once an hour anyone may `poke()`: the contract reads Chainlink ETH/USD and BTC/USD and updates
///        - 8 EMAs per asset: slow 20/50/100/200 days, fast 5/10/20/50 days (alpha = 2/(hours+1));
///        - one hysteresis flag per EMA (on above EMA*1.01, off below EMA*0.99, otherwise unchanged);
///        - an EWMA of squared hourly ETH returns (14-day half-life).
///      target() = min(CAP, slow + (slow >= GATE ? fast * max(0, min(CAP, TV/sigma) - 1) : 0)), where slow/fast are the
///      share of flags that are on, averaged 50/50 between ETH and BTC, and sigma is ETH's annualised volatility.
///      A missed hour (keeper outage) is applied in closed form: each EMA decays by (1-alpha)^k toward the current price
///      and the return over the gap is spread evenly over its k hours. The initial state is seeded at deployment from
///      published history (reproducible with research/ethlev/boost_seed.py) and checked against the live feeds.
contract HoodxBoostSignalV1 {
    uint256 public constant WAD = 1e18;
    uint256 public constant CAP = 2e18;          // leverage cap 2.0x
    uint256 public constant TV = 2.4e18;         // volatility target 240% (booster sizing)
    uint256 public constant GATE = 0.75e18;      // booster only while the slow trend is >= 75% on
    uint256 public constant HYST_BPS = 100;      // 1% hysteresis
    uint256 public constant HOURS_PER_YEAR = 8760;
    uint256 public constant MAX_GAP_HOURS = 168; // a gap longer than a week is applied as one week
    uint256 public constant FRESH_HOURS = 2;     // the vault only acts on a signal poked within ~2 hours
    /// @dev 1 - 0.5^(1/336): EWMA weight of one hourly squared return for a 14-day half-life.
    uint256 public constant VOL_ALPHA = 2_060_811_643_165_591;
    uint256 internal constant PRICE_SCALE = 1e10; // Chainlink 8 decimals -> 18 decimals

    IAggregatorV3 public immutable ethFeed;
    IAggregatorV3 public immutable btcFeed;
    uint256 public immutable ethMaxStale;
    uint256 public immutable btcMaxStale;

    struct AssetState {
        uint128[8] ema; // [0..3] slow 20/50/100/200d, [4..7] fast 5/10/20/50d, 18-decimal USD prices
        uint8 flags;    // bit i set = price is above ema[i] (with hysteresis)
    }

    AssetState internal _eth;
    AssetState internal _btc;
    uint256 public ethVar;      // EWMA of squared hourly ETH returns, WAD
    uint256 public ethLast;     // last ETH price used, 18 decimals
    uint256 public lastHour;    // block.timestamp / 1 hours at the last update

    error Invalid();
    error TooSoon();
    error BadFeed();

    event Seeded(uint256 ethPrice, uint8 ethFlags, uint8 btcFlags, uint256 ethVar);
    event Poked(uint256 indexed hour, uint256 hoursApplied, uint256 ethPrice, uint256 btcPrice, uint8 ethFlags, uint8 btcFlags, uint256 target, address indexed by);

    constructor(
        address ethFeed_,
        address btcFeed_,
        uint256 ethMaxStale_,
        uint256 btcMaxStale_,
        uint128[8] memory ethEma,
        uint128[8] memory btcEma,
        uint8 ethFlags,
        uint8 btcFlags,
        uint256 ethVar_,
        uint256 ethLast_,
        uint256 btcLast_
    ) {
        if (
            ethFeed_.code.length == 0 || btcFeed_.code.length == 0 || ethMaxStale_ < 1 hours || ethMaxStale_ > 2 days
                || btcMaxStale_ < 1 hours || btcMaxStale_ > 2 days || ethVar_ == 0 || ethVar_ > 1e16
        ) revert Invalid();
        ethFeed = IAggregatorV3(ethFeed_);
        btcFeed = IAggregatorV3(btcFeed_);
        ethMaxStale = ethMaxStale_;
        btcMaxStale = btcMaxStale_;
        if (IAggregatorV3(ethFeed_).decimals() != 8 || IAggregatorV3(btcFeed_).decimals() != 8) revert Invalid();
        for (uint256 i; i < 8; ++i) {
            if (ethEma[i] == 0 || btcEma[i] == 0) revert Invalid();
        }
        // The seed must describe the market as it is now: its last prices within 3% of the live feeds.
        uint256 pe = _read(ethFeed, ethMaxStale);
        uint256 pb = _read(btcFeed, btcMaxStale);
        if (!_near(pe, ethLast_, 300) || !_near(pb, btcLast_, 300)) revert Invalid();
        _eth.ema = ethEma;
        _eth.flags = ethFlags;
        _btc.ema = btcEma;
        _btc.flags = btcFlags;
        ethVar = ethVar_;
        ethLast = ethLast_;
        lastHour = block.timestamp / 1 hours;
        emit Seeded(ethLast_, ethFlags, btcFlags, ethVar_);
    }

    // ------------------------------------------------------------------ crank

    /// @notice Updates the signal from Chainlink once per clock hour. Anyone may call.
    function poke() external returns (uint256 newTarget) {
        uint256 hour = block.timestamp / 1 hours;
        if (hour <= lastHour) revert TooSoon();
        uint256 k = hour - lastHour;
        if (k > MAX_GAP_HOURS) k = MAX_GAP_HOURS;
        uint256 pe = _read(ethFeed, ethMaxStale);
        uint256 pb = _read(btcFeed, btcMaxStale);
        // A move beyond 3x either way in one update is treated as a broken feed, never as a price.
        if (pe > ethLast * 3 || pe * 3 < ethLast) revert BadFeed();

        // volatility: r ~ ln(p/q) as 2(p-q)/(p+q) (error O(r^3)), spread evenly over the k hours of the gap
        uint256 diff = pe > ethLast ? pe - ethLast : ethLast - pe;
        uint256 r = Math.mulDiv(2 * diff, WAD, pe + ethLast);
        uint256 r2PerHour = Math.mulDiv(r, r, WAD) / k;
        uint256 keep = _powWad(WAD - VOL_ALPHA, k);
        ethVar = Math.mulDiv(ethVar, keep, WAD) + Math.mulDiv(r2PerHour, WAD - keep, WAD);
        ethLast = pe;

        _update(_eth, pe, k);
        _update(_btc, pb, k);
        lastHour = hour;
        newTarget = target();
        emit Poked(hour, k, pe, pb, _eth.flags, _btc.flags, newTarget, msg.sender);
    }

    // ------------------------------------------------------------------ views

    /// @notice Target leverage (WAD; 1e18 = 1x ETH). 0 = all dollars, 1 = all ETH, 2 = 2x ETH.
    function target() public view returns (uint256) {
        uint256 slow = (_count(_eth.flags & 0x0f) + _count(_btc.flags & 0x0f)) * WAD / 8;
        uint256 fast = (_count(_eth.flags >> 4) + _count(_btc.flags >> 4)) * WAD / 8;
        uint256 lev = slow;
        if (slow >= GATE) {
            uint256 s = sigma();
            uint256 volCap = s == 0 ? CAP : Math.min(CAP, Math.mulDiv(TV, WAD, s));
            if (volCap > WAD) lev += Math.mulDiv(volCap - WAD, fast, WAD);
        }
        return Math.min(lev, CAP);
    }

    /// @notice ETH's annualised volatility estimate (WAD; 0.8e18 = 80%).
    function sigma() public view returns (uint256) {
        return Math.sqrt(ethVar * HOURS_PER_YEAR * WAD);
    }

    function cap() external pure returns (uint256) {
        return CAP;
    }

    function isFresh() external view returns (bool) {
        return block.timestamp / 1 hours - lastHour <= FRESH_HOURS;
    }

    /// @notice Everything a dashboard needs in one call.
    function snapshot()
        external
        view
        returns (
            uint256 target_,
            uint256 sigma_,
            uint8 ethFlags,
            uint8 btcFlags,
            uint128[8] memory ethEma,
            uint128[8] memory btcEma,
            uint256 ethLast_,
            uint256 lastHour_
        )
    {
        return (target(), sigma(), _eth.flags, _btc.flags, _eth.ema, _btc.ema, ethLast, lastHour);
    }

    /// @notice Span of EMA i in hours: 0-3 slow (20/50/100/200 days), 4-7 fast (5/10/20/50 days).
    function spanHours(uint256 i) public pure returns (uint256) {
        if (i == 0) return 480;
        if (i == 1) return 1200;
        if (i == 2) return 2400;
        if (i == 3) return 4800;
        if (i == 4) return 120;
        if (i == 5) return 240;
        if (i == 6) return 480;
        if (i == 7) return 1200;
        revert Invalid();
    }

    // ------------------------------------------------------------------ internals

    function _update(AssetState storage s, uint256 p, uint256 k) internal {
        uint8 flags = s.flags;
        for (uint256 i; i < 8; ++i) {
            uint256 keep = _powWad(WAD - 2 * WAD / (spanHours(i) + 1), k);
            uint256 e = Math.mulDiv(s.ema[i], keep, WAD) + Math.mulDiv(p, WAD - keep, WAD);
            s.ema[i] = uint128(e);
            if (p * 10_000 > e * (10_000 + HYST_BPS)) flags |= uint8(1 << i);
            else if (p * 10_000 < e * (10_000 - HYST_BPS)) flags &= ~uint8(1 << i);
        }
        s.flags = flags;
    }

    function _read(IAggregatorV3 feed, uint256 maxStale) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxStale) revert BadFeed();
        return uint256(answer) * PRICE_SCALE;
    }

    function _near(uint256 a, uint256 b, uint256 bps) internal pure returns (bool) {
        uint256 hi = Math.max(a, b);
        uint256 lo = Math.min(a, b);
        return (hi - lo) * 10_000 <= hi * bps;
    }

    function _count(uint8 x) internal pure returns (uint256 n) {
        while (x != 0) {
            n += x & 1;
            x >>= 1;
        }
    }

    /// @dev x^n in WAD fixed point (x <= 1e18), by squaring.
    function _powWad(uint256 x, uint256 n) internal pure returns (uint256 r) {
        r = WAD;
        while (n != 0) {
            if (n & 1 != 0) r = Math.mulDiv(r, x, WAD);
            x = Math.mulDiv(x, x, WAD);
            n >>= 1;
        }
    }
}
