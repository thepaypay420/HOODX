// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HoodxIndex — ETH in / ETH out meme basket
/// @notice Cloneable vault. Factory deploys one per index. Isolated from the LP desk.
///
/// Friends ape ETH. Vault wraps to WETH, splits a small join fee (protocol + creator),
/// mints index tokens. Cash sits until a sleeve clears minSleeveWeth. Redeem is ETH
/// from the buffer — never 17 airdropped dust bags.
///
/// 696x is index zero (696_eth watchlist). Anyone else mints their own via HoodxFactory.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
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

contract HoodxIndex {
    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant MAX_FEE_BPS = 100; // 1% combined cap
    uint8 public constant decimals = 18;

    string public name;
    string public symbol;
    address public factory;
    address public owner; // curator — add/remove, rebalance
    address public creator; // original minter — can reroute creator fees (e.g. to 696)
    address public creatorRecipient; // where creator bps are paid
    address public protocol; // platform cut
    address public weth;
    address public swapRouter;
    address[] public tokens;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint16) public targetBps;
    mapping(address => uint256) public priceWethWad;
    mapping(address => bool) public listed;

    uint256 public totalSupply;
    uint16 public protocolFeeBps;
    uint16 public creatorFeeBps;
    uint16 public redeemFeeBps;
    uint16 public cashTargetBps;
    uint256 public minDeposit;
    uint256 public minFirstDeposit;
    uint256 public minSleeveWeth;
    bool public paused;
    uint256 private locked;
    bool private implLock;

    error NotOwner();
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

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed user, uint256 ethIn, uint256 shares, uint256 protocolFee, uint256 creatorFee);
    event Withdraw(address indexed user, uint256 shares, uint256 ethOut, uint256 fee);
    event Targets(address[] tokens, uint16[] bps);
    event Prices(address[] tokens, uint256[] priceWethWad);
    event Rebalanced(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 minOut);
    event CreatorFee(uint16 bps);
    event CreatorRecipient(address indexed who);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);

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
        implLock = true; // implementation cannot be initialized
    }

    function initialize(
        address creator_,
        address protocol_,
        address weth_,
        address router_,
        string calldata name_,
        string calldata symbol_,
        address[] calldata constituents,
        uint16 protocolFeeBps_,
        uint16 creatorFeeBps_,
        uint256 minFirstDeposit_,
        address recipient_
    ) external {
        if (implLock || factory != address(0)) revert AlreadyInit();
        if (creator_ == address(0) || protocol_ == address(0) || weth_ == address(0)) revert Zero();
        if (constituents.length < 2 || constituents.length > 24) revert BadLen();
        if (uint256(protocolFeeBps_) + uint256(creatorFeeBps_) > MAX_FEE_BPS) revert MaxFee();
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) revert Zero();
        factory = msg.sender;
        owner = creator_;
        creator = creator_;
        creatorRecipient = recipient_ == address(0) ? creator_ : recipient_;
        protocol = protocol_;
        weth = weth_;
        swapRouter = router_;
        name = name_;
        symbol = symbol_;
        protocolFeeBps = protocolFeeBps_;
        creatorFeeBps = creatorFeeBps_;
        cashTargetBps = 2500;
        minDeposit = 0.02 ether;
        minFirstDeposit = minFirstDeposit_;
        minSleeveWeth = 0.004 ether;
        for (uint256 i; i < constituents.length; i++) {
            address t = constituents[i];
            if (t == address(0) || t == weth_ || listed[t]) revert Listed();
            listed[t] = true;
            tokens.push(t);
        }
    }

    receive() external payable {
        if (msg.sender != weth) revert TransferFailed();
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

    function totalAssets() public view returns (uint256 assets) {
        assets = IERC20(weth).balanceOf(address(this)) + address(this).balance;
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 px = priceWethWad[t];
            if (px == 0) continue;
            assets += (bal * px) / 1e18;
        }
    }

    function previewDeposit(uint256 weiIn) public view returns (uint256 shares, uint256 fee) {
        (uint256 proto, uint256 creat) = _fees(weiIn);
        fee = proto + creat;
        uint256 net = weiIn - fee;
        uint256 supply = totalSupply;
        if (supply == 0) return (net, fee);
        uint256 assets = totalAssets();
        if (assets == 0) return (0, fee);
        shares = (net * supply) / assets;
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

    function canWithdraw(uint256 shares) external view returns (bool) {
        (uint256 net, uint256 fee) = previewWithdraw(shares);
        return wethBuffer() >= net + fee;
    }

    function deposit() external payable nonReentrant returns (uint256 shares) {
        if (paused) revert Paused();
        uint256 gross = msg.value;
        if (gross < minDeposit) revert TooSmall();
        (uint256 proto, uint256 creat) = _fees(gross);
        uint256 net = gross - proto - creat;
        uint256 supply = totalSupply;
        uint256 assetsBefore = totalAssets() - gross;
        IWETH(weth).deposit{value: gross}();
        if (proto > 0) {
            if (!IERC20(weth).transfer(protocol, proto)) revert TransferFailed();
        }
        if (creat > 0) {
            if (!IERC20(weth).transfer(creatorRecipient, creat)) revert TransferFailed();
        }
        if (supply == 0) {
            if (net < minFirstDeposit) revert TooSmall();
            shares = net;
        } else {
            if (assetsBefore == 0) revert Zero();
            shares = (net * supply) / assetsBefore;
            if (shares == 0) revert TooSmall();
        }
        _mint(msg.sender, shares);
        emit Deposit(msg.sender, gross, shares, proto, creat);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 net) {
        if (paused) revert Paused();
        if (shares == 0 || balanceOf[msg.sender] < shares) revert Zero();
        uint256 supply = totalSupply;
        uint256 value = (shares * totalAssets()) / supply;
        uint256 fee = (value * redeemFeeBps) / BPS_DENOM;
        net = value - fee;
        if (wethBuffer() < net + fee) revert NeedBuffer();
        _burn(msg.sender, shares);
        if (fee > 0) {
            if (!IERC20(weth).transfer(protocol, fee)) revert TransferFailed();
        }
        IWETH(weth).withdraw(net);
        (bool ok, ) = msg.sender.call{value: net}("");
        if (!ok) revert TransferFailed();
        emit Withdraw(msg.sender, shares, net, fee);
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

    function setPrices(address[] calldata who, uint256[] calldata px) external onlyOwner {
        if (who.length != px.length) revert BadLen();
        for (uint256 i; i < who.length; i++) {
            if (!listed[who[i]]) revert Listed();
            if (px[i] == 0) revert Unpriced();
            priceWethWad[who[i]] = px[i];
        }
        emit Prices(who, px);
    }

    function constituents() external view returns (address[] memory) {
        return tokens;
    }

    function addToken(address token) external onlyOwner {
        _addToken(token);
    }

    function addTokens(address[] calldata who) external onlyOwner {
        for (uint256 i; i < who.length; i++) _addToken(who[i]);
    }

    /// @dev Drop a name from the pack. Sell it to WETH first if the vault still holds any.
    function removeToken(address token) external onlyOwner {
        _removeToken(token);
    }

    function removeTokens(address[] calldata who) external onlyOwner {
        for (uint256 i; i < who.length; i++) _removeToken(who[i]);
    }

    function _addToken(address token) internal {
        if (token == address(0) || token == weth || listed[token]) revert Listed();
        if (tokens.length >= 24) revert BadLen();
        listed[token] = true;
        tokens.push(token);
        emit TokenAdded(token);
    }

    function _removeToken(address token) internal {
        if (!listed[token]) revert Listed();
        if (IERC20(token).balanceOf(address(this)) != 0) revert NeedBuffer();
        uint256 n = tokens.length;
        if (n <= 2) revert BadLen();
        listed[token] = false;
        targetBps[token] = 0;
        for (uint256 i; i < n; i++) {
            if (tokens[i] == token) {
                tokens[i] = tokens[n - 1];
                tokens.pop();
                break;
            }
        }
        emit TokenRemoved(token);
    }

    /// @dev Point creator fees at another wallet (e.g. 696) without giving up curation.
    function setCreatorRecipient(address who) external {
        if (msg.sender != creator && msg.sender != owner) revert NotOwner();
        if (who == address(0)) revert Zero();
        creatorRecipient = who;
        emit CreatorRecipient(who);
    }

    function swapV3(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMin)
        external
        onlyOwner
        nonReentrant
    {
        if (amountIn == 0 || swapRouter == address(0)) revert Zero();
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
        emit Rebalanced(tokenIn, tokenOut, amountIn, amountOutMin);
    }

    function execSwap(
        address spender,
        bytes calldata data,
        uint256 value,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minOut
    ) external onlyOwner nonReentrant {
        if (spender == address(0) || minOut == 0) revert Zero();
        uint256 outBefore = _bal(tokenOut);
        if (amountIn > 0) IERC20(tokenIn).approve(spender, amountIn);
        (bool ok, ) = spender.call{value: value}(data);
        if (!ok) revert SwapFailed();
        if (amountIn > 0) IERC20(tokenIn).approve(spender, 0);
        if (_bal(tokenOut) < outBefore + minOut) revert SwapFailed();
        emit Rebalanced(tokenIn, tokenOut, amountIn, minOut);
    }

    function setCreatorFee(uint16 bps) external onlyOwner {
        if (uint256(protocolFeeBps) + uint256(bps) > MAX_FEE_BPS) revert MaxFee();
        creatorFeeBps = bps;
        emit CreatorFee(bps);
    }

    function setFloors(uint256 minDep, uint256 minFirst, uint256 minSleeve, uint16 cashBps_) external onlyOwner {
        if (cashBps_ > 5000) revert CashFloor();
        minDeposit = minDep;
        minFirstDeposit = minFirst;
        minSleeveWeth = minSleeve;
        cashTargetBps = cashBps_;
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert Zero();
        owner = next;
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

    function _fees(uint256 weiIn) internal view returns (uint256 proto, uint256 creat) {
        proto = (weiIn * protocolFeeBps) / BPS_DENOM;
        creat = (weiIn * creatorFeeBps) / BPS_DENOM;
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
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _bal(address token) internal view returns (uint256) {
        if (token == address(0) || token == weth) {
            return token == weth ? IERC20(weth).balanceOf(address(this)) + address(this).balance : address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }
}
