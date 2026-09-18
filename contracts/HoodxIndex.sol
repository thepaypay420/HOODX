// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UniTwap, IUniV3Pool, IStateView, IPosm, PoolKey} from "./UniTwap.sol";

/// @title HoodxIndex — trustless ETH in / ETH out meme basket
/// @notice Cloneable vault. One share starts at $100 of ETH. Join mints at live
///         NAV per share, capped at net ETH in, with a required minShares (EIP-4626
///         inflation / sandwich). Dead shares capture donations. V4 mint NAV uses
///         max(spot, last tick) so a flash dump cannot cheapen the basket.
///         `owner` is the curator (two-step transfer). `creator` keeps the fee cut.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

interface IPoolManager {
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

contract HoodxIndex {
    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant MAX_FEE_BPS = 100;
    uint32 public constant TWAP_SECS = 60;
    uint16 public constant MAX_SLIP_BPS = 300; // 3% vs on-chain quote — not owner-set
    uint16 public constant ORACLE_CARDINALITY = 16;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    uint8 public constant decimals = 18;
    /// @dev Uniswap-V2 dead LP. ~$0.002 at genesis; captures pre-mint donations.
    uint256 public constant VIRTUAL_ASSETS = 1e12;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    string public name;
    string public symbol;
    address public factory;
    address public owner;
    address public pendingOwner;
    address public creator;
    address public creatorRecipient;
    address public protocol;
    address public weth;
    address public swapRouter;
    address public v4Manager;
    address public v4StateView;
    address public v4Posm;
    address[] public tokens;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint16) public targetBps;
    mapping(address => uint256) public costBasis;
    mapping(address => bool) public listed;
    mapping(address => address) public poolOf;
    mapping(address => bytes32) public poolIdOf;
    mapping(address => bool) public isV4;
    mapping(address => PoolKey) public v4Key;
    mapping(address => uint256) public lastPxWad;
    /// @dev Synthetic RH quote (SPCX/SPY/USDG). weth = direct ETH/WETH bind.
    mapping(address => address) public quoteOf;
    mapping(address => bool) public allowedQuote;
    /// @dev V3 TWAP bridge pool: quote ↔ WETH.
    mapping(address => address) public quoteBridgeV3;

    uint256 public totalSupply;
    uint16 public protocolFeeBps;
    uint16 public creatorFeeBps;
    uint16 public redeemFeeBps;
    uint16 public cashTargetBps;
    uint256 public minDeposit;
    uint256 public minFirstDeposit;
    uint256 public minSleeveWeth;
    uint256 public genesisEthPerShare;
    bool public paused;
    uint256 private locked;
    bool private implLock;

