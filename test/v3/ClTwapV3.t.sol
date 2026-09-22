// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {HoodxClTwapV3} from "../../contracts/v3/HoodxClTwapV3.sol";

contract ClFixture {
    address public token0;
    address public token1;
    address public factory;
    uint128 public liquidity;
    uint128 public historical;
    uint32 public at;
    bool public ready;
    bool public broken;

    function init(address a, address b, address f) external {
        token0 = a;
        token1 = b;
        factory = f;
        set(1000, 1000, uint32(block.timestamp), true);
    }

    function set(uint128 live, uint128 history, uint32 time, bool initialized) public {
        liquidity = live;
        historical = history;
        at = time;
        ready = initialized;
    }

    function tickSpacing() external pure returns (int24) {
        return 200;
    }

    function slot0() external pure returns (uint160, int24, uint16, uint16, uint16, bool) {
        return (1, 0, 0, 1, 1, true);
    }

    function observations(uint256) external view returns (uint32, int56, uint160, bool) {
        return (at, 0, 0, ready);
    }

    function observe(uint32[] calldata times) external view returns (int56[] memory ticks, uint160[] memory acc) {
        require(historical > 0, "missing history");
        ticks = new int56[](2);
        acc = new uint160[](2);
        acc[1] = uint160((uint256(times[0]) << 128) / historical);
    }
}

contract ClFactoryFixture {
    address public pool;

    function set(address p) external {
        pool = p;
    }

    function getPool(address, address, int24) external view returns (address) {
        return pool;
    }

    function isPool(address p) external view returns (bool) {
        return p == pool;
    }
}

contract ClQuoteFixture {
    bool public broken;
    bool public zero;

    function fail() external {
        broken = true;
    }

    function setZero() external {
        zero = true;
    }

    function value(address, uint256 amount) external view returns (uint256) {
        require(!broken, "quote unavailable");
        return zero ? 0 : amount * 2;
    }
}

contract ClTwapV3Test is Test {
    ClFixture impl;
    ClFixture pool;
    ClFactoryFixture factory;
    ClQuoteFixture quote;
    HoodxClTwapV3 oracle;
    address token;
    address cash;

    function setUp() public {
        vm.warp(100000);
        token = address(new ClQuoteFixture());
        cash = address(new ClQuoteFixture());
        impl = new ClFixture();
        pool = ClFixture(Clones.clone(address(impl)));
        factory = new ClFactoryFixture();
        quote = new ClQuoteFixture();
        pool.init(token, cash, address(factory));
        factory.set(address(pool));
        oracle = make(1800, 1800);
    }

    function make(uint32 window, uint32 age) internal returns (HoodxClTwapV3) {
        return new HoodxClTwapV3(
            address(factory), address(pool), address(impl), token, address(quote), window, age, 1000
        );
    }

    function testComposition() public view {
        assertEq(oracle.value(token, 123), 246);
        assertEq(oracle.value(token, 0), 0);
    }

    function testWrongTokenRejected() public {
        vm.expectRevert();
        oracle.value(cash, 1);
    }

    function testStaleRejected() public {
        pool.set(1000, 1000, 98000, true);
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testUninitializedRejected() public {
        pool.set(1000, 1000, 100000, false);
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testLiveDepthRejected() public {
        pool.set(999, 1000, 100000, true);
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testTemporaryLiquidityCannotReplaceHistory() public {
        pool.set(1000000, 999, 100000, true);
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testMissingHistoryRejected() public {
        pool.set(1000, 0, 100000, true);
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testQuoteFailurePropagatesIncludingZero() public {
        quote.fail();
        vm.expectRevert();
        oracle.value(token, 1);
        vm.expectRevert();
        oracle.value(token, 0);
    }

    function testZeroQuoteRejected() public {
        quote.setZero();
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testChangedImplementationRejected() public {
        vm.etch(address(impl), hex"00");
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testChangedQuoteCodeRejected() public {
        vm.etch(address(quote), hex"00");
        vm.expectRevert();
        oracle.value(token, 1);
    }

    function testUnknownFactoryPoolRejected() public {
        factory.set(address(1));
        vm.expectRevert();
        make(1800, 1800);
    }

    function testNonCloneRejected() public {
        pool = impl;
        vm.expectRevert();
        make(1800, 1800);
    }

    function testTooShortWindowRejected() public {
        vm.expectRevert();
        make(1799, 1799);
    }

    function testExcessiveAgeRejected() public {
        vm.expectRevert();
        make(1800, 1801);
    }
}
