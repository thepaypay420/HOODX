// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {HoodxFeeModelV3} from "./HoodxFeeModelV3.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IV2Policy, IV2Executor, IV2Weth} from "../v2/Types.sol";

/// @notice Candidate proportional-accounting vault. Separate opt-in deployment; never upgrades existing vaults.
contract HoodxProportionalV3 is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    HoodxFeeModelV3 public immutable feeModel;

    function version() external pure returns (uint256) {
        return 3;
    }
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
    uint256 public planNonce;
    uint256 public constant MAX_DEADLINE = 300;
    uint256 public constant BPS = 10_000;
    address[] private tokens;
    mapping(address => bytes32) public configId;
    mapping(address => uint16) public targetBps;
    mapping(address => uint256) public reserved;
    mapping(address => mapping(address => uint256)) public claimable;
    // Transfer limits are pure configuration, unlike dynamic swap fees. Cache them so
    // bounded emergency claims do not load and decode both complete swap routes.
    mapping(address => uint256) public claimTransferFactor;

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
    error BuyQuote(uint256[] outputs);
    error WithdrawalQuote(uint256 cash, uint256[] outputs);
    error QuoteUnavailable();
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

    constructor(address policy_, address feeModel_) ERC20("", "") Ownable(address(1)) {
        if (feeModel_.code.length == 0) revert Invalid();
        feeModel = HoodxFeeModelV3(feeModel_);
        if (policy_.code.length == 0) revert Invalid();
        policy = IV2Policy(policy_);
        executor = IV2Executor(policy.executor());
        if (feeModel.executor() != address(executor)) revert Invalid();
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

    function accountingMode() external pure returns (bytes32) {
        return keccak256("HOODX_PROPORTIONAL_V1");
    }

    /// @notice eth_call only: ALWAYS reverts, including on success, rolling back every swap.
    /// External failures are masked so a token cannot forge a successful quote error.
    function quoteBuys(uint256[] calldata budgets) external payable nonReentrant {
        try this.probeBuys(budgets, msg.value) returns (uint256[] memory outputs) {
            revert BuyQuote(outputs);
        } catch {
            revert QuoteUnavailable();
        }
    }

    function probeBuys(uint256[] calldata budgets, uint256 funding) external returns (uint256[] memory outputs) {
        if (msg.sender != address(this)) revert OnlySelf();
        if (!initialized || paused || budgets.length != tokens.length || funding == 0) revert Invalid();
        uint256 total;
        for (uint256 i; i < budgets.length; ++i) {
            total += budgets[i];
        }
        if (total > funding) revert Invalid();
        IV2Weth(weth).deposit{value: funding}();
        outputs = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            if (budgets[i] == 0) continue;
            uint256 beforeBalance = freeBalance(tokens[i]);
            this.executeBuy(tokens[i], budgets[i], 1, block.timestamp);
            outputs[i] = freeBalance(tokens[i]) - beforeBalance;
        }
    }

    /// @notice eth_call only. Quote the holder's actual sales, including route and transfer fees.
    function quoteWithdrawal(uint256 shares) external nonReentrant {
        try this.probeWithdrawal(msg.sender, shares) returns (uint256 cash, uint256[] memory outputs) {
            revert WithdrawalQuote(cash, outputs);
        } catch {
            revert QuoteUnavailable();
        }
    }

    function probeWithdrawal(address holder, uint256 shares) external returns (uint256 cash, uint256[] memory outputs) {
        if (msg.sender != address(this)) revert OnlySelf();
        if (shares == 0 || shares > balanceOf(holder)) revert Invalid();
        _wrapNative(0);
        uint256 supply = totalSupply();
        cash = Math.mulDiv(freeBalance(weth), shares, supply);
        outputs = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            uint256 amount = Math.mulDiv(freeBalance(tokens[i]), shares, supply);
            if (amount != 0) outputs[i] = _sell(tokens[i], amount, 1, block.timestamp);
        }
    }

    function requiredContributions(uint256 shares) external view returns (uint256 cash, uint256[] memory amounts) {
        uint256 supply = totalSupply();
        if (supply == 0 || shares < MIN_SHARES) revert Invalid();
        cash = Math.mulDiv(freeBalance(weth) + freeBalance(address(0)), shares, supply, Math.Rounding.Ceil);
        amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            amounts[i] = Math.mulDiv(freeBalance(tokens[i]), shares, supply, Math.Rounding.Ceil);
        }
    }

    function _checkPlan(uint256 nonce, uint256 deadline) private view {
        if (nonce != planNonce || deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE) {
            revert Invalid();
        }
    }

    function _credit(address user, address token, uint256 amount) private {
        reserved[token] += amount;
        claimable[user][token] += amount;
    }

    function _wrapNative(uint256 exclude) private {
        uint256 amount = freeBalance(address(0)) - exclude;
        if (amount != 0) IV2Weth(weth).deposit{value: amount}();
    }

    function _fees(uint256 gross, uint256 net) private {
        uint256 total = protocolFeeBps + creatorFeeBps;
        uint256 fee = gross - net;
        uint256 proto = total == 0 ? 0 : Math.mulDiv(fee, protocolFeeBps, total);
        _credit(treasury, weth, proto);
        _credit(creatorRecipient, weth, fee - proto);
    }

    function _refund(uint256 amount) private {
        if (amount == 0) return;
        IV2Weth(weth).withdraw(amount);
        _credit(msg.sender, address(0), amount);
        _attempt(msg.sender, address(0), msg.sender);
    }

    /// @notice Only creator/curator may start an empty basket. The signed floors protect its first investor.
    function bootstrap(uint256[] calldata floors, uint256 nonce, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 shares)
    {
        _checkPlan(nonce, deadline);
        if (
            paused || !initialized || totalSupply() != 0 || (msg.sender != owner() && msg.sender != creator)
                || msg.value < minFirstDeposit || floors.length != tokens.length
        ) revert Invalid();
        _credit(treasury, address(0), freeBalance(address(0)) - msg.value);
        _reserve(treasury, weth, 1, 1);
        for (uint256 i; i < tokens.length; ++i) {
            _reserve(treasury, tokens[i], 1, 1);
        }
        uint256 net = Math.mulDiv(msg.value, BPS - protocolFeeBps - creatorFeeBps, BPS);
        IV2Weth(weth).deposit{value: msg.value}();
        _fees(msg.value, net);
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 budget = Math.mulDiv(net, targetBps[t], BPS);
            if (targetBps[t] == 0) {
                if (floors[i] != 0) revert Invalid();
                continue;
            }
            if (budget < MIN_SLEEVE || floors[i] == 0) revert Invalid();
            this.executeBuy(t, budget, floors[i], deadline);
        }
        // Genesis denomination only, not a representation of oracle-valued NAV.
        shares = net * 25;
        if (shares < MIN_SHARES) revert Invalid();
        _mint(msg.sender, shares);
        emit Deposit(msg.sender, msg.value, shares, msg.value - net);
    }

    /// @notice Mint exactly the signed shares; retain only proportional contributions and reserve all excess for the depositor.
    function depositExactShares(
        uint256 shares,
        uint256[] calldata budgets,
        uint256[] calldata floors,
        uint256 nonce,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 refund) {
        _checkPlan(nonce, deadline);
        uint256 supply = totalSupply();
        if (
            paused || supply == 0 || shares < MIN_SHARES || msg.value < MIN_DEPOSIT || budgets.length != tokens.length
                || floors.length != tokens.length
        ) revert Invalid();
        _wrapNative(msg.value);
        uint256 cashBefore = freeBalance(weth);
        uint256 cashNeeded = Math.mulDiv(cashBefore, shares, supply, Math.Rounding.Ceil);
        uint256[] memory beforeBalances = new uint256[](tokens.length);
        uint256[] memory needed = new uint256[](tokens.length);
        uint256 spent = cashNeeded;
        for (uint256 i; i < tokens.length; ++i) {
            beforeBalances[i] = freeBalance(tokens[i]);
            needed[i] = Math.mulDiv(beforeBalances[i], shares, supply, Math.Rounding.Ceil);
            if (needed[i] == 0) {
                if (budgets[i] != 0 || floors[i] != 0) revert Invalid();
            } else if (budgets[i] == 0 || floors[i] == 0) {
                revert Invalid();
            }
            spent += budgets[i];
        }
        uint256 gross = Math.mulDiv(spent, BPS, BPS - protocolFeeBps - creatorFeeBps, Math.Rounding.Ceil);
        if (spent == 0 || gross > msg.value) revert Invalid();
        IV2Weth(weth).deposit{value: msg.value}();
        for (uint256 i; i < tokens.length; ++i) {
            if (needed[i] != 0) this.executeBuy(tokens[i], budgets[i], Math.max(needed[i], floors[i]), deadline);
        }
        for (uint256 i; i < tokens.length; ++i) {
            uint256 requiredBalance = beforeBalances[i] + needed[i];
            uint256 actual = freeBalance(tokens[i]);
            if (actual < requiredBalance) revert Slippage();
            _credit(msg.sender, tokens[i], actual - requiredBalance);
        }
        _fees(gross, spent);
        refund = msg.value - gross;
        if (freeBalance(weth) != cashBefore + cashNeeded + refund) revert Slippage();
        _mint(msg.sender, shares);
        _refund(refund);
        for (uint256 i; i < tokens.length; ++i) {
            _attempt(msg.sender, tokens[i], msg.sender);
        }
        emit Deposit(msg.sender, gross, shares, gross - spent);
    }

    function _claimMinimum(address token, uint256 amount) private view returns (uint256) {
        if (token == weth) return amount;
        uint256 factor = claimTransferFactor[token];
        if (factor == 0) revert Invalid();
        return Math.mulDiv(amount, factor, 1e18, Math.Rounding.Ceil);
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
        if (amount == 0 || amount > freeBalance(input) || floor == 0 || deadline < block.timestamp) revert Invalid();
        feeModel.factor(route);
        uint256 beforeIn = IERC20(input).balanceOf(address(this));
        uint256 beforeOut = IERC20(output).balanceOf(address(this));
        IERC20(input).forceApprove(address(executor), amount);
        executor.execute(input, output, amount, floor, route, deadline);
        IERC20(input).forceApprove(address(executor), 0);
        got = IERC20(output).balanceOf(address(this)) - beforeOut;
        if (beforeIn - IERC20(input).balanceOf(address(this)) != amount || got < floor) revert Slippage();
    }

    function _sell(address token, uint256 amount, uint256 minOut, uint256 deadline) internal returns (uint256) {
        (,,, bytes memory sell) = policy.config(configId[token]);
        return _trade(token, weth, amount, minOut, sell, deadline);
    }

    function withdraw(uint256 shares, uint256 minEthOut, uint256[] calldata floors, uint256 nonce, uint256 deadline)
        external
        nonReentrant
        returns (uint256 net)
    {
        _checkPlan(nonce, deadline);
        if (shares == 0 || shares > balanceOf(msg.sender) || minEthOut == 0 || floors.length != tokens.length) {
            revert Invalid();
        }
        _wrapNative(0);
        uint256 supply = totalSupply();
        uint256 cash = Math.mulDiv(freeBalance(weth), shares, supply);
        uint256 proceeds;
        uint256[] memory retained = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            retained[i] = freeBalance(tokens[i]) - Math.mulDiv(freeBalance(tokens[i]), shares, supply);
        }
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 amount = Math.mulDiv(freeBalance(t), shares, supply);
            if (amount != 0) proceeds += _sell(t, amount, floors[i], deadline);
        }
        for (uint256 i; i < tokens.length; ++i) {
            if (freeBalance(tokens[i]) != retained[i]) revert Slippage();
        }
        net = cash + proceeds;
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
                    || IERC20(token).balanceOf(recipient) - beforeRecipient < _claimMinimum(token, amount)
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
        if (deadline > block.timestamp + MAX_DEADLINE) revert Invalid();
        got = _sell(token, amount, minOut, deadline);
        ++planNonce;
        emit EmergencyUnwind(token, amount, got);
    }

    /// @notice Curator-authorized execution, not automatic oracle-based rebalancing.
    /// The curator signs explicit output and cash floors; this is a disclosed trust boundary.
    function rebalance(
        address token,
        bool buy,
        uint256 amount,
        uint256 minOut,
        uint256 minCashAfter,
        uint256 nonce,
        uint256 deadline
    ) external onlyOwner nonReentrant {
        _checkPlan(nonce, deadline);
        if (configId[token] == 0 || minOut == 0 || (buy && paused)) revert Invalid();
        _wrapNative(0);
        if (buy) this.executeBuy(token, amount, minOut, deadline);
        else _sell(token, amount, minOut, deadline);
        if (freeBalance(weth) < minCashAfter) revert Invalid();
        ++planNonce;
    }

    function setPaused(bool value) external onlyOwner nonReentrant {
        ++planNonce;
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
        ++planNonce;
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
        if (oracle != address(0)) revert Invalid();
        ++planNonce;
        configId[t] = id;
        claimTransferFactor[t] = feeModel.transferFactor(buy);
        feeModel.factor(buy);
        feeModel.factor(sell);
        tokens.push(t);
        emit ConstituentChanged(t, id);
    }

    function replaceConfig(bytes32 id) external onlyOwner nonReentrant {
        (address t, address oracle, bytes memory buy, bytes memory sell) = policy.config(id);
        if (configId[t] == 0 || oracle != address(0)) revert Invalid();
        executor.validateRoute(buy, weth, t);
        executor.validateRoute(sell, t, weth);
        ++planNonce;
        configId[t] = id;
        claimTransferFactor[t] = feeModel.transferFactor(buy);
        feeModel.factor(buy);
        feeModel.factor(sell);
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
        ++planNonce;
        delete configId[t];
        delete claimTransferFactor[t];
        emit ConstituentChanged(t, 0);
    }

    function setCreatorEconomics(address recipient, uint16 fee) external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (!_role(recipient) || fee > 50) revert Invalid();
        ++planNonce;
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
