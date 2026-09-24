// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Delayed, code-pinned hook admission for opt-in successor vaults only.
/// Proxy/dependency upgrades require separate review: runtime hashes alone cannot detect them.
contract HoodxHookRegistryV3 is Ownable2Step {
    uint256 public constant DELAY = 2 days;

    struct Proposal {
        bytes32 codeHash;
        bytes32 evidence;
        uint256 readyAt;
    }
    mapping(address => Proposal) public proposals;
    mapping(address => bytes32) public approvedCodeHash;
    event Proposed(address indexed hook, bytes32 codeHash, bytes32 evidence, uint256 readyAt);
    event Activated(address indexed hook, bytes32 codeHash, bytes32 evidence);
    event Revoked(address indexed hook);
    error InvalidHook();
    constructor(address admin) Ownable(admin) {}

    function propose(address hook, bytes32 evidence) external onlyOwner {
        if (hook.code.length == 0 || evidence == 0) revert InvalidHook();
        proposals[hook] = Proposal(hook.codehash, evidence, block.timestamp + DELAY);
        emit Proposed(hook, hook.codehash, evidence, block.timestamp + DELAY);
    }

    function activate(address hook) external {
        Proposal memory p = proposals[hook];
        if (p.readyAt == 0 || block.timestamp < p.readyAt || hook.code.length == 0 || hook.codehash != p.codeHash) {
            revert InvalidHook();
        }
        delete proposals[hook];
        approvedCodeHash[hook] = p.codeHash;
        emit Activated(hook, p.codeHash, p.evidence);
    }

    function revoke(address hook) external onlyOwner {
        delete proposals[hook];
        delete approvedCodeHash[hook];
        emit Revoked(hook);
    }

    function isApprovedHook(address hook) external view returns (bool) {
        return hook.code.length > 0 && approvedCodeHash[hook] != 0 && approvedCodeHash[hook] == hook.codehash;
    }
}
