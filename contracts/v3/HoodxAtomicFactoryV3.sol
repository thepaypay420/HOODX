// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {HoodxIndexV2} from "../v2/HoodxIndexV2.sol";
import {IV2Policy} from "../v2/Types.sol";
import {HoodxProportionalV3} from "./HoodxProportionalV3.sol";
import {HoodxRebalanceControllerV3} from "./HoodxRebalanceControllerV3.sol";

interface IProportionalIdentityV3 {
    function accountingMode() external pure returns (bytes32);
}

/// @notice Creates a proportional vault and its atomic controller in one user transaction.
/// @dev The vault is initialized with the controller as owner and the requested human curator
///      pinned inside that controller. No later ownership transaction is needed.
contract HoodxAtomicFactoryV3 is Ownable2Step {
    address public immutable implementation;
    address public immutable treasury;
    IV2Policy public immutable routePolicy;
    uint16 public constant PROTOCOL_FEE_BPS = 10;
    mapping(address => bytes32) public configIdByToken;
    mapping(string => address) public bySlug;
    address[] public all;

    error Invalid();
    event Created(address indexed vault, string slug, address curator, address creator);

    event ConfigRegistered(address indexed token, bytes32 indexed configId);
    event AtomicCreated(
        address indexed vault, address indexed controller, string slug, address curator, address creator
    );

    constructor(address admin, address treasury_, address implementation_, bytes32[] memory initialConfigs)
        Ownable(admin)
    {
        if (
            treasury_ == address(0) || implementation_.code.length == 0
                || IProportionalIdentityV3(implementation_).accountingMode() != keccak256("HOODX_PROPORTIONAL_V1")
        ) revert Invalid();
        treasury = treasury_;
        implementation = implementation_;
        routePolicy = HoodxProportionalV3(payable(implementation_)).policy();
        _registerConfigs(initialConfigs);
    }

    /// @notice Publishes the current reviewed policy ID for cheap wallet-side basket creation.
    function registerConfigs(bytes32[] calldata ids) external onlyOwner {
        _registerConfigs(ids);
    }

    function _registerConfigs(bytes32[] memory ids) internal {
        for (uint256 i; i < ids.length; ++i) {
            (address token,,,) = routePolicy.config(ids[i]);
            if (token == address(0)) revert Invalid();
            configIdByToken[token] = ids[i];
            emit ConfigRegistered(token, ids[i]);
        }
    }

    function createAtomic(
        string calldata slug,
        HoodxIndexV2.Init calldata p,
        bytes32[] calldata configs,
        uint16[] calldata weights
    ) external returns (address vault, address controller) {
        return _createAtomic(slug, p, configs, weights);
    }

    /// @notice Creates a reviewed official collection in one owner transaction.
    /// @dev Each member still passes the same creator, route, slug and initialization checks.
    function createAtomicBatch(
        string[] calldata slugs,
        HoodxIndexV2.Init[] calldata params,
        bytes32[][] calldata configs,
        uint16[][] calldata weights
    ) external onlyOwner returns (address[] memory vaults, address[] memory controllers) {
        uint256 length = slugs.length;
        if (length == 0 || length > 12 || params.length != length || configs.length != length || weights.length != length) {
            revert Invalid();
        }
        vaults = new address[](length);
        controllers = new address[](length);
        for (uint256 i; i < length; ++i) {
            (vaults[i], controllers[i]) = _createAtomic(slugs[i], params[i], configs[i], weights[i]);
        }
    }

    function _createAtomic(
        string calldata slug,
        HoodxIndexV2.Init calldata p,
        bytes32[] calldata configs,
        uint16[] calldata weights
    ) private returns (address vault, address controller) {
        bytes32 hash = keccak256(bytes(slug));
        if (hash == keccak256("696x") || hash == keccak256("faangx") || hash == keccak256("hoodx")) {
            if (msg.sender != owner()) revert Invalid();
        } else if (p.creator != msg.sender) {
            revert Invalid();
        }

        bytes memory slugBytes = bytes(slug);
        if (
            slugBytes.length < 3 || slugBytes.length > 16 || bySlug[slug] != address(0)
                || p.protocolFee != PROTOCOL_FEE_BPS || p.treasury != treasury
        ) revert Invalid();
        for (uint256 i; i < slugBytes.length; ++i) {
            if (!((slugBytes[i] >= 0x61 && slugBytes[i] <= 0x7a) || (slugBytes[i] >= 0x30 && slugBytes[i] <= 0x39))) {
                revert Invalid();
            }
        }
        for (uint256 i; i < configs.length; ++i) {
            (address token,,,) = routePolicy.config(configs[i]);
            if (configIdByToken[token] != configs[i]) revert Invalid();
        }

        vault = Clones.clone(implementation);
        controller = address(new HoodxRebalanceControllerV3(vault, p.curator));
        HoodxIndexV2.Init memory atomicInit = p;
        atomicInit.curator = controller;

        bySlug[slug] = vault;
        HoodxIndexV2(payable(vault)).initialize(atomicInit, configs, weights);
        all.push(vault);

        emit Created(vault, slug, p.curator, p.creator);
        emit AtomicCreated(vault, controller, slug, p.curator, p.creator);
    }
}
