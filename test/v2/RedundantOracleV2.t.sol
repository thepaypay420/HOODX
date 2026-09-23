// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IV2Oracle} from "../../contracts/v2/Types.sol";
import {HoodxRedundantOracleV2} from "../../contracts/v2/HoodxRedundantOracleV2.sol";

contract MockReferenceV2 is IV2Oracle {
    uint256 public answer;
    bool public fails;
    function configure(uint256 answer_, bool fails_) external { answer = answer_; fails = fails_; }
    function value(address, uint256 amount) external view returns (uint256) {
        if (fails) revert();
        return answer * amount / 1 ether;
    }
}

contract RedundantOracleV2Test is Test {
    address token = address(new MockReferenceV2());
    MockReferenceV2 primary = new MockReferenceV2();
    MockReferenceV2 secondary = new MockReferenceV2();

    function setUp() public {
        primary.configure(1 ether, false);
        secondary.configure(1.02 ether, false);
    }

    function testAveragesAgreeingReferences() public {
        HoodxRedundantOracleV2 oracle = new HoodxRedundantOracleV2(token, address(primary), address(secondary), 300);
        assertEq(oracle.value(token, 2 ether), 2.02 ether);
    }

    function testUsesHealthySourceWhenOtherFails() public {
        HoodxRedundantOracleV2 oracle = new HoodxRedundantOracleV2(token, address(primary), address(secondary), 300);
        primary.configure(1 ether, true);
        assertEq(oracle.value(token, 2 ether), 2.04 ether);
        primary.configure(1 ether, false);
        secondary.configure(1 ether, true);
        assertEq(oracle.value(token, 2 ether), 2 ether);
    }

    function testRejectsDisagreementAndDoubleFailure() public {
        HoodxRedundantOracleV2 oracle = new HoodxRedundantOracleV2(token, address(primary), address(secondary), 300);
        secondary.configure(1.1 ether, false);
        vm.expectRevert(HoodxRedundantOracleV2.InvalidReference.selector);
        oracle.value(token, 1 ether);
        primary.configure(1 ether, true);
        secondary.configure(1 ether, true);
        vm.expectRevert(HoodxRedundantOracleV2.InvalidReference.selector);
        oracle.value(token, 1 ether);
    }

    function testRejectsWrongAssetAndUnsafeConfiguration() public {
        HoodxRedundantOracleV2 oracle = new HoodxRedundantOracleV2(token, address(primary), address(secondary), 300);
        vm.expectRevert(HoodxRedundantOracleV2.InvalidReference.selector);
        oracle.value(address(123), 1 ether);
        vm.expectRevert(HoodxRedundantOracleV2.InvalidReference.selector);
        new HoodxRedundantOracleV2(token, address(primary), address(secondary), 501);
    }
}
