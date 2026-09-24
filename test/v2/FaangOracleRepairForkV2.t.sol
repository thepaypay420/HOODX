// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxRedundantOracleV2} from "../../contracts/v2/HoodxRedundantOracleV2.sol";
import {HoodxRebalanceControllerV2} from "../../contracts/v2/HoodxRebalanceControllerV2.sol";

contract FaangOracleRepairForkV2Test is Test {
    address constant VAULT = 0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0;
    address constant CONTROLLER = 0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant BRIDGE = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address constant AMZN_POOL = 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef;
    address constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address constant GOOGL_PRIMARY_POOL = 0x8c2B4303fA0B99d07A5D3E9411497A277e65b673;
    address constant GOOGL_SECONDARY_POOL = 0x8fB9301586f27e2cff85312F7c1d0F16C6167cdE;

    uint128 constant AMZN_DEPTH = 500_000_000_000_000_000;
    uint128 constant BRIDGE_DEPTH = 2_500_000_000_000_000_000;
    uint128 constant GOOGL_PRIMARY_DEPTH = 250_000_000_000_000_000_000;
    uint128 constant GOOGL_SECONDARY_DEPTH = 900_000_000_000_000_000;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        assertEq(block.chainid, 4663);
    }

    function testRepairRestoresValuationAndFullEthExit() public {
        HoodxIndexV2 vault = HoodxIndexV2(payable(VAULT));
        HoodxPolicyV2 policy = HoodxPolicyV2(address(vault.policy()));
        HoodxRebalanceControllerV2 controller = HoodxRebalanceControllerV2(CONTROLLER);
        assertEq(vault.owner(), CONTROLLER);
        assertEq(controller.curator(), CURATOR);

        _installAmzn(vault, policy, controller);
        _installGoogl(vault, policy, controller);

        uint256 assets = vault.totalAssets();
        assertGt(assets, 0, "valuation not restored");
        uint256 shares = vault.balanceOf(CURATOR);
        uint256 minimum = assets * shares / vault.totalSupply() * 95 / 100;
        uint256 beforeEth = CURATOR.balance;
        vm.prank(CURATOR);
        uint256 received = vault.withdraw(shares, minimum, block.timestamp + 300);
        assertGe(received, minimum);
        assertEq(CURATOR.balance - beforeEth, received);
        assertEq(vault.balanceOf(CURATOR), 0);
    }

    function _installAmzn(
        HoodxIndexV2 vault,
        HoodxPolicyV2 policy,
        HoodxRebalanceControllerV2 controller
    ) private {
        bytes32 oldId = vault.configId(AMZN);
        (address token,, bytes memory buy, bytes memory sell) = policy.config(oldId);
        assertEq(token, AMZN);
        HoodxTwapV2 oracle = new HoodxTwapV2(
            FACTORY, AMZN, WETH, AMZN_POOL, BRIDGE, 1800, AMZN_DEPTH, BRIDGE_DEPTH
        );
        assertGt(oracle.value(AMZN, 1 ether), 0);
        vm.prank(CURATOR);
        bytes32 id = policy.approveConfig(
            AMZN, address(oracle), buy, sell, keccak256("FAANGX_AMZN_REFERENCE_REVIEW_2026_09_24")
        );
        vm.prank(CURATOR);
        controller.replaceConfig(id);
        assertEq(vault.configId(AMZN), id);
    }

    function _installGoogl(
        HoodxIndexV2 vault,
        HoodxPolicyV2 policy,
        HoodxRebalanceControllerV2 controller
    ) private {
        bytes32 oldId = vault.configId(GOOGL);
        (address token,, bytes memory buy, bytes memory sell) = policy.config(oldId);
        assertEq(token, GOOGL);
        HoodxTwapV2 primary = new HoodxTwapV2(
            FACTORY, GOOGL, WETH, GOOGL_PRIMARY_POOL, address(0), 1800, GOOGL_PRIMARY_DEPTH, 0
        );
        HoodxTwapV2 secondary = new HoodxTwapV2(
            FACTORY, GOOGL, WETH, GOOGL_SECONDARY_POOL, address(0), 1800, GOOGL_SECONDARY_DEPTH, 0
        );
        assertApproxEqRel(primary.value(GOOGL, 1 ether), secondary.value(GOOGL, 1 ether), 0.01 ether);
        HoodxRedundantOracleV2 oracle = new HoodxRedundantOracleV2(
            GOOGL, address(primary), address(secondary), 300
        );
        assertGt(oracle.value(GOOGL, 1 ether), 0);
        vm.prank(CURATOR);
        bytes32 id = policy.approveConfig(
            GOOGL, address(oracle), buy, sell, keccak256("FAANGX_GOOGL_REDUNDANT_REFERENCE_REVIEW_2026_09_24")
        );
        vm.prank(CURATOR);
        controller.replaceConfig(id);
        assertEq(vault.configId(GOOGL), id);
    }
}
