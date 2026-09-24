// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {HoodxRebalanceControllerV2} from "./HoodxRebalanceControllerV2.sol";
import {IV2Oracle, IV2Policy} from "./Types.sol";

interface ISelfHealingVaultV2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function policy() external view returns (address);
    function configId(address token) external view returns (bytes32);
    function replaceConfig(bytes32 id) external;
}

/// @notice Preserves curator controls while allowing anyone to repair a failed price reference
/// using another append-only configuration already admitted by the vault's policy.
/// The current configuration must be objectively unhealthy and the replacement healthy.
contract HoodxSelfHealingControllerV2 is HoodxRebalanceControllerV2 {
    mapping(bytes32 => bool) public recoveryApproved;
    event ConfigurationHealed(address indexed token, bytes32 indexed oldId, bytes32 indexed newId, address caller);
    event RecoveryApprovalChanged(bytes32 indexed id, address indexed token, bool approved);

    constructor(address vault_, address curator_) HoodxRebalanceControllerV2(vault_, curator_) {}

    /// @notice Accepts a two-step handoff from an existing controller without moving vault assets.
    function activateHandoff() external nonReentrant {
        bytes32[] memory empty;
        _activateHandoff(empty);
    }

    /// @notice Completes the handoff and admits a reviewed recovery set in the same curator signature.
    function activateHandoffWithRecovery(bytes32[] calldata ids) external nonReentrant {
        _activateHandoff(ids);
    }

    function _activateHandoff(bytes32[] memory ids) private {
        ISelfHealingVaultV2 target = ISelfHealingVaultV2(address(vault));
        if (msg.sender != curator || target.pendingOwner() != address(this)) revert Unauthorized();
        target.acceptOwnership();
        if (target.owner() != address(this)) revert Invalid();
        for (uint256 i; i < ids.length; ++i) _setRecoveryConfig(ids[i], true);
        emit Activated(address(vault), curator);
    }

    /// @notice The curator may explicitly authorize or revoke a policy-admitted recovery configuration.
    function setRecoveryConfig(bytes32 id, bool approved) external onlyCurator {
        _setRecoveryConfig(id, approved);
    }

    function setRecoveryConfigs(bytes32[] calldata ids, bool approved) external onlyCurator {
        for (uint256 i; i < ids.length; ++i) _setRecoveryConfig(ids[i], approved);
    }

    function _setRecoveryConfig(bytes32 id, bool approved) private {
        (address token, address oracle,,) = IV2Policy(ISelfHealingVaultV2(address(vault)).policy()).config(id);
        if (token == address(0) || oracle == address(0)) revert Invalid();
        recoveryApproved[id] = approved;
        emit RecoveryApprovalChanged(id, token, approved);
    }

    /// @notice Permissionless recovery constrained to a curator-approved, revocable configuration.
    function healConfig(bytes32 candidateId) external nonReentrant {
        ISelfHealingVaultV2 target = ISelfHealingVaultV2(address(vault));
        if (target.owner() != address(this)) revert Unauthorized();
        IV2Policy approvedPolicy = IV2Policy(target.policy());
        (address token, address candidateOracle,,) = approvedPolicy.config(candidateId);
        if (!recoveryApproved[candidateId]) revert Unauthorized();
        bytes32 currentId = target.configId(token);
        if (currentId == bytes32(0) || currentId == candidateId) revert Invalid();
        (, address currentOracle,,) = approvedPolicy.config(currentId);
        uint256 unit = 10 ** IERC20Metadata(token).decimals();
        if (_healthy(currentOracle, token, unit) || !_healthy(candidateOracle, token, unit)) revert Invalid();
        target.replaceConfig(candidateId);
        emit ConfigurationHealed(token, currentId, candidateId, msg.sender);
    }

    function _healthy(address oracle, address token, uint256 unit) private view returns (bool) {
        (bool ok, bytes memory data) = oracle.staticcall(abi.encodeCall(IV2Oracle.value, (token, unit)));
        return ok && data.length == 32 && abi.decode(data, (uint256)) != 0;
    }
}