    error NotOwner();
    error NotCreator();
    error BadOwner();
    error Zero();
    error BadLen();
    error TooSmall();
    error DustSleeve();
    error NeedBuffer();
    error Paused();
    error TransferFailed();
    error Listed();
    error CashFloor();
    error MaxFee();
    error SwapFailed();
    error Unpriced();
    error AlreadyInit();
    error BadPair();
    error Slippage();
    error BadPool();
    error NotManager();
    error OnlySelf();
    error Started();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed user, uint256 ethIn, uint256 shares, uint256 protocolFee, uint256 creatorFee, uint256 sharePrice);
    event Withdraw(address indexed user, uint256 shares, uint256 ethOut, uint256 fee, uint256 sharePrice);
    event Deployed(uint256 wethSpent, uint256 names);
    event Liquidated(uint256 shares, uint256 names);
    event Targets(address[] tokens, uint16[] bps);
    event Rebalanced(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 minOut);
    event Restored(address indexed token, uint256 amountIn, uint256 minOut);
    event CreatorFee(uint16 bps);
    event CreatorRecipient(address indexed who);
    event TokenAdded(address indexed token, bytes32 poolRef, bool v4);
    event TokenRebound(address indexed token, bytes32 poolRef, bool v4);
    event TokenRemoved(address indexed token);
    event Floors(uint256 minDeposit, uint256 minFirst, uint256 minSleeve, uint16 cashBps);
    event Genesis(uint256 ethPerShare);
    event PausedSet(bool paused);
    event OwnerSet(address indexed owner);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferCanceled(address indexed owner, address indexed pending);

    struct InitParams {
        address creator;
        address protocol;
        address weth;
        address router;
        address v4Manager;
        address v4StateView;
        address v4Posm;
        string name;
        string symbol;
        uint16 protocolFeeBps;
        uint16 creatorFeeBps;
        uint256 minFirstDeposit;
        address recipient;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 0) revert SwapFailed();
        locked = 1;
        _;
        locked = 0;
    }

    constructor() {
        implLock = true;
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
        _initRhQuotes();
        for (uint256 i; i < constituents.length; i++) {
            _addToken(constituents[i], pools[i]);
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

    /// @dev WETH per 1e18 token. V3 uses the pool TWAP; V4 uses StateView spot tick.
    ///      Synthetic-quote names price through a whitelisted quote + V3 quote/WETH bridge.
    function priceWethWad(address token) public view returns (uint256) {
        if (token == weth) return 1e18;
        if (allowedQuote[token] && quoteBridgeV3[token] != address(0)) {
            return UniTwap.priceWethWad(quoteBridgeV3[token], token, weth, TWAP_SECS);
        }
        address quote = quoteOf[token];
        if (isV4[token]) {
            if (quote == address(0) || quote == weth) {
                PoolKey memory key = v4Key[token];
                return UniTwap.priceWethWadV4(v4StateView, poolIdOf[token], token, key.currency0, key.currency1, weth);
            }
            uint256 quotePerToken = _spotQuotePerToken(token);
            uint256 wethPerQuote = priceWethWad(quote);
            return (quotePerToken * wethPerQuote) / 1e18;
        }
        address pool = poolOf[token];
        if (pool == address(0)) revert Listed();
        return UniTwap.priceWethWad(pool, token, weth, TWAP_SECS);
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
        value = (shares * totalAssets()) / supply;
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
        uint256 value = (shares * totalAssets()) / supply;
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
            uint256 floor = _minOutOrZero(t, weth, amt);
            if (floor == 0) return (0, 0);
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
        (uint256 minOut, ) = previewSell(shares);
        if (minOut == 0) revert NeedBuffer();
        if (minEthOut > minOut) minOut = minEthOut;
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        bool sweep = shares == supply || shares == _liveSupply();
        uint256 cashTake = sweep ? wethBefore : (wethBefore * shares) / supply;
        _liquidate(shares, supply, sweep);
        uint256 proceeds = IERC20(weth).balanceOf(address(this)) - wethBefore;
        net = cashTake + proceeds;
        if (net < minOut) revert Slippage();
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
        _addToken(token, poolRef);
    }

    function addTokens(address[] calldata who, bytes32[] calldata pools) external onlyOwner {
        if (who.length != pools.length) revert BadLen();
        for (uint256 i; i < who.length; i++) _addToken(who[i], pools[i]);
    }

    function removeToken(address token) external onlyOwner {
        _removeToken(token);
    }

    function removeTokens(address[] calldata who) external onlyOwner {
        for (uint256 i; i < who.length; i++) _removeToken(who[i]);
    }

    /// @dev Rebind a zero-balance name to a new pool (e.g. PROMETHEUS/SPCX). Does not touch balances.
    function rebindToken(address token, bytes32 poolRef) external onlyOwner {
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
    }

    function _bindPool(address token, address pool) internal view {
        if (pool == address(0) || pool.code.length == 0) revert BadPool();
        address t0 = IUniV3Pool(pool).token0();
        address t1 = IUniV3Pool(pool).token1();
        if (!((token == t0 && weth == t1) || (token == t1 && weth == t0))) revert BadPool();
        if (IERC20(token).decimals() != 18) revert BadPool();
        IUniV3Pool(pool).fee();
        quoteOf[token] = weth;
    }

    function _bindV4(address token, bytes32 poolId) internal {
        (address c0, address c1, uint24 fee, int24 spacing, address hooks) = IPosm(v4Posm).poolKeys(bytes25(poolId));
        if (c1 == address(0)) revert BadPool();
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
        } else if (allowedQuote[other] && quoteBridgeV3[other] != address(0)) {
            quoteOf[token] = other;
        } else revert BadPool();
        if (IERC20(token).decimals() != 18) revert BadPool();
        (uint160 sqrtP, , , ) = IStateView(v4StateView).getSlot0(poolId);
        if (sqrtP == 0) revert BadPool();
        isV4[token] = true;
        poolIdOf[token] = poolId;
        v4Key[token] = key;
    }

    function _removeToken(address token) internal {
        if (!listed[token]) revert Listed();
        if (IERC20(token).balanceOf(address(this)) != 0) revert NeedBuffer();
        uint256 n = tokens.length;
        if (n <= 2) revert BadLen();
        listed[token] = false;
        targetBps[token] = 0;
        delete poolOf[token];
        delete poolIdOf[token];
        delete isV4[token];
        delete v4Key[token];
        delete quoteOf[token];
        delete lastPxWad[token];
        for (uint256 i; i < n; i++) {
            if (tokens[i] == token) {
                tokens[i] = tokens[n - 1];
                tokens.pop();
                break;
            }
        }
        emit TokenRemoved(token);
    }

    function setCreatorRecipient(address who) external {
        if (msg.sender != creator) revert NotCreator();
        _assertPayTo(who, false);
        creatorRecipient = who;
        emit CreatorRecipient(who);
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
        if (isV4[token]) return;
        address pool = poolOf[token];
        if (pool == address(0)) revert Listed();
        IUniV3Pool(pool).increaseObservationCardinalityNext(ORACLE_CARDINALITY);
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
        if (cashBps_ < 1000 || cashBps_ > 5000) revert CashFloor();
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
            uint256 floor = _minOutOrZero(t, weth, amt);
            if (floor == 0) revert Unpriced();
            _swap(t, weth, amt, floor);
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
        address listedTok = tokenIn == weth ? tokenOut : tokenIn;
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
        uint24 fee = IUniV3Pool(pool).fee();
        IERC20(tokenIn).approve(swapRouter, amountIn);
        ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).approve(swapRouter, 0);
    }

    /// @dev PoolManager callback. Settles the vault as the locker so V4 swaps
    ///      do not need Permit2 / Universal Router.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
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
            if (priceWethWad(t) == 0) revert Unpriced();
        }
    }

    function _assertCashFloor() internal view {
        uint256 assets = totalAssets();
        if (assets == 0) return;
        if (wethBuffer() * BPS_DENOM < assets * uint256(cashTargetBps)) revert CashFloor();
    }

    function _initRhQuotes() internal {
        address spcx = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
        address spy = 0x117cc2133c37b721f49de2a7a74833232b3b4c0c;
        allowedQuote[spcx] = true;
        quoteBridgeV3[spcx] = 0xC3c9F0171490Ef0F4536fe493F3b0EbB5ee0CB5e;
        allowedQuote[spy] = true;
        quoteBridgeV3[spy] = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;
    }

    function _clearBind(address token) internal {
        delete poolOf[token];
        delete poolIdOf[token];
        delete isV4[token];
        delete v4Key[token];
        delete quoteOf[token];
        delete lastPxWad[token];
    }

    function _spotQuotePerToken(address token) internal view returns (uint256) {
        PoolKey memory key = v4Key[token];
        (, int24 tick, , ) = IStateView(v4StateView).getSlot0(poolIdOf[token]);
        return UniTwap.quoteAtTick(tick, 1e18, token == key.currency0);
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
        uint256 pxQuote = priceWethWad(quote);
        uint256 quotedQuote = (wethIn * 1e18) / pxQuote;
        uint256 quoteFloor = minOutFloor(quotedQuote);
        IERC20(weth).approve(swapRouter, wethIn);
        uint256 quoteGot = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: quote,
                fee: IUniV3Pool(bridge).fee(),
                recipient: address(this),
                amountIn: wethIn,
                amountOutMinimum: quoteFloor,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(weth).approve(swapRouter, 0);
        _swapV4Exact(quote, token, quoteGot, minTokenOut);
    }

    function _swapQuotedSell(address token, address quote, uint256 tokenIn, uint256 minWethOut) internal {
        address bridge = quoteBridgeV3[quote];
        if (bridge == address(0)) revert BadPool();
        uint256 quotedQuote = _spotQuotePerToken(token);
        quotedQuote = (tokenIn * quotedQuote) / 1e18;
        uint256 quoteFloor = minOutFloor(quotedQuote);
        uint256 quoteGot = _swapV4Exact(token, quote, tokenIn, quoteFloor);
        uint256 pxQuote = priceWethWad(quote);
        uint256 quotedWeth = (quoteGot * pxQuote) / 1e18;
        uint256 wethFloor = minOutFloor(quotedWeth);
        if (wethFloor < minWethOut) revert Slippage();
        IERC20(quote).approve(swapRouter, quoteGot);
        ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: quote,
                tokenOut: weth,
                fee: IUniV3Pool(bridge).fee(),
                recipient: address(this),
                amountIn: quoteGot,
                amountOutMinimum: minWethOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(quote).approve(swapRouter, 0);
    }
}
