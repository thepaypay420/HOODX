// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IControlledVaultV2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function transferOwnership(address next) external;
    function constituents() external view returns (address[] memory);
    function weth() external view returns (address);
    function freeBalance(address token) external view returns (uint256);
    function setTargets(uint16 cashBps, uint16[] calldata weights) external;
    function rebalance(address token, bool buy, uint256 amount, uint256 minOut, uint256 deadline) external;
    function setPaused(bool value) external;
    function addConstituent(bytes32 id) external;
    function removeConstituent(address token) external;
    function emergencyUnwind(address token, uint256 amount, uint256 minOut, uint256 deadline)
        external
        returns (uint256);
    function setImageURI(string calldata uri) external;
}

/// @notice Per-vault curator controller that executes a complete sell-first rebalance atomically.
/// @dev The controller never holds vault assets. The existing curator explicitly nominates this
///      contract through the vault's two-step ownership flow, then activates it.
contract HoodxRebalanceControllerV2 is ReentrancyGuard {
    struct Step {
        address token;
        bool buy;
        uint256 amount;
        uint256 minOut;
    }

    IControlledVaultV2 public immutable vault;
    address public curator;
    address public pendingCurator;

    uint256 public constant MAX_STEPS = 24;
    uint256 public constant MAX_DEADLINE_WINDOW = 15 minutes;

    error Unauthorized();
    error Invalid();
    error StalePlan();
    error UnsafeOrder();
    error CashFloor();

    event Activated(address indexed vault, address indexed curator);
    event AtomicRebalance(
        address indexed vault,
        address indexed curator,
        bytes32 indexed planHash,
        uint256 stepCount,
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
        vault = IControlledVaultV2(vault_);
        curator = curator_;
    }

    /// @notice Completes the second step after the curator nominates this controller as vault owner.
    function activate() external nonReentrant {
        if (msg.sender != curator || vault.owner() != curator || vault.pendingOwner() != address(this)) {
            revert Unauthorized();
        }
        vault.acceptOwnership();
        if (vault.owner() != address(this)) revert Invalid();
        emit Activated(address(vault), curator);
    }

    /// @notice Saves targets and executes every protected sale and purchase in one transaction.
    /// @dev Steps must contain each asset at most once and place every sale before the first purchase.
    function atomicRebalance(
        uint16 cashBps,
        uint16[] calldata weights,
        Step[] calldata steps,
        bytes32 expectedConstituentsHash,
        uint256 minCashAfter,
        uint256 deadline
    ) external onlyCurator nonReentrant {
        if (
            deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW || minCashAfter == 0
                || steps.length == 0 || steps.length > MAX_STEPS
        ) revert Invalid();

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
            vault.rebalance(step.token, step.buy, step.amount, step.minOut, deadline);
        }

        uint256 cashAfter = vault.freeBalance(vault.weth());
        if (cashAfter < minCashAfter) revert CashFloor();
        bytes32 planHash = keccak256(
            abi.encode(address(vault), cashBps, weights, steps, expectedConstituentsHash, minCashAfter, deadline)
        );
        emit AtomicRebalance(address(vault), curator, planHash, steps.length, cashAfter);
    }

    function setTargets(uint16 cashBps, uint16[] calldata weights) external onlyCurator nonReentrant {
        vault.setTargets(cashBps, weights);
    }

    function rebalance(address token, bool buy, uint256 amount, uint256 minOut, uint256 deadline)
        external
        onlyCurator
        nonReentrant
    {
        vault.rebalance(token, buy, amount, minOut, deadline);
    }

    function setPaused(bool value) external onlyCurator nonReentrant {
        vault.setPaused(value);
    }

    function addConstituent(bytes32 id) external onlyCurator nonReentrant {
        vault.addConstituent(id);
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

    /// @notice Starts the vault's standard two-step transfer away from this controller.
    function releaseVault(address nextOwner) external onlyCurator nonReentrant {
        if (!_validRole(nextOwner) || nextOwner == address(this) || nextOwner == address(vault)) revert Invalid();
        vault.transferOwnership(nextOwner);
        emit VaultReleaseStarted(nextOwner);
    }

    /// @notice Cancels a pending release while this controller still owns the vault.
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
}
