// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IV2Executor, IV2Policy} from "../v2/Types.sol";

/// @notice Execution attestations ONLY. Cannot be used as NAV oracle approvals.
/// Admission still requires token/proxy/fee/hook review; runtime hashes are not proxy implementation attestations.
contract HoodxProportionalPolicyV3 is Ownable2Step, IV2Policy {
    address public immutable executor;
    uint256 public constant MAX_ROUTES_PER_TOKEN = 4;

    struct Entry {
        address token;
        bytes32 runtimeHash;
        bytes buy;
        bytes sell;
    }
    mapping(bytes32 => Entry) private entries;
    mapping(address => bytes32[]) private tokenConfigs;
    error InvalidConfig();
    event RouteApproved(bytes32 indexed id, address indexed token, bytes32 evidence);
    event ActiveRoutesChanged(address indexed token, bytes32[] ids);

    constructor(address admin, address executor_) Ownable(admin) {
        if (executor_.code.length == 0) revert InvalidConfig();
        executor = executor_;
    }

    function approveRoute(address token, bytes calldata buy, bytes calldata sell, bytes32 evidence)
        external
        onlyOwner
        returns (bytes32 id)
    {
        if (token.code.length == 0 || evidence == 0 || IERC20Metadata(token).decimals() > 18) {
            revert InvalidConfig();
        }
        address w = IV2Executor(executor).weth();
        if (token == w) revert InvalidConfig();
        IV2Executor(executor).validateRoute(buy, w, token);
        IV2Executor(executor).validateRoute(sell, token, w);
        id = keccak256(abi.encode(token, token.codehash, buy, sell, evidence));
        if (entries[id].token != address(0)) revert InvalidConfig();
        entries[id] = Entry(token, token.codehash, buy, sell);
        if (tokenConfigs[token].length < MAX_ROUTES_PER_TOKEN) tokenConfigs[token].push(id);
        emit RouteApproved(id, token, evidence);
    }

    /// @notice Replaces the bounded runtime fallback set without deleting historical attestations.
    function setActiveRoutes(address token, bytes32[] calldata ids) external onlyOwner {
        if (token.code.length == 0 || ids.length == 0 || ids.length > MAX_ROUTES_PER_TOKEN) revert InvalidConfig();
        delete tokenConfigs[token];
        for (uint256 i; i < ids.length; ++i) {
            if (entries[ids[i]].token != token) revert InvalidConfig();
            for (uint256 j; j < i; ++j) {
                if (ids[j] == ids[i]) revert InvalidConfig();
            }
            tokenConfigs[token].push(ids[i]);
        }
        emit ActiveRoutesChanged(token, ids);
    }

    /// @notice Bounded active routes available to every proportional vault.
    function configsFor(address token) external view returns (bytes32[] memory) {
        return tokenConfigs[token];
    }

    function config(bytes32 id)
        external
        view
        returns (address token, address oracle, bytes memory buy, bytes memory sell)
    {
        Entry storage e = entries[id];
        if (e.token == address(0) || e.token.codehash != e.runtimeHash) revert InvalidConfig();
        return (e.token, address(0), e.buy, e.sell);
    }
}
