// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniTwapOracle, IUniV3Pool, IStateView, IPosm, PoolKey} from "./UniTwap.sol";
import {HoodxStorage, IERC20, IWETH, ISwapRouter02, IPoolManager} from "./HoodxStorage.sol";

interface IHoodxView {
    function priceWethWad(address token) external view returns (uint256);
    function minOutFloor(uint256 twapOut) external pure returns (uint256);
}

/// @dev Swap / bind / quote-seed logic. HoodxIndex delegatecalls this so the clone stays under 24kb.
contract HoodxSwap is HoodxStorage {
    address public immutable twapOracle;

    constructor(address twapOracle_) {
        if (twapOracle_ == address(0)) revert Zero();
        twapOracle = twapOracle_;
        implLock = true;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) external payable {
        address listedTok = tokenIn == weth ? tokenOut : tokenIn;
        if (tokenOut == weth && listed[listedTok]) {
            if (isV4[listedTok]) {
                if (v4Key[listedTok].hooks != address(0)) return;
                if (IStateView(v4StateView).getLiquidity(poolIdOf[listedTok]) == 0) return;
            } else {
                address sellPool = poolOf[listedTok];
                if (sellPool == address(0) || IUniV3Pool(sellPool).liquidity() == 0) return;
            }
        }
        if (tokenIn == weth && listed[tokenOut]) {
            _guardBuy(tokenOut, amountIn);
        }
        address quote = quoteOf[listedTok];
        if (quote != address(0) && quote != weth) {
            if (tokenIn == weth && tokenOut == listedTok) {
                _swapQuotedBuy(listedTok, quote, amountIn, amountOutMin);
                return;
            }
            if (tokenOut == weth && tokenIn == listedTok) {
                _swapQuotedSell(listedTok, quote, amountIn, amountOutMin);
                return;
            }
            revert BadPair();
        }
        if (isV4[listedTok]) {
            if (amountIn > uint256(uint128(type(int128).max))) revert Zero();
            IPoolManager(v4Manager).unlock(abi.encode(tokenIn, tokenOut, amountIn, amountOutMin));
            return;
        }
        address pool = poolOf[listedTok];
        if (pool == address(0)) revert BadPair();
        _swapV3Exact(tokenIn, tokenOut, pool, amountIn, amountOutMin);
    }

    function unlockCallback(bytes calldata data) external payable returns (bytes memory) {
        if (msg.sender != v4Manager) revert NotManager();
        (address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) =
            abi.decode(data, (address, address, uint256, uint256));
        address listedTok;
        if (tokenIn == weth) listedTok = tokenOut;
        else if (tokenOut == weth) listedTok = tokenIn;
        else if (listed[tokenOut]) listedTok = tokenOut;
        else listedTok = tokenIn;
        if (!isV4[listedTok]) revert BadPair();
        PoolKey memory key = v4Key[listedTok];
        bool native = key.currency0 == address(0) || key.currency1 == address(0);
        address currencyIn = tokenIn == weth && native ? address(0) : tokenIn;
        address currencyOut = tokenOut == weth && native ? address(0) : tokenOut;
        bool zeroForOne = currencyIn == key.currency0;
        if ((zeroForOne && currencyOut != key.currency1) || (!zeroForOne && currencyIn != key.currency1)) {
            revert BadPool();
        }
        IPoolManager pm = IPoolManager(v4Manager);
        int256 raw = pm.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1
            }),
            ""
        );
        int128 d0;
        int128 d1;
        assembly {
            d0 := sar(128, raw)
            d1 := signextend(15, raw)
        }
        int128 dIn = zeroForOne ? d0 : d1;
        int128 dOut = zeroForOne ? d1 : d0;
        if (dIn >= 0 || dOut <= 0) revert SwapFailed();
        uint256 paid = uint256(uint128(-dIn));
        uint256 got = uint256(uint128(dOut));
        if (got < amountOutMin) revert Slippage();
        if (currencyIn == address(0)) {
            IWETH(weth).withdraw(paid);
            pm.settle{value: paid}();
        } else {
            pm.sync(currencyIn);
            if (!IERC20(currencyIn).transfer(address(pm), paid)) revert TransferFailed();
            pm.settle();
        }
        pm.take(currencyOut, address(this), got);
        if (currencyOut == address(0)) {
            IWETH(weth).deposit{value: got}();
        }
        return abi.encode(got);
    }

    function addTokenRaw(address token, bytes32 poolRef) external payable {
        _addToken(token, poolRef);
    }

    function removeTokenRaw(address token) external payable {
        _removeToken(token);
    }

    function clearBindRaw(address token) external payable {
        if (!listed[token]) revert Listed();
        _clearBind(token);
    }

    /// @dev Drop a name from the index but leave its bag in the vault (unredeemable dust).
    function strandTokenRaw(address token) external payable {
        _strandToken(token);
    }

    function claimDustRaw(address token) external payable {
        if (listed[token]) revert Listed();
        uint256 supply = strandedSupply[token];
        uint256 bag = strandedBag[token];
        if (supply == 0 || bag == 0) revert Zero();
        if (strandedClaimed[token][msg.sender]) revert AlreadyClaimed();
        uint256 shares = balanceOf[msg.sender];
        if (shares == 0) revert Zero();
        strandedClaimed[token][msg.sender] = true;
        uint256 amt = (bag * shares) / supply;
        uint256 have = IERC20(token).balanceOf(address(this));
        if (amt > have) amt = have;
        if (amt == 0) revert Zero();
        if (!IERC20(token).transfer(msg.sender, amt)) revert TransferFailed();
        emit DustClaimed(msg.sender, token, amt);
    }

    function rebindTokenRaw(address token, bytes32 poolRef) external payable {
        if (!listed[token]) revert Listed();
        if (IERC20(token).balanceOf(address(this)) != 0) revert NeedBuffer();
        _clearBind(token);
        if (uint256(poolRef) >> 160 == 0) {
            address pool = address(uint160(uint256(poolRef)));
            _bindPool(token, pool);
            poolOf[token] = pool;
            emit TokenRebound(token, poolRef, false);
        } else {
            _bindV4(token, poolRef);
            emit TokenRebound(token, poolRef, true);
        }
    }

    function initQuotes() external payable {
        _initRhQuotes();
    }

    function setQuoteBridgeRaw(address quote, address v3Bridge) external payable {
        if (quote == address(0) || v3Bridge == address(0) || quote == weth) revert Zero();
        uint8 dec = IERC20(quote).decimals();
        if (quote == USDG) {
            if (dec != 6) revert BadPool();
        } else if (dec != 18) {
            revert BadPool();
        }
        address t0 = IUniV3Pool(v3Bridge).token0();
        address t1 = IUniV3Pool(v3Bridge).token1();
        if (!((quote == t0 && weth == t1) || (quote == t1 && weth == t0))) revert BadPool();
        IUniV3Pool(v3Bridge).fee();
        allowedQuote[quote] = true;
        quoteBridgeV3[quote] = v3Bridge;
        emit QuoteBridgeSet(quote, v3Bridge);
    }

    function setImageURIRaw(string calldata uri) external payable {
        _setImageURI(uri);
    }

    /// @dev Payable: Index deposit is payable and delegatecall preserves msg.value.
    function warmOracleRaw(address token) external payable {
        if (isV4[token]) return;
        address pool = poolOf[token];
        if (pool == address(0)) revert Listed();
        IUniV3Pool(pool).increaseObservationCardinalityNext(ORACLE_CARDINALITY);
    }

    function _addToken(address token, bytes32 poolRef) internal {
        if (token == address(0) || token == weth || listed[token]) revert Listed();
        if (tokens.length >= 24) revert BadLen();
        if (uint256(poolRef) >> 160 == 0) {
            address pool = address(uint160(uint256(poolRef)));
            _bindPool(token, pool);
            poolOf[token] = pool;
            emit TokenAdded(token, poolRef, false);
        } else {
            _bindV4(token, poolRef);
            emit TokenAdded(token, poolRef, true);
        }
        listed[token] = true;
        tokens.push(token);
        uint256 live = totalSupply > balanceOf[DEAD] ? totalSupply - balanceOf[DEAD] : 0;
        listedAt[token] = live == 0 ? uint64(1) : uint64(block.timestamp);
    }

    function _bindPool(address token, address pool) internal {
        if (pool == address(0) || pool.code.length == 0) revert BadPool();
        address t0 = IUniV3Pool(pool).token0();
        address t1 = IUniV3Pool(pool).token1();
        if ((token == t0 && weth == t1) || (token == t1 && weth == t0)) {
            quoteOf[token] = weth;
        } else if ((token == t0 && USDG == t1) || (token == t1 && USDG == t0)) {
            if (!allowedQuote[USDG] || quoteBridgeV3[USDG] == address(0)) revert BadPool();
            quoteOf[token] = USDG;
        } else revert BadPool();
        if (IERC20(token).decimals() != 18) revert BadPool();
        IUniV3Pool(pool).fee();
        _assertV3Depth(pool, quoteOf[token]);
    }

    function _assertV3Depth(address pool, address quote) internal view {
        if (IUniV3Pool(pool).liquidity() == 0) revert ThinPool();
        if (quote == weth) {
            if (IERC20(weth).balanceOf(pool) < MIN_POOL_WETH) revert ThinPool();
        } else if (quote == USDG) {
            if (IERC20(USDG).balanceOf(pool) < MIN_POOL_USDG) revert ThinPool();
        }
    }

    function _guardBuy(address token, uint256 amountIn) internal view {
        uint64 added = listedAt[token];
        if (added > 1 && block.timestamp < uint256(added) + BUY_UNLOCK_DELAY) revert TooSoon();
        uint256 assets = IERC20(weth).balanceOf(address(this)) + address(this).balance;
        uint256 cap = (assets * uint256(MAX_POOL_TAKE_BPS)) / BPS_DENOM;
        if (!isV4[token]) {
            address pool = poolOf[token];
            if (pool != address(0)) {
                if (IUniV3Pool(pool).liquidity() == 0) revert ThinPool();
                uint256 poolCap = (IERC20(weth).balanceOf(pool) * uint256(MAX_POOL_TAKE_BPS)) / BPS_DENOM;
                if (poolCap < cap) cap = poolCap;
            }
        } else if (IStateView(v4StateView).getLiquidity(poolIdOf[token]) == 0) {
            revert ThinPool();
        }
        if (added > 1 && block.timestamp < uint256(added) + NEW_NAME_GUARD) {
            uint256 fresh = (assets * uint256(MAX_NEW_BUY_BPS)) / BPS_DENOM;
            if (fresh < cap) cap = fresh;
        }
        if (cap == 0 || amountIn > cap) revert ThinPool();
    }

    function _bindV4(address token, bytes32 poolId) internal {
        (address c0, address c1, uint24 fee, int24 spacing, address hooks) = IPosm(v4Posm).poolKeys(bytes25(poolId));
        if (c1 == address(0)) revert BadPool();
        if (hooks != address(0)) revert HookedPool();
        PoolKey memory key = PoolKey({
            currency0: c0,
            currency1: c1,
            fee: fee,
            tickSpacing: spacing,
            hooks: hooks
        });
        bytes32 hashed;
        assembly {
            hashed := keccak256(key, 0xa0)
        }
        if (hashed != poolId) revert BadPool();
        if (token != c0 && token != c1) revert BadPool();
        address other = token == c0 ? c1 : c0;
        if (other == weth || other == address(0)) {
            quoteOf[token] = weth;
        } else if (other == USDG || (allowedQuote[other] && quoteBridgeV3[other] != address(0))) {
            quoteOf[token] = other;
        } else revert BadPool();
        if (IERC20(token).decimals() != 18) revert BadPool();
        (uint160 sqrtP, , , ) = IStateView(v4StateView).getSlot0(poolId);
        if (sqrtP == 0) revert BadPool();
        if (IStateView(v4StateView).getLiquidity(poolId) == 0) revert ThinPool();
        isV4[token] = true;
        poolIdOf[token] = poolId;
        v4Key[token] = key;
    }

    function _removeToken(address token) internal {
        if (!listed[token]) revert Listed();
        if (IERC20(token).balanceOf(address(this)) != 0) revert NeedBuffer();
        _dropToken(token);
        emit TokenRemoved(token);
    }

    function _strandToken(address token) internal {
        if (!listed[token]) revert Listed();
        // Liquid names must be sold. Stranding is only for hooked V4 bags that cannot exit.
        if (!isV4[token] || v4Key[token].hooks == address(0)) revert BadPool();
        uint256 bag = IERC20(token).balanceOf(address(this));
        uint256 live = totalSupply > balanceOf[DEAD] ? totalSupply - balanceOf[DEAD] : 0;
        if (bag > 0 && live > 0) {
            strandedBag[token] = bag;
            strandedSupply[token] = live;
        }
        _dropToken(token);
        emit TokenStranded(token, bag);
    }

    function _dropToken(address token) internal {
        uint256 n = tokens.length;
        if (n <= 2) revert BadLen();
        listed[token] = false;
        targetBps[token] = 0;
        delete listedAt[token];
        _clearBind(token);
        for (uint256 i; i < n; i++) {
            if (tokens[i] == token) {
                tokens[i] = tokens[n - 1];
                tokens.pop();
                break;
            }
        }
    }

    function _clearBind(address token) internal {
        delete poolOf[token];
        delete poolIdOf[token];
        delete isV4[token];
        delete v4Key[token];
        delete quoteOf[token];
        delete lastPxWad[token];
    }

    function _seedQuoteBridge(address quote, address bridge) internal {
        allowedQuote[quote] = true;
        quoteBridgeV3[quote] = bridge;
    }

    function _initRhQuotes() internal {
        _seedQuoteBridge(USDG, WETH_USDG_V3);
        _seedQuoteBridge(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e); // SPY
        _seedQuoteBridge(0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0xc6BCC95043DC48C204bB2D57fb264a10Efe0a607); // GME
        _seedQuoteBridge(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0x8c2B4303fA0B99d07A5D3E9411497A277e65b673); // GOOGL
        _seedQuoteBridge(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0xA953CA88ff430e9487c60cA34d757414f4efdA07); // TSLA
        _seedQuoteBridge(0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, 0xCa2734C70E3C348eDcDA36A6478c9275A0Ff0c90); // SLV
        _seedQuoteBridge(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xC3c9F0171490Ef0F4536fe493F3b0EbB5ee0CB5e); // SPCX
        _seedQuoteBridge(0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, 0x91280dB3392EA92C08d8134b5760Fb4798B69547); // TSM
        _seedQuoteBridge(0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 0x6707aeAc7D0e519B083219d27BB427364363183A); // COIN
        _seedQuoteBridge(0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x5ca1B5e6Cb510b3bf53E7cd8f7d9B5a71b4a4dc0); // AMD
        _seedQuoteBridge(0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x61be5Bfbaf17aE28Bf68006103B2e78Fe6112638); // PLTR
        _seedQuoteBridge(0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5, 0x7F310e3D05E575Bd449E4484eF5Da15863ea43B1); // SGOV
        _seedQuoteBridge(0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd, 0x61346CD249a6453fBa2ADa35f210376ac0B4957c); // DELL
        _seedQuoteBridge(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f); // AAPL
        _seedQuoteBridge(0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0x995c1Ad5Eb998b1BdD89F515C4BB64760c411b62); // SNDK
        _seedQuoteBridge(0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0xa4BdB396a69617eb7F70E2cc1EF526f7340b1B0d); // META
        _seedQuoteBridge(0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x1b375A9c30Ac43391AEFaE1bcf3a988D92458725); // INTC
        _seedQuoteBridge(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x62AB521f71431f78ac374CdbadC6cda3c8916b6C); // NVDA
        _seedQuoteBridge(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0xA40D00a55d43bA2d188039DCF88bD68f4F133E78); // QQQ
        _seedQuoteBridge(0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x754DdD4bF8E8635B4301a7f4Af2Ea7A82AB6cEA7); // CRCL
        _seedQuoteBridge(0xec262a75e413fAfD0dF80480274532C79D42da09, 0x70504a6FafdbfB75fE971FAA4dD716e79aC5624c); // MSTR
        _seedQuoteBridge(0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x301F48EC369BB3bfA0bC04d44A79037aa0EE2340); // MU
    }

    function _setImageURI(string memory uri) internal {
        bytes memory b = bytes(uri);
        if (b.length > 256) revert BadLen();
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x00 || c == 0x22 || c < 0x20) revert BadPool();
        }
        imageURI = uri;
        emit ImageURISet(uri);
    }

    function _quoteUnit(address token) internal pure returns (uint256) {
        if (token == USDG) return 1e6;
        return 1e18;
    }

    function _spotQuotePerToken(address token) internal view returns (uint256) {
        PoolKey memory key = v4Key[token];
        (, int24 tick, , ) = IStateView(v4StateView).getSlot0(poolIdOf[token]);
        return IUniTwapOracle(twapOracle).quoteAtTick(tick, 1e18, token == key.currency0);
    }

    function _swapV3Exact(address tokenIn, address tokenOut, address pool, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 got)
    {
        uint24 fee = IUniV3Pool(pool).fee();
        IERC20(tokenIn).approve(swapRouter, amountIn);
        got = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).approve(swapRouter, 0);
    }

    function _swapV4Exact(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 got)
    {
        bytes memory ret = IPoolManager(v4Manager).unlock(abi.encode(tokenIn, tokenOut, amountIn, minOut));
        got = abi.decode(ret, (uint256));
    }

    function _swapQuotedBuy(address token, address quote, uint256 wethIn, uint256 minTokenOut) internal {
        address bridge = quoteBridgeV3[quote];
        if (bridge == address(0)) revert BadPool();
        uint256 pxQuote = IHoodxView(address(this)).priceWethWad(quote);
        uint256 quotedQuote = (wethIn * _quoteUnit(quote)) / pxQuote;
        uint256 quoteFloor = IHoodxView(address(this)).minOutFloor(quotedQuote);
        uint256 quoteGot = _swapV3Exact(weth, quote, bridge, wethIn, quoteFloor);
        if (isV4[token]) {
            _swapV4Exact(quote, token, quoteGot, minTokenOut);
        } else {
            _swapV3Exact(quote, token, poolOf[token], quoteGot, minTokenOut);
        }
    }

    function _swapQuotedSell(address token, address quote, uint256 tokenIn, uint256 minWethOut) internal {
        address bridge = quoteBridgeV3[quote];
        if (bridge == address(0)) revert BadPool();
        uint256 quotedQuote;
        uint256 quoteGot;
        if (isV4[token]) {
            quotedQuote = _spotQuotePerToken(token);
            quotedQuote = (tokenIn * quotedQuote) / 1e18;
            uint256 quoteFloor = IHoodxView(address(this)).minOutFloor(quotedQuote);
            quoteGot = _swapV4Exact(token, quote, tokenIn, quoteFloor);
        } else {
            address pool = poolOf[token];
            quotedQuote = IUniTwapOracle(twapOracle).quotePerBase(pool, token, quote, 1e18, TWAP_SECS);
            quotedQuote = (tokenIn * quotedQuote) / 1e18;
            uint256 quoteFloor = IHoodxView(address(this)).minOutFloor(quotedQuote);
            quoteGot = _swapV3Exact(token, quote, pool, tokenIn, quoteFloor);
        }
        // USDG is already in the vault from the V4 leg; bridge minOut follows quoteGot only.
        // TWAP pxQuote can exceed the live V3 bridge (minWethOut is oracle NAV) — a strict
        // bridge floor made AMZN/NFLX sells revert and _swapOrSkip stranded them on exit.
        if (quoteGot == 0) revert Slippage();
        _swapV3Exact(quote, weth, bridge, quoteGot, 1);
    }
}
