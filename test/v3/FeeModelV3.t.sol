// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {HoodxFeeModelV3, IPonsFeeV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";

contract FeeHookFixtureV3 {
    uint256 public fee = 300;

    function currentFeeBps(address) external view returns (uint256) {
        return fee;
    }

    function setFee(uint256 x) external {
        fee = x;
    }

    function launches(bytes32) external view returns (IPonsFeeV3.Launch memory p) {
        p.registered = true;
        p.creatorTax = uint16(fee);
        p.hookFee = 100;
    }
}

contract FeeModelV3Test is Test {
    HoodxFeeModelV3 model;
    FeeHookFixtureV3 q;
    FeeHookFixtureV3 p;

    function setUp() public {
        q = new FeeHookFixtureV3();
        p = new FeeHookFixtureV3();
        model = new HoodxFeeModelV3(address(q), address(q), address(p));
    }

    function testTransferTaxAndPoolFeeCompound() public {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 6;
        h[0].hookData = abi.encode(uint256(300));
        assertEq(model.factor(abi.encode(h)), 967090000000000000);
        assertEq(model.transferFactor(abi.encode(h)), 970000000000000000);
    }

    function testQuotronFeeSeparateFromPriceAllowance() public {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 5;
        uint256 afterFees = model.factor(abi.encode(h));
        assertEq(afterFees, 970000000000000000);
        assertEq(afterFees * 9700 / 10000, 940900000000000000);
        q.setFee(400);
        assertEq(model.factor(abi.encode(h)), 960000000000000000);
    }

    function testMultiHopPoolFeesCompound() public {
        V2Hop[] memory h = new V2Hop[](2);
        h[0].kind = 3;
        h[0].fee = 100;
        h[1].kind = 3;
        h[1].fee = 10000;
        assertEq(model.factor(abi.encode(h)), 989901000000000000);
    }

    function testPonsReadsFrozenPoolTerms() public {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 4;
        h[0].key.hooks = address(p);
        assertEq(model.factor(abi.encode(h)), 960000000000000000);
    }

    function testRejectsUnknownHook() public {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 4;
        h[0].key.hooks = address(123);
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(abi.encode(h));
    }

    function testRejectsUnmodeledDynamicPoolFee() public {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 4;
        h[0].key.fee = 8388608;
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(abi.encode(h));
    }

    function testRejectsHighFeeOrChangedCode() public {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 5;
        q.setFee(2001);
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(abi.encode(h));
        vm.etch(address(q), hex"00");
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(abi.encode(h));
    }
}
