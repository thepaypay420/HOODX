// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {v2BuildFingerprint} from "./V2Build.sol";
import {HoodxOfficialFactoryV2} from "../contracts/v2/HoodxBootstrapV2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {IV2Oracle, IV2Weth} from "../contracts/v2/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice One reviewed canary step per signing session; no production deployment entry point.
contract CanaryStepV2 is Script {
    using SafeERC20 for IERC20;
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == v2BuildFingerprint(), "build mismatch");
        }
        string memory basket = vm.envString("HOODX_CANARY_BASKET");
        bytes32 name = keccak256(bytes(basket));
        require(name == keccak256("696x") || name == keccak256("faangx"), "unknown basket");
        HoodxOfficialFactoryV2 factory = HoodxOfficialFactoryV2(vm.envAddress("HOODX_CANARY_FACTORY"));
        require(factory.owner() == CURATOR, "factory owner");
        HoodxIndexV2 v = HoodxIndexV2(payable(factory.bySlug(basket)));
        require(
            v.owner() == CURATOR && v.creator() == CURATOR && v.creatorRecipient() == CURATOR
                && v.treasury() == CURATOR,
            "roles"
        );
        require(address(v) == vm.envAddress("HOODX_CANARY_VAULT"), "vault mismatch");
        uint256 capital = name == keccak256("696x") ? 0.08 ether : 0.02 ether;
        bytes32 action = keccak256(bytes(vm.envString("HOODX_CANARY_ACTION")));
        uint256 expected = vm.envUint("HOODX_EXPECTED_SHARES");
        require(v.balanceOf(DEPLOYER) == expected && v.totalSupply() == expected, "share state changed");
        uint256 deadline = block.timestamp + 600;
        if (action == keccak256("deposit")) {
            require(expected == 0 && v.totalAssets() == 0 && !v.paused(), "not empty or paused");
            uint256 floor = v.previewDeposit(capital) * 99 / 100;
            vm.startBroadcast(DEPLOYER);
            v.deposit{value: capital}(floor, deadline);
            vm.stopBroadcast();
            address[] memory bought = v.constituents();
            for (uint256 i; i < bought.length; ++i) {
                if (v.targetBps(bought[i]) > 0) {
                    require(IERC20(bought[i]).balanceOf(address(v)) > 0, "intended buy deferred");
                }
            }
        } else if (action == keccak256("partial") || action == keccak256("final")) {
            require(expected > 0, "no shares");
            uint256 amount = action == keccak256("partial") ? expected / 2 : expected;
            vm.startBroadcast(DEPLOYER);
            v.withdraw(amount, capital * 45 / 100, deadline);
            vm.stopBroadcast();
        } else if (action == keccak256("in-kind")) {
            require(expected > 100 && v.paused(), "not paused or no shares");
            vm.startBroadcast(DEPLOYER);
            v.emergencyRedeemInKind(expected / 100, DEPLOYER);
            vm.stopBroadcast();
        } else if (action == keccak256("recover-tokens")) {
            address[] memory tokens = v.constituents();
            // The operator verifies recipient baselines and claims before this explicit recovery step.
            vm.startBroadcast(DEPLOYER);
            for (uint256 i; i < tokens.length; ++i) {
                uint256 amount = IERC20(tokens[i]).balanceOf(DEPLOYER);
                if (amount == 0) continue;
                (, address oracle,, bytes memory sell) = v.policy().config(v.configId(tokens[i]));
                uint256 floor = IV2Oracle(oracle).value(tokens[i], amount) * 97 / 100;
                require(floor > 0, "dust requires review");
                IERC20(tokens[i]).forceApprove(address(v.executor()), amount);
                v.executor().execute(tokens[i], v.weth(), amount, floor, sell, deadline);
                IERC20(tokens[i]).forceApprove(address(v.executor()), 0);
            }
            uint256 wrapped = IERC20(v.weth()).balanceOf(DEPLOYER);
            if (wrapped > 0) IV2Weth(v.weth()).withdraw(wrapped);
            vm.stopBroadcast();
        } else {
            revert("unknown action");
        }
    }
}
