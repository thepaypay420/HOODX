// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HoodxIndex} from "./HoodxIndex.sol";

/// @title HoodxFactory — mint a meme index, drop the link, earn a cut
/// @notice Isolated side project. Not the LP desk.
///
/// create() clones HoodxIndex. Each constituent must ship a Uni V3 WETH pool
/// or a Uni V4 ETH/WETH pool so NAV is on-chain, not an owner price.
/// Slug `696x` is reserved (create696x, owner-only). Friends join via /i/{slug}.

contract HoodxFactory {
    address public owner;
    address public immutable implementation;
    address public immutable weth;
    address public immutable swapRouter;
    address public immutable v4Manager;
    address public immutable v4StateView;
    address public immutable v4Posm;
    address public treasury;
    uint16 public protocolFeeBps = 10;
    uint16 public constant MAX_CREATOR_FEE_BPS = 50;
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 50;

    mapping(string => address) public bySlug;
    mapping(address => string) public slugOf;
    address[] public all;

    error NotOwner();
    error Zero();
    error BadSlug();
    error Taken();
    error BadLen();
    error MaxFee();

    event Created(
        address indexed vault,
        address indexed creator,
        string slug,
        string name,
        string symbol,
        uint16 creatorFeeBps
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address weth_,
        address router_,
        address treasury_,
        address v4Manager_,
        address v4StateView_,
        address v4Posm_
    ) {
        if (weth_ == address(0) || router_ == address(0) || treasury_ == address(0)) revert Zero();
        if (v4Manager_ == address(0) || v4StateView_ == address(0) || v4Posm_ == address(0)) revert Zero();
        owner = msg.sender;
        weth = weth_;
        swapRouter = router_;
        treasury = treasury_;
        v4Manager = v4Manager_;
        v4StateView = v4StateView_;
        v4Posm = v4Posm_;
        implementation = address(new HoodxIndex());
    }

    function indexCount() external view returns (uint256) {
        return all.length;
    }

    function indexAt(uint256 i) external view returns (address) {
        return all[i];
    }

    /// @dev First index. 696_eth watchlist. 0.08 ETH first mint (~$200).
    function create696x(
        address[] calldata tokens,
        bytes32[] calldata pools,
        address recipient_
    ) external onlyOwner returns (address) {
        return _create(msg.sender, "696x", "696X", "696x", tokens, pools, 40, 0.08 ether, recipient_);
    }

    /// @dev Anyone. Min 2 Uni V3 WETH or V4 ETH/WETH names. First mint 0.02 ETH.
    function create(
        string calldata name_,
        string calldata symbol_,
        string calldata slug,
        address[] calldata tokens,
        bytes32[] calldata pools,
        uint16 creatorFeeBps,
        address recipient_
    ) external returns (address) {
        if (_eq(slug, "696x") || _eq(slug, "hoodx")) revert Taken();
        return _create(msg.sender, name_, symbol_, slug, tokens, pools, creatorFeeBps, 0.02 ether, recipient_);
    }

    function setTreasury(address who) external onlyOwner {
        if (who == address(0)) revert Zero();
        treasury = who;
    }

    function setProtocolFee(uint16 bps) external onlyOwner {
        if (bps > MAX_PROTOCOL_FEE_BPS) revert MaxFee();
        protocolFeeBps = bps;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert Zero();
        owner = next;
    }

    function _create(
        address creator,
        string memory name_,
        string memory symbol_,
        string memory slug,
        address[] calldata tokens,
        bytes32[] calldata pools,
        uint16 creatorFeeBps,
        uint256 minFirst,
        address recipient_
    ) internal returns (address vault) {
        if (!_okSlug(slug)) revert BadSlug();
        if (bySlug[slug] != address(0)) revert Taken();
        if (tokens.length < 2 || tokens.length > 24) revert BadLen();
        if (tokens.length != pools.length) revert BadLen();
        if (uint256(protocolFeeBps) + uint256(creatorFeeBps) > 100) revert MaxFee();
        if (creatorFeeBps > MAX_CREATOR_FEE_BPS) revert MaxFee();
        vault = _clone(implementation);
        HoodxIndex(payable(vault)).initialize(
            HoodxIndex.InitParams({
                creator: creator,
                protocol: treasury,
                weth: weth,
                router: swapRouter,
                v4Manager: v4Manager,
                v4StateView: v4StateView,
                v4Posm: v4Posm,
                name: name_,
                symbol: symbol_,
                protocolFeeBps: protocolFeeBps,
                creatorFeeBps: creatorFeeBps,
                minFirstDeposit: minFirst,
                recipient: recipient_
            }),
            tokens,
            pools
        );
        bySlug[slug] = vault;
        slugOf[vault] = slug;
        all.push(vault);
        emit Created(vault, creator, slug, name_, symbol_, creatorFeeBps);
    }

    function _okSlug(string memory s) internal pure returns (bool) {
        bytes memory b = bytes(s);
        if (b.length < 3 || b.length > 16) return false;
        if (_eq(s, "create") || _eq(s, "factory") || _eq(s, "admin") || _eq(s, "index")) return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool num = c >= 0x30 && c <= 0x39;
            bool low = c >= 0x61 && c <= 0x7a;
            if (!num && !low) return false;
        }
        return true;
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _clone(address impl) internal returns (address instance) {
        bytes20 target = bytes20(impl);
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), target)
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        if (instance == address(0)) revert Zero();
    }
}
