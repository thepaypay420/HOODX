// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxPolicyV2} from "../v2/HoodxPolicyV2.sol";
import {HoodxLaunchHunterV3} from "./HoodxLaunchHunterV3.sol";

interface IHunterExecutorIdentityV3 {
    function weth() external view returns (address);
    function hookRegistry() external view returns (address);
}

interface IHunterHookRegistryV3 {
    function isApprovedHook(address hook) external view returns (bool);
}

interface IHunterBaseIndexV3 is IERC20 {
    function weth() external view returns (address);
    function owner() external view returns (address);
    function bootstrapped() external view returns (bool);
    function sleeves() external view returns (address[] memory);
}

/// @notice One-purpose deployer for the closed HUNTX V3 pilot after its FEEX base has been funded.
/// @dev The launcher receives no ownership and has no callable administrative function.
contract HoodxLaunchHunterLaunchV3 {
    address public constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address public constant EXECUTOR = 0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750;
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address public constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    uint256 public constant BPS = 10_000;

    address public immutable baseIndex;
    bytes32 public immutable reviewedExecutorHash;
    bytes32 public immutable reviewedBaseIndexHash;
    uint256 public immutable baseSeedAmount;
    uint256 public immutable wethSeedAmount;
    uint256 public immutable riskReferenceAmount;
    uint256 public immutable initialShares;
    HoodxPolicyV2 public immutable policy;
    HoodxLaunchHunterV3 public immutable vault;

    constructor(
        address baseIndex_,
        bytes32 executorHash_,
        bytes32 baseIndexHash_,
        uint256 baseSeedAmount_,
        uint256 wethSeedAmount_,
        uint256 riskReferenceAmount_,
        uint256 initialShares_
    ) {
        require(block.chainid == 4663, "wrong chain");
        require(EXECUTOR.codehash == executorHash_ && executorHash_ != bytes32(0), "executor changed");
        require(baseIndex_.codehash == baseIndexHash_ && baseIndexHash_ != bytes32(0), "base changed");
        require(IHunterExecutorIdentityV3(EXECUTOR).weth() == WETH, "weth changed");
        require(IHunterExecutorIdentityV3(EXECUTOR).hookRegistry() == REGISTRY, "registry changed");
        require(IHunterHookRegistryV3(REGISTRY).isApprovedHook(PONS_HOOK), "PONS hook inactive");
        require(
            baseSeedAmount_ == initialShares_ * 8000 / BPS && wethSeedAmount_ == riskReferenceAmount_ * 2000 / BPS,
            "allocation mismatch"
        );

        IHunterBaseIndexV3 base = IHunterBaseIndexV3(baseIndex_);
        require(base.weth() == WETH && base.bootstrapped(), "base not ready");
        require(base.totalSupply() == baseSeedAmount_ && base.balanceOf(CURATOR) == baseSeedAmount_, "base supply");
        address controller = base.owner();
        require(controller.code.length != 0, "base controller");
        address[] memory sleeves = base.sleeves();
        require(sleeves.length == 4, "base sleeves");
        for (uint256 i; i < sleeves.length; ++i) {
            require(sleeves[i].code.length != 0 && IERC20(sleeves[i]).balanceOf(baseIndex_) != 0, "empty sleeve");
        }

        baseIndex = baseIndex_;
        reviewedExecutorHash = executorHash_;
        reviewedBaseIndexHash = baseIndexHash_;
        baseSeedAmount = baseSeedAmount_;
        wethSeedAmount = wethSeedAmount_;
        riskReferenceAmount = riskReferenceAmount_;
        initialShares = initialShares_;

        policy = new HoodxPolicyV2(CURATOR, EXECUTOR);
        address[] memory baseSleeves = new address[](1);
        baseSleeves[0] = baseIndex_;
        uint256[] memory baseAmounts = new uint256[](1);
        baseAmounts[0] = baseSeedAmount_;
        vault = new HoodxLaunchHunterV3(
            address(policy), CURATOR, wethSeedAmount_, riskReferenceAmount_, initialShares_, baseSleeves, baseAmounts
        );
        require(policy.owner() == CURATOR && vault.curator() == CURATOR, "authority mismatch");
    }
}
