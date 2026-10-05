// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ILensBoostVault {
    struct State {
        uint256 price;
        uint256 collateral;
        uint256 borrowShares;
        uint256 debt;
        uint256 cashShares;
        uint256 cashUsdg;
        uint256 idleUsdg;
        uint256 idleWeth;
        uint256 nav;
        uint256 leverage;
    }

    function state() external view returns (State memory);
}

interface ILensStockLpVault {
    struct Holding {
        address sleeve;
        address stock;
        uint256 sleeveShares;
        uint256 sleeveSupply;
        int24 tickLower;
        int24 tickUpper;
        int24 tick;
        uint128 positionLiquidity;
    }

    function holdings() external view returns (Holding[] memory);
}

interface ILensSleeve {
    function spot() external view returns (uint160 sqrtPriceX96, int24 tick);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function feeOwed0() external view returns (uint256);
    function feeOwed1() external view returns (uint256);
}

interface ILensIndexVault {
    function totalSupply() external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function constituents() external view returns (address[] memory);
    function freeBalance(address token) external view returns (uint256);
    function weth() external view returns (address);
    function owner() external view returns (address);
}

interface ILensQuoter {
    function quoteRebalance(address token, bool buy, uint256 amount) external payable;
}

interface ILensStateView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface ILensERC20 {
    function balanceOf(address) external view returns (uint256);
}

