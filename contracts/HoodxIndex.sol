// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniTwapOracle, IStateView, PoolKey} from "./UniTwap.sol";
import {HoodxStorage, IERC20, IWETH} from "./HoodxStorage.sol";
import {HoodxSwap} from "./HoodxSwap.sol";

/// @title HoodxIndex — trustless ETH in / ETH out meme basket
/// @notice Cloneable vault. One share starts at $100 of ETH. Join mints at live
///         NAV per share, capped at net ETH in, with a required minShares (EIP-4626
///         inflation / sandwich). Dead shares capture donations. V4 mint NAV uses
///         max(spot, last tick) so a flash dump cannot cheapen the basket.
///         `owner` is the curator (two-step transfer). `creator` keeps the fee cut.
///         Swap/bind live in HoodxSwap via delegatecall so this clone stays under 24kb.

contract HoodxIndex is HoodxStorage {
    address public immutable twapOracle;
    address public immutable swapLogic;

    constructor(address twapOracle_, address swapLogic_) {
        if (twapOracle_ == address(0) || swapLogic_ == address(0) || swapLogic_.code.length == 0) revert Zero();
        twapOracle = twapOracle_;
        swapLogic = swapLogic_;
        implLock = true;
    }

    function _dlg(bytes memory data) internal returns (bytes memory ret) {
        bool ok;
        (ok, ret) = swapLogic.delegatecall(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function initialize(
        InitParams calldata p,
        address[] calldata constituents,
        bytes32[] calldata pools
    ) external {
        if (implLock || factory != address(0)) revert AlreadyInit();
        if (p.creator == address(0) || p.protocol == address(0) || p.weth == address(0) || p.router == address(0)) {
            revert Zero();
        }
        if (p.v4Manager == address(0) || p.v4StateView == address(0) || p.v4Posm == address(0)) revert Zero();
        if (constituents.length < 2 || constituents.length > 24) revert BadLen();
        if (constituents.length != pools.length) revert BadLen();
        if (uint256(p.protocolFeeBps) + uint256(p.creatorFeeBps) > MAX_FEE_BPS) revert MaxFee();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert Zero();
        factory = msg.sender;
        owner = p.creator;
        creator = p.creator;
        creatorRecipient = p.recipient == address(0) ? p.creator : p.recipient;
        protocol = p.protocol;
        weth = p.weth;
        swapRouter = p.router;
        v4Manager = p.v4Manager;
        v4StateView = p.v4StateView;
        v4Posm = p.v4Posm;
        name = p.name;
        symbol = p.symbol;
        protocolFeeBps = p.protocolFeeBps;
        creatorFeeBps = p.creatorFeeBps;
        cashTargetBps = 2500;
        minDeposit = 0.02 ether;
        minFirstDeposit = p.minFirstDeposit;
        minSleeveWeth = 0.004 ether;
        genesisEthPerShare = 0.04 ether; // $100 at $2500 ETH; owner can peg before first mint
        if (bytes(p.imageURI).length != 0) {
            _dlg(abi.encodeWithSelector(HoodxSwap.setImageURIRaw.selector, p.imageURI));
        }
        _dlg(abi.encodeWithSelector(HoodxSwap.initQuotes.selector));
        for (uint256 i; i < constituents.length; i++) {
            _dlg(abi.encodeWithSelector(HoodxSwap.addTokenRaw.selector, constituents[i], pools[i]));
        }
        uint16 each = uint16((BPS_DENOM - cashTargetBps) / constituents.length);
        for (uint256 i; i < constituents.length; i++) {
            targetBps[constituents[i]] = each;
        }
    }

    receive() external payable {
        if (msg.sender != weth && msg.sender != v4Manager) revert TransferFailed();
    }

    function nTokens() external view returns (uint256) {
        return tokens.length;
    }

    function tokenAt(uint256 i) external view returns (address) {
        return tokens[i];
    }

    function issueFeeBps() public view returns (uint16) {
        return protocolFeeBps + creatorFeeBps;
    }

    function cashBps() public view returns (uint256) {
        uint256 used;
        for (uint256 i; i < tokens.length; i++) used += targetBps[tokens[i]];
        return BPS_DENOM - used;
    }

    function wethBuffer() public view returns (uint256) {
        return IERC20(weth).balanceOf(address(this));
    }

    /// @dev WETH wei per one full token (`10 ** decimals`). V3 TWAP or V4 spot × quote bridge.
    function priceWethWad(address token) public view returns (uint256) {
        if (token == weth) return 1e18;
        uint256 unit = _quoteUnit(token);
        if (allowedQuote[token] && quoteBridgeV3[token] != address(0)) {
            return IUniTwapOracle(twapOracle).priceWethWad(quoteBridgeV3[token], token, weth, unit, TWAP_SECS);
        }
        address quote = quoteOf[token];
        if (isV4[token]) {
            if (quote == address(0) || quote == weth) {
                PoolKey memory key = v4Key[token];
                return IUniTwapOracle(twapOracle).priceWethWadV4(v4StateView, poolIdOf[token], token, key.currency0, key.currency1, weth, unit);
            }
            uint256 quotePerToken = _spotQuotePerToken(token);
            uint256 wethPerQuote = priceWethWad(quote);
            return (quotePerToken * wethPerQuote) / _quoteUnit(quote);
        }
        address pool = poolOf[token];
        if (pool == address(0)) revert Listed();
        if (quote != address(0) && quote != weth) {
            uint256 quotePerToken = IUniTwapOracle(twapOracle).quotePerBase(pool, token, quote, unit, TWAP_SECS);
            uint256 wethPerQuote = priceWethWad(quote);
            return (quotePerToken * wethPerQuote) / _quoteUnit(quote);
        }
        return IUniTwapOracle(twapOracle).priceWethWad(pool, token, weth, unit, TWAP_SECS);
    }

    function oracleReady(address token) external view returns (bool) {
        if (!listed[token]) return false;
        if (!isV4[token] && poolOf[token] == address(0)) return false;
        try this.priceWethWad(token) returns (uint256 px) {
            return px > 0;
        } catch {
            return false;
        }
    }

    function quoteOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        if (amountIn == 0) return 0;
        if (tokenIn == weth && listed[tokenOut]) {
            uint256 px = priceWethWad(tokenOut);
            return (amountIn * 1e18) / px;
        }
        if (tokenOut == weth && listed[tokenIn]) {
            uint256 px = priceWethWad(tokenIn);
            return (amountIn * px) / 1e18;
        }
        revert BadPair();
    }

    function minOutFloor(uint256 twapOut) public pure returns (uint256) {
        return (twapOut * (BPS_DENOM - MAX_SLIP_BPS)) / BPS_DENOM;
    }

    function cashShortfall() public view returns (uint256) {
        uint256 assets = totalAssets();
        if (assets == 0) return 0;
        uint256 want = (assets * uint256(cashTargetBps)) / BPS_DENOM;
        uint256 have = wethBuffer();
        return have >= want ? 0 : want - have;
    }

    function totalAssets() public view returns (uint256 assets) {
        assets = _nav(false);
    }

    function redeemableAssets() public view returns (uint256 assets) {
        assets = IERC20(weth).balanceOf(address(this)) + address(this).balance;
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0 || !_canLiquidate(t)) continue;
            try this.priceWethWad(t) returns (uint256 px) {
                if (px != 0) assets += (bal * px) / 1e18;
            } catch {}
        }
    }

    /// @dev Mint pricing. V4 uses max(spot, lastPx) so a same-block dump cannot cheapen shares
    ///      (Indexed Finance: understate one name, mint the basket). V3 already TWAPs.
    function mintAssets() public view returns (uint256) {
        return _nav(true);
    }

    function _nav(bool mintPx) internal view returns (uint256 assets) {
        assets = IERC20(weth).balanceOf(address(this)) + address(this).balance;
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 px = priceWethWad(t);
            if (mintPx && isV4[t]) {
                uint256 last = lastPxWad[t];
                if (last > px) px = last;
            }
            assets += (bal * px) / 1e18;
        }
    }

    function _liveSupply() internal view returns (uint256) {
        uint256 d = balanceOf[DEAD];
        uint256 s = totalSupply;
        return s > d ? s - d : 0;
    }

    function _virtualShares() internal view returns (uint256) {
        uint256 g = genesisEthPerShare;
        if (g == 0) return 1;
        uint256 vs = (VIRTUAL_ASSETS * 1e18) / g;
        return vs == 0 ? 1 : vs;
    }

    function _snapshotPx() internal {
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            if (IERC20(t).balanceOf(address(this)) == 0) continue;
            lastPxWad[t] = priceWethWad(t);
        }
    }

    /// @dev Entry price. Empty + no assets = genesis. Unsolicited WETH is priced as if
    ///      dead shares already existed, so previewDeposit cannot hide a donation.
    function sharePrice() public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 nav = mintAssets();
        if (supply == 0 || _liveSupply() == 0) {
            if (nav == 0) return genesisEthPerShare;
            uint256 denom = supply == 0 ? _virtualShares() : supply;
            return (nav * 1e18) / denom;
        }
        return (nav * 1e18) / supply;
    }

    function position(address who)
        external
        view
        returns (uint256 shares, uint256 value, uint256 cost, uint256 price)
    {
        price = sharePrice();
        shares = balanceOf[who];
        cost = costBasis[who];
        uint256 supply = totalSupply;
        if (supply == 0 || shares == 0) return (shares, 0, cost, price);
        value = (shares * redeemableAssets()) / supply;
    }

    /// @dev Best-case shares (no slip). Fill drag can mint less; never more than this.
    ///      Callers MUST pass a minShares on deposit — preview is manipulable (EIP-4626).
    function previewDeposit(uint256 weiIn) public view returns (uint256 shares, uint256 fee) {
        (uint256 proto, uint256 creat) = _fees(weiIn);
        fee = proto + creat;
        uint256 net = weiIn - fee;
        uint256 price = sharePrice();
        if (price == 0) return (0, fee);
        shares = (net * 1e18) / price;
    }

    function previewFees(uint256 weiIn) external view returns (uint256 protocolFee, uint256 creatorFee) {
        return _fees(weiIn);
    }

    function previewWithdraw(uint256 shares) public view returns (uint256 net, uint256 fee) {
        uint256 supply = totalSupply;
        if (supply == 0 || shares == 0) return (0, 0);
        uint256 value = (shares * redeemableAssets()) / supply;
        fee = (value * redeemFeeBps) / BPS_DENOM;
        net = value - fee;
    }

    function previewBuy(uint256 weiIn) public view returns (uint256 spent, uint256 wethKept, uint256 names) {
        (, uint256 fee) = previewDeposit(weiIn);
        if (weiIn <= fee) return (0, 0, 0);
        uint256 net = weiIn - fee;
        uint256 supply = totalSupply;
        uint256 assetsBefore = totalAssets();
        if (supply == 0 || assetsBefore == 0) {
            (spent, names) = _previewTargets(net);
        } else {
            (spent, names) = _previewReplicate(net, assetsBefore);
        }
        wethKept = net - spent;
    }

    function previewSell(uint256 shares) public view returns (uint256 minEthOut, uint256 names) {
        uint256 supply = totalSupply;
        if (supply == 0 || shares == 0 || shares > supply) return (0, 0);
        uint256 wethBal = IERC20(weth).balanceOf(address(this));
        bool sweep = shares == supply || shares == _liveSupply();
        minEthOut = sweep ? wethBal : (wethBal * shares) / supply;
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            uint256 amt = sweep ? bal : (bal * shares) / supply;
            if (amt == 0) continue;
            if (!_canLiquidate(t)) continue;
            uint256 floor = _minOutOrZero(t, weth, amt);
            if (floor == 0) continue;
            minEthOut += floor;
            names++;
        }
    }

    function canWithdraw(uint256 shares) external view returns (bool) {
        (uint256 minOut, ) = previewSell(shares);
        return minOut > 0;
    }

    /// @dev minShares is required. previewDeposit is manipulable (EIP-4626); the router/HUD
    ///      must set minShares from preview minus known slip. 0 is rejected.
    function deposit(uint256 minShares) external payable nonReentrant returns (uint256 shares) {
        if (paused) revert Paused();
        if (minShares == 0) revert TooSmall();
        uint256 gross = msg.value;
        if (gross < minDeposit) revert TooSmall();
        (uint256 proto, uint256 creat) = _fees(gross);
        uint256 net = gross - proto - creat;
        uint256 supply = totalSupply;
        uint256 mintNav = mintAssets() - gross;
        IWETH(weth).deposit{value: gross}();
        if (proto > 0) {
            if (!IERC20(weth).transfer(protocol, proto)) revert TransferFailed();
        }
        if (creat > 0) {
            if (!IERC20(weth).transfer(creatorRecipient, creat)) revert TransferFailed();
        }
        if (_liveSupply() == 0) {
            if (gross < minFirstDeposit) revert TooSmall();
            if (balanceOf[DEAD] == 0) _mint(DEAD, _virtualShares());
            supply = totalSupply;
        } else {
            _assertPriced();
            if (mintNav == 0) revert Zero();
        }
        for (uint256 i; i < tokens.length; i++) {
            if (!isV4[tokens[i]]) warmOracle(tokens[i]);
        }
        uint256 price = mintNav == 0 ? genesisEthPerShare : (mintNav * 1e18) / supply;
        _deployNet(net, mintNav, supply);
        uint256 assetsAfter = mintAssets();
        uint256 credited = assetsAfter > mintNav ? assetsAfter - mintNav : 0;
        if (credited > net) credited = net;
        if (credited == 0 || price == 0) revert TooSmall();
        shares = (credited * 1e18) / price;
        if (shares == 0 || shares < minShares) revert Slippage();
        costBasis[msg.sender] += gross;
        _mint(msg.sender, shares);
        _snapshotPx();
        emit Deposit(msg.sender, gross, shares, proto, creat, price);
    }

    /// @dev Exits stay open when paused so the curator cannot trap ETH.
    ///      Sells this user's slice of every name, then unwraps WETH.
    function withdraw(uint256 shares, uint256 minEthOut) external nonReentrant returns (uint256 net) {
        if (shares == 0 || balanceOf[msg.sender] < shares) revert Zero();
        _assertPriced();
        uint256 supply = totalSupply;
        uint256 price = (totalAssets() * 1e18) / supply;
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        bool sweep = shares == supply || shares == _liveSupply();
        uint256 cashTake = sweep ? wethBefore : (wethBefore * shares) / supply;
        _liquidate(shares, supply, sweep);
        uint256 proceeds = IERC20(weth).balanceOf(address(this)) - wethBefore;
        net = cashTake + proceeds;
        if (net == 0) revert NeedBuffer();
        if (net < minEthOut) revert Slippage();
        uint256 fee = (net * redeemFeeBps) / BPS_DENOM;
        net = net - fee;
        _shiftCost(msg.sender, address(0), shares);
        _burn(msg.sender, shares);
        if (fee > 0) {
            if (!IERC20(weth).transfer(protocol, fee)) revert TransferFailed();
        }
        IWETH(weth).withdraw(net);
        (bool ok, ) = msg.sender.call{value: net}("");
        if (!ok) revert TransferFailed();
        _snapshotPx();
        emit Withdraw(msg.sender, shares, net, fee, price);
    }

    function setTargets(address[] calldata who, uint16[] calldata bps) external onlyOwner {
        if (who.length != bps.length) revert BadLen();
        uint256 used;
        uint256 nav = totalAssets();
        for (uint256 i; i < who.length; i++) {
            if (!listed[who[i]]) revert Listed();
            if (bps[i] > 0 && nav > 0) {
                uint256 sleeve = (nav * uint256(bps[i])) / BPS_DENOM;
                if (sleeve < minSleeveWeth) revert DustSleeve();
            }
            used += bps[i];
        }
        if (used > BPS_DENOM - cashTargetBps) revert CashFloor();
        for (uint256 i; i < tokens.length; i++) targetBps[tokens[i]] = 0;
        for (uint256 i; i < who.length; i++) targetBps[who[i]] = bps[i];
        emit Targets(who, bps);
    }

    function constituents() external view returns (address[] memory) {
        return tokens;
    }

    function addToken(address token, bytes32 poolRef) external onlyOwner {
        _dlg(abi.encodeWithSelector(HoodxSwap.addTokenRaw.selector, token, poolRef));
    }

    function addTokens(address[] calldata who, bytes32[] calldata pools) external onlyOwner {
        if (who.length != pools.length) revert BadLen();
        for (uint256 i; i < who.length; i++) {
            _dlg(abi.encodeWithSelector(HoodxSwap.addTokenRaw.selector, who[i], pools[i]));
        }
    }

    function removeToken(address token) external onlyOwner {
        _dlg(abi.encodeWithSelector(HoodxSwap.removeTokenRaw.selector, token));
    }

    function removeTokens(address[] calldata who) external onlyOwner {
        for (uint256 i; i < who.length; i++) {
            _dlg(abi.encodeWithSelector(HoodxSwap.removeTokenRaw.selector, who[i]));
        }
    }

    function strandToken(address token) external onlyOwner {
        _dlg(abi.encodeWithSelector(HoodxSwap.strandTokenRaw.selector, token));
    }

    function claimDust(address token) external nonReentrant {
        _dlg(abi.encodeWithSelector(HoodxSwap.claimDustRaw.selector, token));
    }

    /// @dev Rebind a zero-balance name to a new pool (e.g. PROMETHEUS/SPCX). Does not touch balances.
    function rebindToken(address token, bytes32 poolRef) external onlyOwner {
        _dlg(abi.encodeWithSelector(HoodxSwap.rebindTokenRaw.selector, token, poolRef));
    }

    function setCreatorRecipient(address who) external {
        if (msg.sender != creator) revert NotCreator();
        _assertPayTo(who, false);
        creatorRecipient = who;
        emit CreatorRecipient(who);
    }

    /// @dev Wallet/Blockscout token image. HTTPS or IPFS, max 256 chars, no quotes.
    function setImageURI(string calldata uri) external onlyOwner {
        _dlg(abi.encodeWithSelector(HoodxSwap.setImageURIRaw.selector, uri));
    }

    /// @dev ERC-7572 metadata. Explorers read `image` from this JSON.
    function contractURI() external view returns (string memory) {
        return string.concat(
            "data:application/json;utf8,{\"name\":\"",
            _jsonSafe(name),
            "\",\"symbol\":\"",
            _jsonSafe(symbol),
            "\",\"description\":\"HOODX index on Robinhood Chain\",\"image\":\"",
            imageURI,
            "\",\"external_url\":\"https://www.xhoodindex.com\"}"
        );
    }

    /// @dev Register a quote token (RH stock 18-dec, or USDG 6-dec) with its WETH V3 bridge.
    function setQuoteBridge(address quote, address v3Bridge) external onlyOwner {
        _dlg(abi.encodeWithSelector(HoodxSwap.setQuoteBridgeRaw.selector, quote, v3Bridge));
    }

    /// @dev WETH ↔ listed name on the bound V3 or V4 pool. Fee comes from the pool.
    ///      minOut must be ≥ 97% of the on-chain quote so the curator cannot sandwich the vault.
    function swapV3(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin)
        external
        onlyOwner
        nonReentrant
    {
        if (amountIn == 0 || amountOutMin == 0 || swapRouter == address(0)) revert Zero();
        bool buy = tokenIn == weth && listed[tokenOut];
        bool sell = tokenOut == weth && listed[tokenIn];
        if (!buy && !sell) revert BadPair();
        if (buy && paused) revert Paused();
        uint256 floor = minOutFloor(quoteOut(tokenIn, tokenOut, amountIn));
        if (floor == 0 || amountOutMin < floor) revert Slippage();
        _swap(tokenIn, tokenOut, amountIn, amountOutMin);
        if (buy) _assertCashFloor();
        _snapshotPx();
        emit Rebalanced(tokenIn, tokenOut, amountIn, amountOutMin);
    }

    /// @dev Permissionless. V3 only — V4 marks at spot, so a dump+sell would drain at the
    ///      crashed tick. Owner swapV3 still rebalances V4. 3% min-out vs TWAP.
    function restoreCash(address token, uint256 amountIn) external nonReentrant {
        if (!listed[token]) revert Listed();
        if (isV4[token]) revert BadPool();
        uint256 shortfall = cashShortfall();
        if (shortfall == 0) revert CashFloor();
        uint256 px = priceWethWad(token);
        uint256 maxIn = (shortfall * 1e18) / px;
        maxIn = (maxIn * (BPS_DENOM + MAX_SLIP_BPS)) / BPS_DENOM;
        if (maxIn == 0) revert TooSmall();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (amountIn == 0 || amountIn > bal) revert Zero();
        if (amountIn > maxIn) amountIn = maxIn;
        uint256 minOut = minOutFloor((amountIn * px) / 1e18);
        if (minOut == 0) revert TooSmall();
        _swap(token, weth, amountIn, minOut);
        _snapshotPx();
        emit Restored(token, amountIn, minOut);
    }

    function warmOracle(address token) public {
        _dlg(abi.encodeWithSelector(HoodxSwap.warmOracleRaw.selector, token));
    }

    function warmOracles() external {
        for (uint256 i; i < tokens.length; i++) warmOracle(tokens[i]);
    }

    function setCreatorFee(uint16 bps) external {
        if (msg.sender != creator) revert NotCreator();
        if (uint256(protocolFeeBps) + uint256(bps) > MAX_FEE_BPS) revert MaxFee();
        creatorFeeBps = bps;
        emit CreatorFee(bps);
    }

    function setGenesisEthPerShare(uint256 weiPerShare) external onlyOwner {
        if (totalSupply != 0) revert Started();
        if (weiPerShare < 0.01 ether || weiPerShare > 0.25 ether) revert TooSmall();
        genesisEthPerShare = weiPerShare;
        emit Genesis(weiPerShare);
    }

    function setFloors(uint256 minDep, uint256 minFirst, uint256 minSleeve, uint16 cashBps_) external onlyOwner {
        if (minDep < 0.001 ether || minFirst < minDep) revert TooSmall();
        if (minSleeve < 0.001 ether) revert TooSmall();
        if (cashBps_ < MIN_CASH_BPS || cashBps_ > 5000) revert CashFloor();
        minDeposit = minDep;
        minFirstDeposit = minFirst;
        minSleeveWeth = minSleeve;
        cashTargetBps = cashBps_;
        emit Floors(minDep, minFirst, minSleeve, cashBps_);
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
        emit PausedSet(v);
    }

    /// @dev Nominate a curator. They must `acceptOwnership` from that wallet.
    ///      Does not move `creator` or `creatorRecipient` — handing the book cannot steal the cut.
    function transferOwnership(address next) external onlyOwner {
        _assertPayTo(next, true);
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        _assertPayTo(msg.sender, true);
        pendingOwner = address(0);
        owner = msg.sender;
        emit OwnerSet(msg.sender);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        address pending = pendingOwner;
        if (pending == address(0)) revert Zero();
        pendingOwner = address(0);
        emit OwnershipTransferCanceled(owner, pending);
    }

    /// @dev Block 0 / vault / WETH / dead / routers so a typo cannot brick or burn the role.
    ///      `asCurator` also rejects the current owner (no-op self-transfer).
    function _assertPayTo(address who, bool asCurator) internal view {
        if (who == address(0)) revert Zero();
        if (asCurator && who == owner) revert BadOwner();
        if (
            who == address(this) ||
            who == weth ||
            who == DEAD ||
            who == factory ||
            who == swapRouter ||
            who == v4Manager ||
            who == v4StateView ||
            who == v4Posm
        ) revert BadOwner();
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert Zero();
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function _deployNet(uint256 net, uint256 assetsBefore, uint256 supply) internal {
        uint256 spent;
        uint256 names;
        if (supply == 0 || assetsBefore == 0) {
            (spent, names) = _deployTargets(net);
        } else {
            (spent, names) = _replicate(net, assetsBefore);
        }
        emit Deployed(spent, names);
    }

    function _deployTargets(uint256 net) internal returns (uint256 spent, uint256 names) {
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 sleeve = (net * uint256(targetBps[t])) / BPS_DENOM;
            if (sleeve < minSleeveWeth) continue;
            uint256 floor = _minOutOrZero(weth, t, sleeve);
            if (floor == 0) continue;
            if (!_swapOrSkip(weth, t, sleeve, floor)) continue;
            spent += sleeve;
            names++;
        }
    }

    function _replicate(uint256 net, uint256 assetsBefore) internal returns (uint256 spent, uint256 names) {
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 val = (bal * priceWethWad(t)) / 1e18;
            uint256 sleeve = (net * val) / assetsBefore;
            if (sleeve == 0) continue;
            uint256 floor = _minOutOrZero(weth, t, sleeve);
            if (floor == 0) continue;
            if (!_swapOrSkip(weth, t, sleeve, floor)) continue;
            spent += sleeve;
            names++;
        }
    }

    function _liquidate(uint256 shares, uint256 supply, bool sweep) internal {
        uint256 names;
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            uint256 amt = sweep ? bal : (bal * shares) / supply;
            if (amt == 0) continue;
            if (!_canLiquidate(t)) continue;
            uint256 floor = _minOutOrZero(t, weth, amt);
            if (floor == 0) continue;
            if (!_swapOrSkip(t, weth, amt, floor)) continue;
            names++;
        }
        emit Liquidated(shares, names);
    }

    function _previewTargets(uint256 net) internal view returns (uint256 spent, uint256 names) {
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 sleeve = (net * uint256(targetBps[t])) / BPS_DENOM;
            if (sleeve < minSleeveWeth) continue;
            if (_minOutOrZero(weth, t, sleeve) == 0) continue;
            spent += sleeve;
            names++;
        }
    }

    function _previewReplicate(uint256 net, uint256 assetsBefore) internal view returns (uint256 spent, uint256 names) {
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 val = (bal * priceWethWad(t)) / 1e18;
            uint256 sleeve = (net * val) / assetsBefore;
            if (sleeve == 0) continue;
            if (_minOutOrZero(weth, t, sleeve) == 0) continue;
            spent += sleeve;
            names++;
        }
    }

    function _minOutOrZero(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256) {
        try this.quoteOut(tokenIn, tokenOut, amountIn) returns (uint256 quoted) {
            return minOutFloor(quoted);
        } catch {
            return 0;
        }
    }

    /// @dev Hooked V4 pools cannot be sold with empty hookData — skip on redeem rather than brick exits.
    function _canLiquidate(address token) internal view returns (bool) {
        if (!isV4[token]) return poolOf[token] != address(0);
        PoolKey memory key = v4Key[token];
        return key.hooks == address(0);
    }

    function execSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _swap(tokenIn, tokenOut, amountIn, amountOutMin);
    }

    function _swapOrSkip(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin)
        internal
        returns (bool)
    {
        try this.execSwap(tokenIn, tokenOut, amountIn, amountOutMin) {
            return true;
        } catch {
            return false;
        }
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) internal {
        _dlg(abi.encodeWithSelector(HoodxSwap.swap.selector, tokenIn, tokenOut, amountIn, amountOutMin));
    }

    /// @dev PoolManager callback. Settles the vault as the locker so V4 swaps
    ///      do not need Permit2 / Universal Router.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        return _dlg(msg.data);
    }

    function _fees(uint256 weiIn) internal view returns (uint256 proto, uint256 creat) {
        proto = (weiIn * protocolFeeBps) / BPS_DENOM;
        creat = (weiIn * creatorFeeBps) / BPS_DENOM;
    }

    function _shiftCost(address from, address to, uint256 shares) internal {
        uint256 bal = balanceOf[from];
        uint256 cut = (costBasis[from] * shares) / bal;
        costBasis[from] -= cut;
        if (to != address(0)) costBasis[to] += cut;
    }

    function _mint(address to, uint256 value) internal {
        if (to == address(0) || value == 0) revert Zero();
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        if (balanceOf[from] < value) revert Zero();
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function _move(address from, address to, uint256 value) internal {
        if (to == address(0) || value == 0) revert Zero();
        if (balanceOf[from] < value) revert Zero();
        _shiftCost(from, to, value);
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _assertPriced() internal view {
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            if (IERC20(t).balanceOf(address(this)) == 0) continue;
            if (!_canLiquidate(t)) continue;
            if (priceWethWad(t) == 0) revert Unpriced();
        }
    }

    function _assertCashFloor() internal view {
        uint256 assets = totalAssets();
        if (assets == 0) return;
        if (wethBuffer() * BPS_DENOM < assets * uint256(cashTargetBps)) revert CashFloor();
    }

    function _jsonSafe(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length);
        uint256 n;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x22 || c == 0x5c || c < 0x20) continue;
            out[n] = c;
            n++;
        }
        bytes memory trimmed = new bytes(n);
        for (uint256 j; j < n; j++) trimmed[j] = out[j];
        return string(trimmed);
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
}
