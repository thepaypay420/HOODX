// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {HoodxProportionalPolicyV3} from "./HoodxProportionalPolicyV3.sol";

/// @notice Owner-controlled batch administration for a V3 route policy.
/// @dev Holds no assets, cannot trade, and cannot change vault ownership.
contract HoodxRouteAdminV3 is Ownable2Step {
    HoodxProportionalPolicyV3 public immutable policy;
    uint256 public constant MAX_BATCH = 20;
    error Invalid();

    constructor(address admin, address policy_) Ownable(admin) {
        if (policy_.code.length == 0) revert Invalid();
        policy = HoodxProportionalPolicyV3(policy_);
    }

    function acceptPolicyOwnership() external onlyOwner { policy.acceptOwnership(); }

    function approveRoutes(
        address[] calldata tokens,
        bytes[] calldata buys,
        bytes[] calldata sells,
        bytes32 evidence
    ) external onlyOwner returns (bytes32[] memory ids) {
        uint256 length = tokens.length;
        if (length == 0 || length > MAX_BATCH || buys.length != length || sells.length != length || evidence == 0) revert Invalid();
        ids = new bytes32[](length);
        for (uint256 i; i < length; ++i) ids[i] = policy.approveRoute(tokens[i], buys[i], sells[i], evidence);
    }

    function setActiveRoutes(address token, bytes32[] calldata ids) external onlyOwner { policy.setActiveRoutes(token, ids); }
    function nominatePolicyOwner(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert Invalid();
        policy.transferOwnership(nextOwner);
    }
}
