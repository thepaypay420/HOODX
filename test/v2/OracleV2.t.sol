// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {TestTokenV2} from "./VaultV2.t.sol";

contract OraclePoolV2 {
    address public token0;
    address public token1;
    uint24 public fee = 3000;
    uint128 public liquidity = 1000;
    uint128 public historical = 1000;
    bool public unavailable;

    constructor(address a, address b) {
        token0 = a;
        token1 = b;
    }

    function set(uint128 live, uint128 history, bool bad) external {
        liquidity = live;
        historical = history;
        unavailable = bad;
    }

    function observe(uint32[] calldata ago) external view returns (int56[] memory ticks, uint160[] memory spl) {
        require(!unavailable);
        ticks = new int56[](2);
        spl = new uint160[](2);
        spl[1] = uint160((uint256(ago[0]) << 128) / historical);
    }
}

contract OracleFactoryV2 {
    address public pool;

    constructor(address p) {
        pool = p;
    }

    function getPool(address, address, uint24) external view returns (address) {
        return pool;
    }
}

contract OracleV2Test is Test {
    TestTokenV2 a;
    TestTokenV2 w;
    OraclePoolV2 pool;
    HoodxTwapV2 oracle;

    function setUp() public {
        a = new TestTokenV2("A");
        w = new TestTokenV2("W");
        pool = new OraclePoolV2(address(a), address(w));
        OracleFactoryV2 f = new OracleFactoryV2(address(pool));
        oracle = new HoodxTwapV2(address(f), address(a), address(w), address(pool), address(0), 1800, 500, 0);
    }

    function testReferenceValue() public view {
        assertEq(oracle.value(address(a), 1 ether), 1 ether);
    }

    function testFlashLiquidityCannotReplaceHistory() public {
        pool.set(1000, 1, false);
        vm.expectRevert();
        oracle.value(address(a), 1 ether);
    }

    function testRemovedLiquidityFailsClosed() public {
        pool.set(0, 1000, false);
        vm.expectRevert();
        oracle.value(address(a), 1 ether);
    }

    function testUnavailableObservationFailsClosed() public {
        pool.set(1000, 1000, true);
        vm.expectRevert();
        oracle.value(address(a), 1 ether);
    }

    function testWrongAssetRejected() public {
        vm.expectRevert();
        oracle.value(address(w), 1 ether);
    }
}
