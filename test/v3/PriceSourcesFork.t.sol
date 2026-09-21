// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxFreshTwapV3, IObservationAgeV3} from "../../contracts/v3/HoodxFreshTwapV3.sol";

interface IHistoryPoolV3 is IObservationAgeV3 {
    function increaseObservationCardinalityNext(uint16 capacity) external;
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    function liquidity() external view returns (uint128);
}

contract PriceSourcesForkTest is Test {
    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envUint("HOODX_FORK_BLOCK"));
        assertEq(block.chainid, 4663);
    }

    function capacity(address pool) internal {
        IHistoryPoolV3 p = IHistoryPoolV3(pool);
        (uint160 price,, uint16 index,,,,) = p.slot0();
        uint128 liquidity = p.liquidity();
        uint32[] memory times = new uint32[](2);
        times[0] = 1800;
        bool hadHistory;
        try p.observe(times) returns (int56[] memory, uint160[] memory) { hadHistory = true; } catch {}
        uint256 before_ = gasleft();
        p.increaseObservationCardinalityNext(128);
        emit log_named_uint("History capacity expansion gas", before_ - gasleft());
        (uint160 afterPrice,, uint16 afterIndex,, uint16 next,,) = p.slot0();
        assertEq(afterPrice, price);
        assertEq(afterIndex, index);
        assertEq(p.liquidity(), liquidity);
        assertGe(next, 128);
        // Growing capacity preserves existing history but cannot invent missing history.
        if (!hadHistory) vm.expectRevert();
        p.observe(times);
    }

    function testPrismHistoryCapacityPreparation() public {
        capacity(address(bytes20(hex"f1d6b8ecaf2271233bed626fb1962bc0c39cb1f3")));
    }

    function testZealHistoryCapacityPreparation() public {
        capacity(address(bytes20(hex"f1bef60e5cf6c00e7e1308d3710811dad71f4b6c")));
    }

    function testRejectsActualStaleQuotronReference() public {
        address token = address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f"));
        HoodxTwapV2 base = new HoodxTwapV2(
            address(bytes20(hex"1f7d7550b1b028f7571e69a784071f0205fd2efa")),
            token,
            address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")),
            address(bytes20(hex"df63749e93d443ed548186a351ae6b37d8914ac3")),
            address(0),
            1800,
            163579489062792213,
            0
        );
        assertGt(base.value(token, 1e18), 0);
        HoodxFreshTwapV3 fresh = new HoodxFreshTwapV3(address(base), 1800);
        vm.expectRevert(HoodxFreshTwapV3.StaleReference.selector);
        fresh.value(token, 1e18);
    }
}
