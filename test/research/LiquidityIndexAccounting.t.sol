// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract LiquidityIndexAccountingHarness {
    using Math for uint256;

    function previewShares(uint256 depositValue, uint256 supply, uint256 navBefore) external pure returns (uint256) {
        require(depositValue != 0 && supply != 0 && navBefore != 0, "invalid");
        return Math.mulDiv(depositValue, supply, navBefore);
    }

    function proRata(uint256 assetAmount, uint256 shares, uint256 supply) external pure returns (uint256) {
        require(shares != 0 && shares <= supply, "invalid");
        return Math.mulDiv(assetAmount, shares, supply);
    }
}

/// @notice Design invariants for a future LP vault. The production implementation
/// must satisfy these before any canary deployment.
contract LiquidityIndexAccountingTest is Test {
    LiquidityIndexAccountingHarness internal accounting = new LiquidityIndexAccountingHarness();

    function testDonationBenefitsExistingSharesAndCannotMintExcessShares() public view {
        uint256 supply = 100 ether;
        uint256 navBeforeDonation = 100 ether;
        uint256 donatedValue = 20 ether;
        uint256 depositValue = 10 ether;

        uint256 sharesWithoutDonation = accounting.previewShares(depositValue, supply, navBeforeDonation);
        uint256 sharesAfterDonation = accounting.previewShares(depositValue, supply, navBeforeDonation + donatedValue);

        assertEq(sharesWithoutDonation, 10 ether);
        assertEq(sharesAfterDonation, 8.333333333333333333 ether);
        assertLt(sharesAfterDonation, sharesWithoutDonation);
    }

    function testRedemptionIsProRataAcrossIdleAssets() public view {
        uint256 supply = 100 ether;
        uint256 shares = 25 ether;
        assertEq(accounting.proRata(40 ether, shares, supply), 10 ether);
        assertEq(accounting.proRata(2_000_000e6, shares, supply), 500_000e6);
    }

    function testFuzzShareMintNeverExceedsNaiveOneToOne(
        uint128 depositValue,
        uint128 supply,
        uint128 navBefore,
        uint128 donation
    ) public view {
        vm.assume(depositValue > 0 && supply > 0 && navBefore >= supply && donation > 0);
        uint256 minted = accounting.previewShares(depositValue, supply, uint256(navBefore) + donation);
        assertLe(minted, depositValue);
    }
}
