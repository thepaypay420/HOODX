// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {HoodxFreshTwapV3} from "../../contracts/v3/HoodxFreshTwapV3.sol";

contract ObservationFixtureV3 {
    uint32 public at;
    bool public initialized = true;

    function set(uint32 time, bool ready) external {
        at = time;
        initialized = ready;
    }

    function slot0() external pure returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (1, 0, 0, 1, 1, 0, true);
    }

    function observations(uint256) external view returns (uint32, int56, uint160, bool) {
        return (at, 0, 0, initialized);
    }
}

contract ReferenceFixtureV3 {
    address public pool;
    address public bridge;
    uint32 public constant window = 1800;
    bool public broken;

    constructor(address p, address b) {
        pool = p;
        bridge = b;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function value(address, uint256 amount) external view returns (uint256) {
        require(!broken, "depth/history failed");
        return amount;
    }
}

contract FreshTwapV3Test is Test {
    ObservationFixtureV3 pool;
    ObservationFixtureV3 bridge;
    ReferenceFixtureV3 reference_;
    HoodxFreshTwapV3 oracle;

    function setUp() public {
        vm.warp(100000);
        pool = new ObservationFixtureV3();
        bridge = new ObservationFixtureV3();
        pool.set(100000, true);
        bridge.set(100000, true);
        reference_ = new ReferenceFixtureV3(address(pool), address(bridge));
        oracle = new HoodxFreshTwapV3(address(reference_), 1800);
    }

    function testRecentReferencePreservesValue() public view {
        assertEq(oracle.value(address(1), 123), 123);
    }

    function testStaleReferenceRejectsEvenThoughUnderlyingQuotes() public {
        pool.set(1, true);
        vm.expectRevert(HoodxFreshTwapV3.StaleReference.selector);
        oracle.value(address(1), 123);
    }

    function testStaleBridgeRejects() public {
        bridge.set(1, true);
        vm.expectRevert(HoodxFreshTwapV3.StaleReference.selector);
        oracle.value(address(1), 123);
    }

    function testUninitializedObservationRejects() public {
        pool.set(100000, false);
        vm.expectRevert(HoodxFreshTwapV3.StaleReference.selector);
        oracle.value(address(1), 123);
    }

    function testFreshnessDoesNotBypassDepthFailure() public {
        reference_.setBroken(true);
        vm.expectRevert("depth/history failed");
        oracle.value(address(1), 123);
    }

    function testCannotChooseAgeLongerThanWindow() public {
        vm.expectRevert(HoodxFreshTwapV3.StaleReference.selector);
        new HoodxFreshTwapV3(address(reference_), 1801);
    }

    function testUint32TimestampWrap() public {
        vm.warp((1 << 32) + 20);
        pool.set(type(uint32).max - 10, true);
        bridge.set(20, true);
        assertEq(oracle.value(address(1), 123), 123);
    }

    function testChangedReferenceCodeRejects() public {
        vm.etch(address(reference_), hex"00");
        vm.expectRevert(HoodxFreshTwapV3.StaleReference.selector);
        oracle.value(address(1), 123);
    }
}
