// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxRedundantOracleV2} from "../../contracts/v2/HoodxRedundantOracleV2.sol";

contract MemeOracleRepairForkTest is Test {
    address constant VAULT = 0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant MEME = 0x385F4f8ae47651ce5F58F5265395a669f8281e18;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant OLD_POOL = 0x97BCdd384fC144899545dEB749b6DAF2AA52a2C5;
    address constant ALTERNATE_POOL = 0xE2c12a7379706A291CadAaEc1d22458be2f7239D;
    uint128 constant REVIEWED_ABSOLUTE_DEPTH = 16_229_335_552_032_950_196_823;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        assertEq(block.chainid, 4663);
    }

    function testAlternateReferenceRestoresLiveMaxExitWithoutMovingAssets() public {
        HoodxIndexV2 vault = HoodxIndexV2(payable(VAULT));
        HoodxPolicyV2 policy = HoodxPolicyV2(address(vault.policy()));
        bytes32 oldId = vault.configId(MEME);
        (address token,, bytes memory buy, bytes memory sell) = policy.config(oldId);
        assertEq(token, MEME);

        // Read the old pool price with depth disabled only as a fork comparison. This
        // comparison oracle is never installed in policy or used by the vault.
        HoodxTwapV2 comparison = new HoodxTwapV2(V3_FACTORY, MEME, WETH, OLD_POOL, address(0), 1800, 1, 0);
        HoodxTwapV2 secondary = new HoodxTwapV2(
            V3_FACTORY, MEME, WETH, ALTERNATE_POOL, address(0), 1800, REVIEWED_ABSOLUTE_DEPTH, 0
        );
        uint256 oldPrice = comparison.value(MEME, 1 ether);
        uint256 candidatePrice = secondary.value(MEME, 1 ether);
        assertApproxEqRel(candidatePrice, oldPrice, 0.02 ether, "independent TWAPs disagree by >2%");

        (, address primary,,) = policy.config(oldId);
        HoodxRedundantOracleV2 candidate = new HoodxRedundantOracleV2(MEME, primary, address(secondary), 300);
        assertEq(candidate.value(MEME, 1 ether), candidatePrice, "failed primary should use secondary");

        vm.prank(CURATOR);
        bytes32 newId = policy.approveConfig(
            MEME, address(candidate), buy, sell, keccak256("MEME_ALTERNATE_V3_REFERENCE_REVIEW_2026_09_22")
        );
        vm.prank(CURATOR);
        vault.replaceConfig(newId);
        assertEq(vault.configId(MEME), newId);

        uint256 shares = vault.balanceOf(CURATOR);
        uint256 supply = vault.totalSupply();
        uint256 assets = vault.totalAssets();
        uint256 minimum = assets * shares / supply * 95 / 100;
        uint256 beforeEth = CURATOR.balance;
        vm.prank(CURATOR);
        uint256 received = vault.withdraw(shares, minimum, block.timestamp + 300);
        assertGe(received, minimum);
        assertEq(CURATOR.balance - beforeEth, received);
        assertEq(vault.balanceOf(CURATOR), 0);
    }
}
