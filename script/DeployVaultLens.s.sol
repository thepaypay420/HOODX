// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxVaultLens} from "../contracts/lens/HoodxVaultLens.sol";

/// @notice Deploys HoodxVaultLens (read-only share-price reader; no funds, no owner). One deployer transaction.
/// @dev Live broadcast needs HOODX_LIVE_BROADCAST=1 and HOODX_DEPLOY_STAGE=vault-lens (scripts/run_vault_lens_deployer.ps1).
contract DeployVaultLens is Script {
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address internal constant BOOST = 0x5e0135C3592095592C4B43d84c817c26A0F43515;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant STKX = 0xB064d074Ff141A68771AF32c3EAB9Dd3c9379f6D;

    function run() external returns (HoodxVaultLens lens) {
        require(block.chainid == 4663, "wrong chain");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("vault-lens"), "wrong stage");
        }
        bytes32 ethPool = keccak256(abi.encode(address(0), USDG, uint24(100), int24(1), address(0)));
        vm.startBroadcast(DEPLOYER);
        lens = new HoodxVaultLens(BOOST, STATE_VIEW, USDG, ethPool);
        vm.stopBroadcast();
        // sanity: the lens prices the live Hands-free LP and Boosted ETH
        (, uint256 usdLp) = lens.sharePrice(STKX);
        (, uint256 usdBoost) = lens.sharePrice(BOOST);
        require(usdLp > 0.5e18 && usdLp < 2e18 && usdBoost > 0.1e18, "lens prices out of range");
        console2.log("HoodxVaultLens", address(lens));
        console2.log("STKX USD per share (1e18)", usdLp);
        console2.log("BOOSTX USD per share (1e18)", usdBoost);
    }
}
