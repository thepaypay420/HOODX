// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IV2Weth} from "../v2/Types.sol";

interface IControlledVaultV3 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function transferOwnership(address next) external;
    function constituents() external view returns (address[] memory);
    function weth() external view returns (address);
    function freeBalance(address token) external view returns (uint256);
    function planNonce() external view returns (uint256);
    function setTargets(uint16 cashBps, uint16[] calldata weights) external;
    function rebalance(
        address token,
        bool buy,
        uint256 amount,
        uint256 minOut,
        uint256 minCashAfter,
        uint256 nonce,
        uint256 deadline
    ) external;
    function setPaused(bool value) external;
    function addConstituent(bytes32 id) external;
    function replaceConfig(bytes32 id) external;
    function removeConstituent(address token) external;
    function emergencyUnwind(address token, uint256 amount, uint256 minOut, uint256 deadline) external returns (uint256);
    function setImageURI(string calldata uri) external;
}

/// @notice Per-vault controller for one-signature, sell-first proportional-vault rebalances.
/// @dev The vault remains the sole custodian. Its plan nonce, route checks, output floors and cash
///      floors are enforced on every step, and any failure reverts the complete transaction.
contract HoodxRebalanceControllerV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Step {
        address token;
        bool buy;
        uint256 amount;
        uint256 minOut;
    }

    IControlledVaultV3 public immutable vault;
    address public curator;
    address public pendingCurator;

    uint256 public constant MAX_STEPS = 24;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    uint256 public constant MIN_QUOTE_BPS = 9700;

    error Unauthorized();
    error Invalid();
    error StalePlan();
    error UnsafeOrder();
    error CashFloor();
    error RebalanceQuote(uint256 output);
    error QuoteUnavailable();
    error ExecutionFloor(uint256 provided, uint256 required);

    event Activated(address indexed vault, address indexed curator);
    event AtomicRebalance(
        address indexed vault,
        address indexed curator,
        bytes32 indexed planHash,
        uint256 stepCount,
        uint256 finalPlanNonce,
        uint256 cashAfter
    );
    event CuratorTransferStarted(address indexed currentCurator, address indexed nextCurator);
    event CuratorTransferred(address indexed previousCurator, address indexed nextCurator);
    event VaultReleaseStarted(address indexed nextOwner);
    event VaultReleaseCancelled();

    modifier onlyCurator() {
        if (msg.sender != curator || vault.owner() != address(this)) revert Unauthorized();
        _;
    }

    constructor(address vault_, address curator_) {
        if (vault_ == address(0) || vault_.code.length == 0 || !_validRole(curator_) || curator_ == vault_) {
            revert Invalid();
        }
        vault = IControlledVaultV3(vault_);
        curator = curator_;
    }

    function activate() external nonReentrant {
        if (msg.sender != curator || vault.owner() != curator || vault.pendingOwner() != address(this)) {
            revert Unauthorized();
        }
        vault.acceptOwnership();
        if (vault.owner() != address(this)) revert Invalid();
        emit Activated(address(vault), curator);
    }

    function atomicRebalance(
        uint16 cashBps,
        uint16[] calldata weights,
        Step[] calldata steps,
        bytes32 expectedConstituentsHash,
        uint256 expectedPlanNonce,
        uint256 minCashAfter,
        uint256 deadline
    ) external onlyCurator nonReentrant {
        if (
            deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW || minCashAfter == 0
                || steps.length == 0 || steps.length > MAX_STEPS || vault.planNonce() != expectedPlanNonce
        ) revert StalePlan();

        address[] memory tokens = vault.constituents();
        if (weights.length != tokens.length || keccak256(abi.encode(tokens)) != expectedConstituentsHash) {
            revert StalePlan();
        }

        bool purchasesStarted;
        for (uint256 i; i < steps.length; ++i) {
            Step calldata step = steps[i];
            if (step.token == address(0) || step.amount == 0 || step.minOut == 0) revert Invalid();
            if (step.buy) purchasesStarted = true;
            else if (purchasesStarted) revert UnsafeOrder();

            bool found;
            for (uint256 j; j < tokens.length; ++j) {
                if (tokens[j] == step.token) found = true;
            }
            if (!found) revert StalePlan();
            for (uint256 j; j < i; ++j) {
                if (steps[j].token == step.token) revert Invalid();
            }
        }

        vault.setTargets(cashBps, weights);
        for (uint256 i; i < steps.length; ++i) {
            Step calldata step = steps[i];
            _enforceExecutionFloor(step.token, step.buy, step.amount, step.minOut);
            vault.rebalance(
                step.token, step.buy, step.amount, step.minOut, step.buy ? minCashAfter : 0, vault.planNonce(), deadline
            );
        }

        uint256 cashAfter = vault.freeBalance(vault.weth());
        if (cashAfter < minCashAfter) revert CashFloor();
        uint256 finalNonce = vault.planNonce();
        bytes32 planHash = keccak256(
            abi.encode(
                address(vault),
                cashBps,
                weights,
                steps,
                expectedConstituentsHash,
                expectedPlanNonce,
                minCashAfter,
                deadline
            )
        );
        emit AtomicRebalance(address(vault), curator, planHash, steps.length, finalNonce, cashAfter);
    }

    /// @notice eth_call-only exact execution quote. The deliberate revert rolls back all funding,
    ///         transfers, swaps, approvals and nonce changes.
    function quoteRebalance(address token, bool buy, uint256 amount) external payable nonReentrant {
        try this.probeRebalance(token, buy, amount, msg.value) returns (uint256 output) {
            revert RebalanceQuote(output);
        } catch {
            revert QuoteUnavailable();
        }
    }

    function probeRebalance(address token, bool buy, uint256 amount, uint256 funding)
        external
        returns (uint256 output)
    {
        if (msg.sender != address(this) || vault.owner() != address(this) || amount == 0) {
            revert Invalid();
        }
        uint256 nonce = vault.planNonce();
        if (buy) {
            if (funding != amount) revert Invalid();
            address cash = vault.weth();
            IV2Weth(cash).deposit{value: funding}();
            IERC20(cash).safeTransfer(address(vault), funding);
            uint256 beforeBalance = vault.freeBalance(token);
            vault.rebalance(token, true, amount, 1, 0, nonce, block.timestamp);
            output = vault.freeBalance(token) - beforeBalance;
        } else {
            if (funding != 0 || amount > vault.freeBalance(token)) revert Invalid();
            uint256 beforeCash = vault.freeBalance(vault.weth());
            vault.rebalance(token, false, amount, 1, 0, nonce, block.timestamp);
            output = vault.freeBalance(vault.weth()) - beforeCash;
        }
        if (output == 0) revert Invalid();
    }

    /// @dev Quotes against the vault's current balances and deliberately reverts so every simulated
    ///      approval, transfer, swap and nonce change is rolled back before the real leg executes.
    function probeExistingRebalance(address token, bool buy, uint256 amount) external {
        if (msg.sender != address(this) || vault.owner() != address(this) || amount == 0) revert Invalid();

        uint256 output;
        uint256 nonce = vault.planNonce();
        if (buy) {
            if (amount > vault.freeBalance(vault.weth())) revert Invalid();
            uint256 beforeBalance = vault.freeBalance(token);
            vault.rebalance(token, true, amount, 1, 0, nonce, block.timestamp);
            output = vault.freeBalance(token) - beforeBalance;
        } else {
            if (amount > vault.freeBalance(token)) revert Invalid();
            uint256 beforeCash = vault.freeBalance(vault.weth());
            vault.rebalance(token, false, amount, 1, 0, nonce, block.timestamp);
            output = vault.freeBalance(vault.weth()) - beforeCash;
        }
        if (output == 0) revert Invalid();
        revert RebalanceQuote(output);
    }

    function setTargets(uint16 cashBps, uint16[] calldata weights) external onlyCurator nonReentrant {
        vault.setTargets(cashBps, weights);
    }

    function rebalance(
        address token,
        bool buy,
        uint256 amount,
        uint256 minOut,
        uint256 minCashAfter,
        uint256 nonce,
        uint256 deadline
    ) external onlyCurator nonReentrant {
        _enforceExecutionFloor(token, buy, amount, minOut);
        vault.rebalance(token, buy, amount, minOut, minCashAfter, nonce, deadline);
    }

    function setPaused(bool value) external onlyCurator nonReentrant {
        vault.setPaused(value);
    }

    function addConstituent(bytes32 id) external onlyCurator nonReentrant {
        vault.addConstituent(id);
    }

    function replaceConfig(bytes32 id) external onlyCurator nonReentrant {
        vault.replaceConfig(id);
    }

    function removeConstituent(address token) external onlyCurator nonReentrant {
        vault.removeConstituent(token);
    }

    function emergencyUnwind(address token, uint256 amount, uint256 minOut, uint256 deadline)
        external
        onlyCurator
        nonReentrant
        returns (uint256)
    {
        _enforceExecutionFloor(token, false, amount, minOut);
        return vault.emergencyUnwind(token, amount, minOut, deadline);
    }

    function setImageURI(string calldata uri) external onlyCurator nonReentrant {
        vault.setImageURI(uri);
    }

    function proposeCurator(address next) external onlyCurator {
        if (!_validRole(next) || next == address(this) || next == address(vault)) revert Invalid();
        pendingCurator = next;
        emit CuratorTransferStarted(curator, next);
    }

    function acceptCurator() external {
        if (msg.sender != pendingCurator) revert Unauthorized();
        address previous = curator;
        curator = msg.sender;
        pendingCurator = address(0);
        emit CuratorTransferred(previous, msg.sender);
    }

    function releaseVault(address nextOwner) external onlyCurator nonReentrant {
        if (!_validRole(nextOwner) || nextOwner == address(this) || nextOwner == address(vault)) revert Invalid();
        vault.transferOwnership(nextOwner);
        emit VaultReleaseStarted(nextOwner);
    }

    function cancelVaultRelease() external onlyCurator nonReentrant {
        vault.transferOwnership(address(this));
        vault.acceptOwnership();
        emit VaultReleaseCancelled();
    }

    function constituentsHash() external view returns (bytes32) {
        return keccak256(abi.encode(vault.constituents()));
    }

    function _validRole(address account) private pure returns (bool) {
        return account != address(0) && account != address(0xdead);
    }

    function _enforceExecutionFloor(address token, bool buy, uint256 amount, uint256 minOut) private {
        uint256 quote = _exactExistingQuote(token, buy, amount);
        uint256 required = Math.mulDiv(quote, MIN_QUOTE_BPS, 10_000, Math.Rounding.Ceil);
        if (minOut < required) revert ExecutionFloor(minOut, required);
    }

    function _exactExistingQuote(address token, bool buy, uint256 amount) private returns (uint256 output) {
        try this.probeExistingRebalance(token, buy, amount) {
            revert QuoteUnavailable();
        } catch (bytes memory reason) {
            if (reason.length != 36) revert QuoteUnavailable();
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(reason, 32))
                output := mload(add(reason, 36))
            }
            if (selector != RebalanceQuote.selector || output == 0) revert QuoteUnavailable();
        }
    }
}
