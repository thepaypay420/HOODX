// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IV2Executor, IV2Oracle, IV2Policy, IV2Weth} from "../v2/Types.sol";

/// @notice Short-horizon closed Launch Hunter pilot with larger, evidence-gated pullback positions.
/// @dev There is deliberately no public deposit path. New routes are admitted through the existing
///      append-only policy registry, then must remain armed for 24 hours before any capital can move.
contract HoodxLaunchHunterV3 is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Candidate {
        bytes32 configId;
        bytes32 cluster;
        bytes32 evidence;
        bytes32 runtimeHash;
        uint64 armedAt;
        uint64 enteredAt;
        uint8 decimals;
        bool active;
        bool principalRecovered;
        uint256 entryWeth;
        uint256 highWaterWeth;
    }

    IV2Policy public immutable policy;
    IV2Executor public immutable executor;
    address public immutable weth;
    address public immutable curator;
    uint256 public immutable wethSeedAmount;
    uint256 public immutable riskReferenceAmount;
    uint256 public immutable initialShares;
    address[] private _baseSleeves;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ACTIVE = 2;
    uint256 public constant MAX_BASE_SLEEVES = 4;
    uint256 public constant MIN_PROBE_BPS = 1000; // fixed 10%: $20 on the $200 pilot
    uint256 public constant MAX_PROBE_BPS = 1000; // fixed 10%: $20 on the $200 pilot
    uint256 public constant MAX_TOTAL_RISK_BPS = 2000; // two 10% positions; 80% remains outside launch risk
    uint256 public constant MAX_ENTRIES_PER_DAY = 2;
    uint256 public constant MIN_ENTRY_SPACING = 30 minutes;
    uint256 public constant EXECUTION_FLOOR_BPS = 9700;
    uint256 public constant OBSERVATION_DELAY = 12 hours;
    uint256 public constant MAX_ENTRY_AGE = 48 hours;
    uint256 public constant MAX_HOLD = 4 hours;
    uint256 public constant PROFIT_TRIGGER_BPS = 15_000; // close at +50% oracle value
    uint256 public constant STOP_BPS = 8000; // close at -20% oracle value; actual route floor still applies
    string public constant IMAGE_URI = "https://xhoodindex.com/vaults/launch-hunter.png";

    bool public bootstrapped;
    bool public managementPaused;
    uint64 public entryWindowStartedAt;
    uint64 public lastEntryAt;
    uint8 public entriesInWindow;
    address[] private _activeTokens;
    mapping(address => Candidate) public candidate;
    mapping(bytes32 => address) public activeCluster;
    mapping(address => uint256) public reserved;
    mapping(address => mapping(address => uint256)) public claimable;

    error Unauthorized();
    error Invalid();
    error NotReady();
    error Limit();
    error Slippage();
    error OnlySelf();

    event Bootstrapped(address indexed receiver, uint256 wethAmount, uint256 shares);
    event CandidateArmed(address indexed token, bytes32 indexed cluster, bytes32 indexed evidence, uint64 eligibleAt);
    event CandidateCancelled(address indexed token);
    event ProbeEntered(address indexed token, bytes32 indexed cluster, uint256 wethSpent, uint256 tokensReceived);
    event PrincipalRecovered(address indexed token, uint256 wethRecovered, uint256 tokensRemaining);
    event HighWaterObserved(address indexed token, uint256 valueWeth);
    event ProbeExited(address indexed token, uint256 tokensSold, uint256 wethReceived, bytes32 reason);
    event ManagementPaused(bool paused);
    event InKindReserved(address indexed holder, address indexed receiver, uint256 shares);
    event AssetClaimed(address indexed holder, address indexed token, address indexed receiver, uint256 amount);
    event ClaimDeferred(address indexed holder, address indexed token, uint256 amount);

    modifier onlyCurator() {
        if (msg.sender != curator) revert Unauthorized();
        _;
    }

    constructor(
        address policy_,
        address curator_,
        uint256 wethSeedAmount_,
        uint256 riskReferenceAmount_,
        uint256 initialShares_,
        address[] memory baseSleeves_
    )
        ERC20("HOODX Launch Hunter", "HUNTX")
    {
        if (
            policy_.code.length == 0 || curator_ == address(0) || wethSeedAmount_ == 0
                || riskReferenceAmount_ == 0 || initialShares_ == 0 || baseSleeves_.length == 0
                || baseSleeves_.length > MAX_BASE_SLEEVES
                || wethSeedAmount_ != Math.mulDiv(riskReferenceAmount_, MAX_TOTAL_RISK_BPS, BPS)
        ) {
            revert Invalid();
        }
        policy = IV2Policy(policy_);
        executor = IV2Executor(IV2Policy(policy_).executor());
        if (address(executor).code.length == 0) revert Invalid();
        weth = executor.weth();
        if (weth.code.length == 0) revert Invalid();
        curator = curator_;
        wethSeedAmount = wethSeedAmount_;
        riskReferenceAmount = riskReferenceAmount_;
        initialShares = initialShares_;
        for (uint256 i; i < baseSleeves_.length; ++i) {
            address sleeve = baseSleeves_[i];
            if (sleeve == weth || sleeve.code.length == 0) revert Invalid();
            for (uint256 j; j < i; ++j) {
                if (baseSleeves_[j] == sleeve) revert Invalid();
            }
            _baseSleeves.push(sleeve);
        }
    }

    receive() external payable {
        if (msg.sender != weth) revert Invalid();
    }

    function bootstrap(address receiver) external payable onlyCurator nonReentrant {
        if (bootstrapped || receiver == address(0) || msg.value != wethSeedAmount) revert Invalid();
        for (uint256 i; i < _baseSleeves.length; ++i) {
            if (IERC20(_baseSleeves[i]).balanceOf(address(this)) == 0) revert Invalid();
        }
        bootstrapped = true;
        IV2Weth(weth).deposit{value: msg.value}();
        _mint(receiver, initialShares);
        emit Bootstrapped(receiver, msg.value, initialShares);
    }

    function activeTokens() external view returns (address[] memory) {
        return _activeTokens;
    }

    function baseSleeves() external view returns (address[] memory) {
        return _baseSleeves;
    }

    /// @notice Wallet-facing token artwork metadata.
    function contractURI() external pure returns (string memory) {
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    '{"name":"HOODX Launch Hunter","symbol":"HUNTX","image":"https://xhoodindex.com/vaults/launch-hunter.png"}'
                )
            )
        );
    }

    function freeBalance(address token) public view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 heldForClaims = reserved[token];
        return balance > heldForClaims ? balance - heldForClaims : 0;
    }

    /// @notice WETH-equivalent value of the tactical launch sleeve only.
    /// @dev Base LP sleeve shares are intentionally excluded because this closed pilot does not
    ///      trust a shared NAV oracle for them. They remain directly redeemable in kind.
    function launchAssets() public view returns (uint256 value) {
        value = freeBalance(weth);
        for (uint256 i; i < _activeTokens.length; ++i) {
            address token = _activeTokens[i];
            value += _value(token, freeBalance(token));
        }
    }

    function riskyAssets() public view returns (uint256 value) {
        for (uint256 i; i < _activeTokens.length; ++i) {
            address token = _activeTokens[i];
            value += _value(token, freeBalance(token));
        }
    }

    /// @notice Records a reviewed candidate. Arming never moves funds and may be cancelled freely.
    function arm(bytes32 configId, bytes32 cluster, bytes32 evidence) external onlyCurator nonReentrant {
        if (!bootstrapped || managementPaused || cluster == 0 || evidence == 0) revert Invalid();
        (address token, address oracle, bytes memory buy, bytes memory sell) = policy.config(configId);
        if (token == address(0) || token == weth || token.code.length == 0 || oracle.code.length == 0) {
            revert Invalid();
        }
        Candidate storage old = candidate[token];
        if (old.active || freeBalance(token) != 0 || reserved[token] != 0) revert Invalid();
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals > 18 || IV2Oracle(oracle).value(token, 10 ** decimals) == 0) revert Invalid();
        executor.validateRoute(buy, weth, token);
        executor.validateRoute(sell, token, weth);
        candidate[token] = Candidate({
            configId: configId,
            cluster: cluster,
            evidence: evidence,
            runtimeHash: token.codehash,
            armedAt: uint64(block.timestamp),
            enteredAt: 0,
            decimals: decimals,
            active: false,
            principalRecovered: false,
            entryWeth: 0,
            highWaterWeth: 0
        });
        emit CandidateArmed(token, cluster, evidence, uint64(block.timestamp + OBSERVATION_DELAY));
    }

    function cancel(address token) external onlyCurator {
        Candidate storage c = candidate[token];
        if (c.active || reserved[token] != 0) revert Invalid();
        delete candidate[token];
        emit CandidateCancelled(token);
    }

    /// @notice Opens one capped probe after its observation delay and fresh runtime/config checks.
    function enter(address token, uint256 wethAmount, uint256 minTokens, uint256 deadline)
        external
        onlyCurator
        nonReentrant
        returns (uint256 received)
    {
        Candidate storage c = candidate[token];
        if (
            !bootstrapped || managementPaused || c.configId == 0 || c.active
                || block.timestamp < uint256(c.armedAt) + OBSERVATION_DELAY || deadline < block.timestamp
                || block.timestamp > uint256(c.armedAt) + MAX_ENTRY_AGE
                || deadline > block.timestamp + 5 minutes || token.codehash != c.runtimeHash
        ) revert NotReady();
        if (_activeTokens.length >= MAX_ACTIVE || activeCluster[c.cluster] != address(0)) revert Limit();
        if (lastEntryAt != 0 && block.timestamp < uint256(lastEntryAt) + MIN_ENTRY_SPACING) revert Limit();
        if (entryWindowStartedAt == 0 || block.timestamp >= uint256(entryWindowStartedAt) + 1 days) {
            entryWindowStartedAt = uint64(block.timestamp);
            entriesInWindow = 0;
        }
        if (entriesInWindow >= MAX_ENTRIES_PER_DAY) revert Limit();
        // The production seed is immutable, so donations and mark-to-market gains can never expand
        // the protocol's absolute launch-risk budget.
        if (
            freeBalance(token) != 0 || wethAmount < Math.mulDiv(riskReferenceAmount, MIN_PROBE_BPS, BPS)
                || wethAmount > Math.mulDiv(riskReferenceAmount, MAX_PROBE_BPS, BPS)
        ) {
            revert Limit();
        }
        received = _trade(token, true, wethAmount, minTokens, deadline);
        c.active = true;
        c.enteredAt = uint64(block.timestamp);
        c.entryWeth = wethAmount;
        c.highWaterWeth = _value(token, received);
        lastEntryAt = uint64(block.timestamp);
        entriesInWindow += 1;
        activeCluster[c.cluster] = token;
        _activeTokens.push(token);
        if (
            _value(token, freeBalance(token)) > Math.mulDiv(riskReferenceAmount, MAX_PROBE_BPS, BPS)
                || riskyAssets() > Math.mulDiv(riskReferenceAmount, MAX_TOTAL_RISK_BPS, BPS)
        ) revert Limit();
        emit ProbeEntered(token, c.cluster, wethAmount, received);
    }

    /// @notice Anyone can enforce the four-hour timeout, +50% take-profit or -20% stop.
    /// @dev The caller cannot weaken execution protection: `_trade` derives an independent
    ///      97% oracle floor and takes the greater of that floor and the caller's minimum.
    function enforceExit(address token, uint256 minWeth, uint256 deadline)
        external
        nonReentrant
        returns (uint256 received)
    {
        Candidate storage c = candidate[token];
        if (!c.active) revert Invalid();
        uint256 value = _value(token, freeBalance(token));
        bool expired = block.timestamp >= uint256(c.enteredAt) + MAX_HOLD;
        bool profit = value >= Math.mulDiv(c.entryWeth, PROFIT_TRIGGER_BPS, BPS);
        bool stopped = value <= Math.mulDiv(c.entryWeth, STOP_BPS, BPS);
        if (!expired && !profit && !stopped) revert NotReady();
        uint256 amount = freeBalance(token);
        received = _trade(token, false, amount, minWeth, deadline);
        bytes32 reason = expired ? keccak256("EXPIRY") : profit ? keccak256("PROFIT") : keccak256("STOP");
        _deactivate(token, amount, received, reason);
    }

    /// @notice Curator may exit immediately on any security, liquidity or market-quality failure.
    function emergencyExit(address token, uint256 minWeth, uint256 deadline)
        external
        onlyCurator
        nonReentrant
        returns (uint256 received)
    {
        if (!candidate[token].active) revert Invalid();
        uint256 amount = freeBalance(token);
        received = _trade(token, false, amount, minWeth, deadline);
        _deactivate(token, amount, received, keccak256("EMERGENCY"));
    }

    function setManagementPaused(bool paused) external onlyCurator {
        managementPaused = paused;
        emit ManagementPaused(paused);
    }

    /// @notice Burns HUNTX and reserves each underlying independently before attempting transfers.
    function redeemInKind(uint256 shares, address receiver) external nonReentrant {
        uint256 supply = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender) || receiver == address(0)) revert Invalid();
        address[] memory tokens = _activeTokens;
        _reserve(msg.sender, weth, shares, supply);
        for (uint256 i; i < _baseSleeves.length; ++i) {
            _reserve(msg.sender, _baseSleeves[i], shares, supply);
        }
        for (uint256 i; i < tokens.length; ++i) {
            _reserve(msg.sender, tokens[i], shares, supply);
        }
        _burn(msg.sender, shares);
        if (totalSupply() == 0) {
            for (uint256 i; i < tokens.length; ++i) {
                Candidate storage c = candidate[tokens[i]];
                c.active = false;
                activeCluster[c.cluster] = address(0);
            }
            delete _activeTokens;
        }
        emit InKindReserved(msg.sender, receiver, shares);
        _attempt(msg.sender, weth, receiver);
        for (uint256 i; i < _baseSleeves.length; ++i) {
            _attempt(msg.sender, _baseSleeves[i], receiver);
        }
        for (uint256 i; i < tokens.length; ++i) {
            _attempt(msg.sender, tokens[i], receiver);
        }
    }

    function claim(address token, address receiver) external nonReentrant {
        if (receiver == address(0)) revert Invalid();
        this.payClaim(msg.sender, token, receiver);
    }

    function payClaim(address holder, address token, address receiver) external {
        if (msg.sender != address(this)) revert OnlySelf();
        uint256 amount = claimable[holder][token];
        if (amount == 0) revert Invalid();
        claimable[holder][token] = 0;
        reserved[token] -= amount;
        IERC20(token).safeTransfer(receiver, amount);
        emit AssetClaimed(holder, token, receiver, amount);
    }

    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external onlyCurator nonReentrant {
        if (receiver == address(0) || token == weth || candidate[token].configId != 0 || reserved[token] != 0) {
            revert Invalid();
        }
        for (uint256 i; i < _baseSleeves.length; ++i) {
            if (token == _baseSleeves[i]) revert Invalid();
        }
        IERC20(token).safeTransfer(receiver, amount);
    }

    function _trade(address token, bool buying, uint256 amount, uint256 userMin, uint256 deadline)
        private
        returns (uint256 received)
    {
        Candidate storage c = candidate[token];
        if (amount == 0 || deadline < block.timestamp || deadline > block.timestamp + 5 minutes) revert Invalid();
        (address configured, address oracle, bytes memory buy, bytes memory sell) = policy.config(c.configId);
        if (configured != token || token.codehash != c.runtimeHash) revert Invalid();
        address input = buying ? weth : token;
        address output = buying ? token : weth;
        uint256 fair = buying
            ? Math.mulDiv(amount, 10 ** c.decimals, IV2Oracle(oracle).value(token, 10 ** c.decimals))
            : IV2Oracle(oracle).value(token, amount);
        uint256 floor = Math.mulDiv(fair, EXECUTION_FLOOR_BPS, BPS);
        uint256 minimum = Math.max(userMin, floor);
        uint256 beforeOut = IERC20(output).balanceOf(address(this));
        IERC20(input).forceApprove(address(executor), amount);
        executor.execute(input, output, amount, minimum, buying ? buy : sell, deadline);
        IERC20(input).forceApprove(address(executor), 0);
        received = IERC20(output).balanceOf(address(this)) - beforeOut;
        if (received < minimum) revert Slippage();
    }

    function _value(address token, uint256 amount) private view returns (uint256) {
        if (amount == 0) return 0;
        (, address oracle,,) = policy.config(candidate[token].configId);
        uint256 value = IV2Oracle(oracle).value(token, amount);
        if (value == 0) revert Invalid();
        return value;
    }

    function _deactivate(address token, uint256 sold, uint256 received, bytes32 reason) private {
        Candidate storage c = candidate[token];
        bytes32 cluster = c.cluster;
        c.active = false;
        activeCluster[cluster] = address(0);
        for (uint256 i; i < _activeTokens.length; ++i) {
            if (_activeTokens[i] == token) {
                _activeTokens[i] = _activeTokens[_activeTokens.length - 1];
                _activeTokens.pop();
                break;
            }
        }
        emit ProbeExited(token, sold, received, reason);
    }

    function _reserve(address holder, address token, uint256 shares, uint256 supply) private {
        uint256 amount = Math.mulDiv(freeBalance(token), shares, supply);
        reserved[token] += amount;
        claimable[holder][token] += amount;
    }

    function _attempt(address holder, address token, address receiver) private {
        uint256 amount = claimable[holder][token];
        if (amount == 0) return;
        try this.payClaim{gas: 150_000}(holder, token, receiver) {}
        catch {
            emit ClaimDeferred(holder, token, amount);
        }
    }
}
