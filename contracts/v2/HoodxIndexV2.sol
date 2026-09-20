// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IV2Policy, IV2Executor, IV2Oracle, IV2Weth} from "./Types.sol";

/// @notice New immutable vault implementation. Not an upgrade to historical HOODX clones.
contract HoodxIndexV2 is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IV2Policy public immutable policy;
    IV2Executor public immutable executor;
    address public immutable weth;
    bool private initialized;
    bool public paused;
    string private vaultName;
    string private vaultSymbol;
    string public imageURI;
    address public creator;
    address public creatorRecipient;
    address public treasury;
    uint16 public creatorFeeBps;
    uint16 public protocolFeeBps;
    uint16 public cashTargetBps;
    uint256 public minFirstDeposit;
    uint256 public constant MIN_DEPOSIT = 0.02 ether;
    uint256 public constant MIN_SHARES = 1e12;
    uint256 public constant MIN_SLEEVE = 0.0001 ether;
    uint256 public constant VIRTUAL = 1e12;
    uint256 public constant VIRTUAL_SHARES = 25e12; // preserve 0.04 ETH genesis price per share
    uint256 public constant BPS = 10_000;
    address[] private tokens;
    mapping(address => bytes32) public configId;
    mapping(address => uint16) public targetBps;
    mapping(address => uint256) public reserved;
    mapping(address => mapping(address => uint256)) public claimable;

    struct Init {
        address curator;
        address creator;
        address recipient;
        address treasury;
        string name;
        string symbol;
        uint16 creatorFee;
        uint16 protocolFee;
        uint16 cashBps;
        uint256 firstDeposit;
        string image;
    }
    error Invalid();
    error Paused();
    error Slippage();
    error OnlySelf();
    error NotCreator();
    error HeldAsset();
    event Deposit(address indexed user, uint256 gross, uint256 shares, uint256 fee);
    event Withdraw(address indexed user, uint256 shares, uint256 ethOut);
    event BuyDeferred(address indexed token, uint256 wethAmount, bytes32 reasonHash);
    event InKindReserved(address indexed user, uint256 shares);
    event AssetClaimed(address indexed user, address indexed token, address recipient, uint256 amount);
    event ClaimDeferred(address indexed user, address indexed token, uint256 amount);
    event EmergencyUnwind(address indexed token, uint256 amount, uint256 wethOut);
    event PauseChanged(bool paused);
    event ConstituentChanged(address indexed token, bytes32 config);
    event TargetsChanged(uint16 cashBps, uint16[] weights);
    event CreatorEconomicsChanged(address recipient, uint16 fee);

    constructor(address policy_) ERC20("", "") Ownable(address(1)) {
        if (policy_.code.length == 0) revert Invalid();
        policy = IV2Policy(policy_);
        executor = IV2Executor(policy.executor());
        weth = executor.weth();
        initialized = true;
    }

    function initialize(Init calldata p, bytes32[] calldata configs, uint16[] calldata weights) external {
        if (initialized || configs.length < 2 || configs.length > 24 || configs.length != weights.length) {
            revert Invalid();
        }
        initialized = true;
        if (
            !_role(p.curator) || !_role(p.creator) || !_role(p.recipient) || !_role(p.treasury)
                || bytes(p.name).length == 0 || bytes(p.name).length > 64 || bytes(p.symbol).length == 0
                || bytes(p.symbol).length > 16 || p.creatorFee > 50 || p.protocolFee > 50
                || p.firstDeposit < MIN_DEPOSIT
        ) revert Invalid();
        vaultName = p.name;
        vaultSymbol = p.symbol;
        _image(p.image);
        _transferOwnership(p.curator);
        creator = p.creator;
        creatorRecipient = p.recipient;
        treasury = p.treasury;
        creatorFeeBps = p.creatorFee;
        protocolFeeBps = p.protocolFee;
        minFirstDeposit = p.firstDeposit;
        for (uint256 i; i < configs.length; ++i) {
            _add(configs[i]);
        }
        _targets(p.cashBps, weights);
    }
    receive() external payable {}
    event ContractURIUpdated();

    function setImageURI(string calldata uri) external onlyOwner {
        _image(uri);
    }

    function _image(string memory uri) internal {
        bytes memory b = bytes(uri);
        if (b.length > 256) revert Invalid();
        if (b.length != 0) {
            bool https = b.length >= 8 && bytes8(b) == bytes8("https://");
            bool ipfs = b.length >= 7 && bytes7(b) == bytes7("ipfs://");
            if (!https && !ipfs) revert Invalid();
        }
        imageURI = uri;
        emit ContractURIUpdated();
    }

    function contractURI() external view returns (string memory) {
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        '{"name":"',
                        Strings.escapeJSON(vaultName),
                        '","symbol":"',
                        Strings.escapeJSON(vaultSymbol),
                        '","image":"',
                        Strings.escapeJSON(imageURI),
                        '"}'
                    )
                )
            )
        );
    }

    function name() public view override returns (string memory) {
        return vaultName;
    }

    function symbol() public view override returns (string memory) {
        return vaultSymbol;
    }

    function constituents() external view returns (address[] memory) {
        return tokens;
    }

    function freeBalance(address token) public view returns (uint256) {
        uint256 balance = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        return balance - reserved[token];
    }

    function totalAssets() public view returns (uint256 value) {
        value = freeBalance(address(0)) + freeBalance(weth);
        for (uint256 i; i < tokens.length; ++i) {
            uint256 bal = freeBalance(tokens[i]);
            if (bal != 0) value += _value(tokens[i], bal);
        }
    }

    function _value(address token, uint256 amount) internal view returns (uint256 v) {
        (, address oracle,,) = policy.config(configId[token]);
        v = IV2Oracle(oracle).value(token, amount);
        if (v == 0 && amount != 0) revert Invalid();
    }

    function previewDeposit(uint256 gross) external view returns (uint256) {
        uint256 net = gross - Math.mulDiv(gross, protocolFeeBps + creatorFeeBps, BPS);
        return Math.mulDiv(net, totalSupply() + VIRTUAL_SHARES, totalAssets() + VIRTUAL);
    }

    function deposit(uint256 minShares, uint256 deadline) external payable nonReentrant returns (uint256 shares) {
        if (paused) revert Paused();
        if (
            !initialized || minShares < MIN_SHARES || msg.value < MIN_DEPOSIT
                || (totalSupply() == 0 && msg.value < minFirstDeposit) || deadline < block.timestamp
        ) revert Invalid();
        // With no active shareholders, pre-existing donations belong to no depositor.
        // Reserve them for the disclosed treasury, excluding the current msg.value.
        if (totalSupply() == 0) {
            uint256 nativeOrphan = freeBalance(address(0)) - msg.value;
            reserved[address(0)] += nativeOrphan;
            claimable[treasury][address(0)] += nativeOrphan;
            _reserve(treasury, weth, 1, 1);
            for (uint256 i; i < tokens.length; ++i) {
                _reserve(treasury, tokens[i], 1, 1);
            }
        }
        uint256 beforeAssets = totalAssets() - msg.value;
        uint256 supply = totalSupply();
        uint256 proto = Math.mulDiv(msg.value, protocolFeeBps, BPS);
        uint256 fee = Math.mulDiv(msg.value, creatorFeeBps, BPS);
        uint256 net = msg.value - proto - fee;
        IV2Weth(weth).deposit{value: msg.value}();
        if (proto != 0) IERC20(weth).safeTransfer(treasury, proto);
        if (fee != 0) IERC20(weth).safeTransfer(creatorRecipient, fee);
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 amount = Math.mulDiv(net, targetBps[t], BPS);
            if (amount < MIN_SLEEVE) continue;
            // Oracle failure is fail-closed. A fully reverted execution failure retains this leg in WETH.
            uint256 unit = 10 ** 18;
            uint256 px = _value(t, unit);
            uint256 floor = Math.mulDiv(Math.mulDiv(amount, unit, px), 9700, BPS);
            if (floor == 0) continue;
            try this.executeBuy(t, amount, floor, deadline) {}
            catch (bytes memory reason) {
                emit BuyDeferred(t, amount, keccak256(reason));
            }
        }
        uint256 afterAssets = totalAssets();
        uint256 credit = afterAssets > beforeAssets ? Math.min(afterAssets - beforeAssets, net) : 0;
        shares = Math.mulDiv(credit, supply + VIRTUAL_SHARES, beforeAssets + VIRTUAL);
        if (shares < minShares || shares < MIN_SHARES) revert Slippage();
        _mint(msg.sender, shares);
        emit Deposit(msg.sender, msg.value, shares, proto + fee);
    }

    function executeBuy(address token, uint256 amount, uint256 floor, uint256 deadline) external {
        if (msg.sender != address(this)) revert OnlySelf();
        (,, bytes memory buy,) = policy.config(configId[token]);
        _trade(weth, token, amount, floor, buy, deadline);
    }

    function _trade(address input, address output, uint256 amount, uint256 floor, bytes memory route, uint256 deadline)
        internal
        returns (uint256 got)
    {
        if (amount == 0 || amount > freeBalance(input) || floor == 0) revert Invalid();
        uint256 beforeIn = IERC20(input).balanceOf(address(this));
        uint256 beforeOut = IERC20(output).balanceOf(address(this));
        IERC20(input).forceApprove(address(executor), amount);
        executor.execute(input, output, amount, floor, route, deadline);
        IERC20(input).forceApprove(address(executor), 0);
        got = IERC20(output).balanceOf(address(this)) - beforeOut;
        if (beforeIn - IERC20(input).balanceOf(address(this)) != amount || got < floor) revert Slippage();
    }

    function _sell(address token, uint256 amount, uint256 minOut, uint256 deadline) internal returns (uint256) {
        uint256 floor = Math.mulDiv(_value(token, amount), 9700, BPS);
        (,,, bytes memory sell) = policy.config(configId[token]);
        return _trade(token, weth, amount, Math.max(floor, minOut), sell, deadline);
    }

    function withdraw(uint256 shares, uint256 minEthOut, uint256 deadline) external nonReentrant returns (uint256 net) {
        if (shares == 0 || shares > balanceOf(msg.sender) || minEthOut == 0 || deadline < block.timestamp) {
            revert Invalid();
        }
        uint256 supply = totalSupply();
        uint256 cash = Math.mulDiv(freeBalance(weth), shares, supply);
        uint256 nativeTake = Math.mulDiv(freeBalance(address(0)), shares, supply);
        uint256 proceeds;
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 amount = Math.mulDiv(freeBalance(t), shares, supply);
            if (amount != 0) proceeds += _sell(t, amount, 1, deadline); // any failure reverts this entire withdrawal
        }
        net = cash + nativeTake + proceeds;
        if (net < minEthOut) revert Slippage();
        _burn(msg.sender, shares);
        if (cash + proceeds != 0) IV2Weth(weth).withdraw(cash + proceeds);
        (bool ok,) = msg.sender.call{value: net}("");
        if (!ok) revert Invalid();
        emit Withdraw(msg.sender, shares, net);
    }

    /// @notice Reserves every proportional asset before burning; failed transfers remain individually claimable.
    function emergencyRedeemInKind(uint256 shares, address recipient) external nonReentrant {
        if (shares == 0 || shares > balanceOf(msg.sender) || !_recipient(recipient)) revert Invalid();
        uint256 supply = totalSupply();
        _reserve(msg.sender, address(0), shares, supply);
        _reserve(msg.sender, weth, shares, supply);
        for (uint256 i; i < tokens.length; ++i) {
            _reserve(msg.sender, tokens[i], shares, supply);
        }
        _burn(msg.sender, shares);
        emit InKindReserved(msg.sender, shares);
        _attempt(msg.sender, address(0), recipient);
        _attempt(msg.sender, weth, recipient);
        for (uint256 i; i < tokens.length; ++i) {
            _attempt(msg.sender, tokens[i], recipient);
        }
    }

    function _reserve(address user, address token, uint256 shares, uint256 supply) private {
        uint256 amount = Math.mulDiv(freeBalance(token), shares, supply);
        reserved[token] += amount;
        claimable[user][token] += amount;
    }

    function _attempt(address user, address token, address recipient) private {
        if (claimable[user][token] == 0) return;
        try this.payClaim{gas: 150_000}(user, token, recipient) {}
        catch {
            emit ClaimDeferred(user, token, claimable[user][token]);
        }
    }

    function claim(address token, address recipient) external nonReentrant {
        if (!_recipient(recipient)) revert Invalid();
        this.payClaim(msg.sender, token, recipient);
    }

    function payClaim(address user, address token, address recipient) external {
        if (msg.sender != address(this)) revert OnlySelf();
        uint256 amount = claimable[user][token];
        if (amount == 0) revert Invalid();
        claimable[user][token] = 0;
        reserved[token] -= amount;
        if (token == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert Invalid();
        } else {
            uint256 beforeVault = IERC20(token).balanceOf(address(this));
            uint256 beforeRecipient = IERC20(token).balanceOf(recipient);
            IERC20(token).safeTransfer(recipient, amount);
            if (
                beforeVault - IERC20(token).balanceOf(address(this)) != amount
                    || IERC20(token).balanceOf(recipient) - beforeRecipient != amount
            ) revert Invalid();
        }
        emit AssetClaimed(user, token, recipient, amount);
    }

    function emergencyUnwind(address token, uint256 amount, uint256 minOut, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint256 got)
    {
        if (!paused || configId[token] == 0 || minOut == 0) revert Invalid();
        got = _sell(token, amount, minOut, deadline);
        emit EmergencyUnwind(token, amount, got);
    }

    function rebalance(address token, bool buy, uint256 amount, uint256 minOut, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        if (configId[token] == 0 || minOut == 0) revert Invalid();
        if (buy) {
            if (paused) revert Paused();
            uint256 floor = Math.mulDiv(Math.mulDiv(amount, 1e18, _value(token, 1e18)), 9700, BPS);
            this.executeBuy(token, amount, Math.max(floor, minOut), deadline);
            if (freeBalance(weth) < Math.mulDiv(totalAssets(), cashTargetBps, BPS)) revert Invalid();
        } else {
            _sell(token, amount, minOut, deadline);
        }
    }

    function setPaused(bool value) external onlyOwner nonReentrant {
        paused = value;
        emit PauseChanged(value);
    }

    function setTargets(uint16 cashBps, uint16[] calldata weights) external onlyOwner nonReentrant {
        _targets(cashBps, weights);
    }

    function _targets(uint16 cashBps, uint16[] calldata weights) private {
        if (weights.length != tokens.length || cashBps < 2000 || cashBps > 5000) revert Invalid();
        uint256 sum = cashBps;
        for (uint256 i; i < weights.length; ++i) {
            sum += weights[i];
            targetBps[tokens[i]] = weights[i];
        }
        if (sum != BPS) revert Invalid();
        cashTargetBps = cashBps;
        emit TargetsChanged(cashBps, weights);
    }

    function addConstituent(bytes32 id) external onlyOwner nonReentrant {
        if (paused) revert Paused();
        _add(id);
    }

    function _add(bytes32 id) private {
        (address t, address oracle, bytes memory buy, bytes memory sell) = policy.config(id);
        if (tokens.length >= 24 || t == weth || t == address(0) || t == address(this) || configId[t] != 0) {
            revert Invalid();
        }
        executor.validateRoute(buy, weth, t);
        executor.validateRoute(sell, t, weth);
        if (IV2Oracle(oracle).value(t, 1e18) == 0) revert Invalid();
        configId[t] = id;
        tokens.push(t);
        emit ConstituentChanged(t, id);
    }

    function replaceConfig(bytes32 id) external onlyOwner nonReentrant {
        (address t, address oracle, bytes memory buy, bytes memory sell) = policy.config(id);
        if (configId[t] == 0 || IV2Oracle(oracle).value(t, 1e18) == 0) revert Invalid();
        executor.validateRoute(buy, weth, t);
        executor.validateRoute(sell, t, weth);
        configId[t] = id;
        emit ConstituentChanged(t, id);
    }

    function removeConstituent(address t) external onlyOwner nonReentrant {
        if (tokens.length <= 2 || configId[t] == 0 || IERC20(t).balanceOf(address(this)) != 0 || reserved[t] != 0) {
            revert HeldAsset();
        }
        if (targetBps[t] != 0) revert Invalid();
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == t) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }
        delete configId[t];
        emit ConstituentChanged(t, 0);
    }

    function setCreatorEconomics(address recipient, uint16 fee) external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (!_role(recipient) || fee > 50) revert Invalid();
        creatorRecipient = recipient;
        creatorFeeBps = fee;
        emit CreatorEconomicsChanged(recipient, fee);
    }

    function transferOwnership(address next) public override onlyOwner {
        if (!_role(next)) revert Invalid();
        super.transferOwnership(next);
    }

    function renounceOwnership() public override onlyOwner {
        revert Invalid();
    }

    function _role(address a) private view returns (bool) {
        return a != address(0) && a != address(this) && a != weth && a != address(executor) && a != address(policy)
            && a != address(0xdead);
    }

    function _recipient(address a) private view returns (bool) {
        return _role(a);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (paused) revert Paused();
            if (_reentrancyGuardEntered() || to == address(this) || to == address(0xdead)) revert Invalid();
        }
        super._update(from, to, value);
    }
}
