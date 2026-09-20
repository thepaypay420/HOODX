// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {HoodxIndexV2} from "./HoodxIndexV2.sol";

contract HoodxFactoryV2 is Ownable2Step {
    address public immutable implementation;
    address public immutable treasury;
    uint16 public constant PROTOCOL_FEE_BPS = 10;
    mapping(string => address) public bySlug;
    address[] public all;
    error Invalid();
    event Created(address indexed vault, string slug, address curator, address creator);

    constructor(address admin, address treasury_, address implementation_) Ownable(admin) {
        if (treasury_ == address(0) || implementation_.code.length == 0) revert Invalid();
        treasury = treasury_;
        implementation = implementation_;
    }

    function create(
        string calldata slug,
        HoodxIndexV2.Init calldata p,
        bytes32[] calldata configs,
        uint16[] calldata weights
    ) external returns (address vault) {
        bytes32 hash = keccak256(bytes(slug));
        if (hash == keccak256("696x") || hash == keccak256("faangx") || hash == keccak256("hoodx")) {
            if (msg.sender != owner()) revert Invalid();
        } else if (p.creator != msg.sender) {
            revert Invalid();
        }
        return _create(slug, p, configs, weights);
    }

    function _create(string memory slug, HoodxIndexV2.Init memory p, bytes32[] memory configs, uint16[] memory weights)
        internal
        returns (address vault)
    {
        bytes memory s = bytes(slug);
        if (
            s.length < 3 || s.length > 16 || bySlug[slug] != address(0) || p.protocolFee != PROTOCOL_FEE_BPS
                || p.treasury != treasury
        ) {
            revert Invalid();
        }
        for (uint256 i; i < s.length; ++i) {
            if (!((s[i] >= 0x61 && s[i] <= 0x7a) || (s[i] >= 0x30 && s[i] <= 0x39))) revert Invalid();
        }
        vault = Clones.clone(implementation);
        bySlug[slug] = vault;
        HoodxIndexV2(payable(vault)).initialize(p, configs, weights);
        all.push(vault);
        emit Created(vault, slug, p.curator, p.creator);
    }
}