/// @title HoodxVaultLens
/// @notice Read-only price reader for HOODX vault shares, for wallets, portfolio trackers and integrators.
///         `sharePrice(vault)` returns what one share (1e18) is worth in ETH and in USD, valued exactly as
///         xhoodindex.com values it:
///         - Boosted ETH: its own oracle-marked net asset value (state().nav at state().price).
///         - Hands-free LP (any HOODX stock-LP vault): each sleeve's Uniswap V4 position plus idle balances, less the
///           performance fees owed to the treasury, at the pool price; the vault's share of each sleeve.
///         - Index vaults with an oracle: totalAssets().
///         - Oracle-free index vaults: ETH and WETH held plus what each holding would sell for now, quoted by the
///           vault's own rebalance controller (`quoteRebalance` answers by reverting with the amount).
///         USD uses the ETH/USDG Uniswap V4 pool (0.01%) price.
/// @dev No storage writes, no funds, no owner. Functions that value oracle-free vaults are not `view` because the
///      controller's quote is a reverting call; use eth_call. Not for on-chain settlement: values are spot marks.
contract HoodxVaultLens {
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant WAD = 1e18;
    int24 internal constant MAX_TICK = 887272;

    address public immutable boostVault;
    ILensStateView public immutable stateView;
    address public immutable usdg;
    bytes32 public immutable ethUsdgPoolId;

    enum Kind {
        Unknown,
        Boost,
        StockLp,
        OracleIndex,
        QuotedIndex
    }

    error UnknownVault(address vault);
    error EmptyVault(address vault);
    error Unquoted(address vault, address token);

    constructor(address boostVault_, address stateView_, address usdg_, bytes32 ethUsdgPoolId_) {
        boostVault = boostVault_;
        stateView = ILensStateView(stateView_);
        usdg = usdg_;
        ethUsdgPoolId = ethUsdgPoolId_;
    }

    // ------------------------------------------------------------------ public reads

    /// @notice USD per ETH, 18 decimals, from the ETH/USDG pool.
    function ethUsd() public view returns (uint256) {
        (uint160 s,,,) = stateView.getSlot0(ethUsdgPoolId);
        // token0 = native ETH (18 dec), token1 = USDG (6 dec): USDG raw per wei = s^2 / 2^192
        return Math.mulDiv(uint256(s) * uint256(s), 1e30, 1 << 192);
    }

    /// @notice Total value held by `vault` in ETH wei, its share supply, and how it was valued.
    function navEth(address vault) public returns (uint256 assetsWei, uint256 supply, Kind kind) {
        supply = ILensIndexVault(vault).totalSupply();
        if (vault == boostVault) {
            ILensBoostVault.State memory st = ILensBoostVault(vault).state();
            if (st.price == 0) revert UnknownVault(vault);
            return (Math.mulDiv(st.nav, 1e36, st.price), supply, Kind.Boost);
        }
        (bool isLp, bytes memory h) = vault.staticcall(abi.encodeCall(ILensStockLpVault.holdings, ()));
        if (isLp && h.length > 64) {
            return (_stockLpNav(abi.decode(h, (ILensStockLpVault.Holding[]))), supply, Kind.StockLp);
        }
        (bool hasAssets, bytes memory a) = vault.staticcall(abi.encodeCall(ILensIndexVault.totalAssets, ()));
        if (hasAssets && a.length == 32) return (abi.decode(a, (uint256)), supply, Kind.OracleIndex);
        return (_quotedIndexNav(ILensIndexVault(vault)), supply, Kind.QuotedIndex);
    }

    /// @notice What one share (1e18 units) of `vault` is worth: ETH (wei per share, 18 decimals) and USD (18 decimals).
    function sharePrice(address vault) public returns (uint256 ethPerShare, uint256 usdPerShare) {
        (uint256 assetsWei, uint256 supply,) = navEth(vault);
        if (supply == 0) revert EmptyVault(vault);
        ethPerShare = Math.mulDiv(assetsWei, WAD, supply);
        usdPerShare = Math.mulDiv(ethPerShare, ethUsd(), WAD);
    }

    /// @notice `sharePrice` for several vaults; a vault that cannot be valued returns zeros instead of reverting.
    function sharePrices(address[] calldata vaults) external returns (uint256[] memory ethPerShare, uint256[] memory usdPerShare) {
        ethPerShare = new uint256[](vaults.length);
        usdPerShare = new uint256[](vaults.length);
        for (uint256 i; i < vaults.length; ++i) {
            try this.sharePrice(vaults[i]) returns (uint256 e, uint256 u) {
                (ethPerShare[i], usdPerShare[i]) = (e, u);
            } catch {}
        }
    }

    /// @notice The value of `account`'s shares in `vault`: ETH wei and USD (18 decimals).
    function positionValue(address vault, address account) external returns (uint256 valueWei, uint256 valueUsd) {
        (uint256 e, uint256 u) = sharePrice(vault);
        uint256 shares = ILensERC20(vault).balanceOf(account);
        return (Math.mulDiv(shares, e, WAD), Math.mulDiv(shares, u, WAD));
    }

    // ------------------------------------------------------------------ stock-LP valuation

    function _stockLpNav(ILensStockLpVault.Holding[] memory hs) internal view returns (uint256) {
        uint256 usdgRaw;
        for (uint256 i; i < hs.length; ++i) {
            if (hs[i].sleeveSupply == 0 || hs[i].sleeveShares == 0) continue;
            usdgRaw += Math.mulDiv(_sleeveUsdg(hs[i]), hs[i].sleeveShares, hs[i].sleeveSupply);
        }
        // USDG (6 decimals) to ETH wei at the ETH/USDG price
        return Math.mulDiv(usdgRaw * 1e12, WAD, ethUsd());
    }

    /// @dev Whole sleeve in USDG raw units: position amounts + idle balances - owed performance fees, at the pool price.
    function _sleeveUsdg(ILensStockLpVault.Holding memory h) internal view returns (uint256) {
        ILensSleeve s = ILensSleeve(h.sleeve);
        (uint160 sqrtP,) = s.spot();
        (uint256 a0, uint256 a1) = _amounts(h.positionLiquidity, sqrtP, h.tickLower, h.tickUpper);
        address t0 = s.token0();
        address t1 = s.token1();
        a0 += _idle(ILensERC20(t0).balanceOf(h.sleeve), s.feeOwed0());
        a1 += _idle(ILensERC20(t1).balanceOf(h.sleeve), s.feeOwed1());
        // price = token1 per token0 = sqrtP^2 / 2^192
        if (t0 == usdg) return a0 + Math.mulDiv(Math.mulDiv(a1, Q96, sqrtP), Q96, sqrtP);
        return a1 + Math.mulDiv(Math.mulDiv(a0, sqrtP, Q96), sqrtP, Q96);
    }

    function _idle(uint256 bal, uint256 owed) internal pure returns (uint256) {
        return bal > owed ? bal - owed : 0;
    }

    /// @dev Token amounts of liquidity `L` in [lower, upper) at sqrt price `s` (Uniswap concentrated-liquidity maths).
    function _amounts(uint128 L, uint160 s, int24 lower, int24 upper) internal pure returns (uint256 a0, uint256 a1) {
        if (L == 0) return (0, 0);
        uint256 sa = sqrtPriceAtTick(lower);
        uint256 sb = sqrtPriceAtTick(upper);
        uint256 p = s;
        if (p <= sa) {
            a0 = Math.mulDiv(Math.mulDiv(uint256(L), Q96, sa), sb - sa, sb);
        } else if (p >= sb) {
            a1 = Math.mulDiv(uint256(L), sb - sa, Q96);
        } else {
            a0 = Math.mulDiv(Math.mulDiv(uint256(L), Q96, p), sb - p, sb);
            a1 = Math.mulDiv(uint256(L), p - sa, Q96);
        }
    }

    /// @notice sqrt(1.0001^tick) in Q64.96, by binary exponentiation of sqrt(1.0001) in Q96 fixed point.
    /// @dev Matches Uniswap's TickMath to within about 1e-20 relative; fine for valuation, not for pool accounting.
    function sqrtPriceAtTick(int24 tick) public pure returns (uint256 r) {
        uint256 n = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        require(n <= uint256(int256(MAX_TICK)), "tick");
        // sqrt(1.0001) * 2^96, computed with 2^96 extra bits of precision and rounded back
        uint256 base = Math.sqrt(Math.mulDiv(10001, 1 << 192, 10000)); // Q96
        r = Q96;
        while (n != 0) {
            if (n & 1 == 1) r = Math.mulDiv(r, base, Q96);
            base = Math.mulDiv(base, base, Q96);
            n >>= 1;
        }
        if (tick < 0) r = Math.mulDiv(Q96, Q96, r);
    }

    // ------------------------------------------------------------------ oracle-free index valuation

    function _quotedIndexNav(ILensIndexVault v) internal returns (uint256 sum) {
        address[] memory tokens = v.constituents();
        address weth = v.weth();
        address controller = v.owner();
        sum = v.freeBalance(weth) + v.freeBalance(address(0));
        for (uint256 i; i < tokens.length; ++i) {
            uint256 amt = v.freeBalance(tokens[i]);
            if (amt == 0) continue;
            sum += _quote(controller, tokens[i], amt, address(v));
        }
    }

    /// @dev The controller answers a sell quote by reverting with RebalanceQuote(uint256 output).
    function _quote(address controller, address token, uint256 amt, address vault) internal returns (uint256) {
        try ILensQuoter(controller).quoteRebalance(token, false, amt) {
            revert Unquoted(vault, token);
        } catch (bytes memory err) {
            if (err.length != 36 || bytes4(err) != bytes4(keccak256("RebalanceQuote(uint256)"))) revert Unquoted(vault, token);
            uint256 out;
            assembly {
                out := mload(add(err, 36))
            }
            return out;
        }
    }
}
