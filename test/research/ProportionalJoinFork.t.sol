// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {SuccessorWatchlistForkTest} from "../v3/SuccessorWatchlistFork.t.sol";
import {ProportionalJoinHarness} from "./ProportionalJoinHarness.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {V2Hop, V2PoolKey} from "../../contracts/v2/Types.sol";

/// Research only: actual three-token routing, no fabricated prices and no NAV oracle.
contract ProportionalJoinForkTest is SuccessorWatchlistForkTest {
    receive() external payable {}

    function paths(address token, address quoteToken) internal view returns (V2Hop[] memory h) {
        bool multi = quoteToken != address(0);
        h = new V2Hop[](multi ? 2 : 1);
        if (multi) h[0] = bridge(quoteToken);
        V2Hop memory a;
        a.kind = 4;
        a.tokenIn = quoteToken;
        a.tokenOut = token;
        a.key = V2PoolKey(
            token < quoteToken ? token : quoteToken,
            token < quoteToken ? quoteToken : token,
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        h[h.length - 1] = a;
    }

    function testResearchThreeTokenETHJoinAndExit() public {
        address[] memory tokens = new address[](3);
        tokens[0] = address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55"));
        tokens[1] = address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5"));
        tokens[2] = address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261"));
        ProportionalJoinHarness vault = new ProportionalJoinHarness(address(ex), tokens);
        bytes[] memory buys = new bytes[](3);
        bytes[] memory sells = new bytes[](3);
        uint256[] memory budgets = new uint256[](3);
        uint256[] memory floors = new uint256[](3);
        uint256[] memory oldBalances = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            V2Hop[] memory h =
                paths(tokens[i], i == 2 ? address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea")) : address(0));
            uint256 output = 0.001 ether;
            for (uint256 j; j < h.length; ++j) {
                output = quote(h[j], output);
            }
            IERC20(W).approve(address(ex), 0.001 ether);
            uint256 got = ex.execute(
                W, tokens[i], 0.001 ether, output * 9700 / 10000, abi.encode(h), block.timestamp + 300
            );
            IERC20(tokens[i]).transfer(address(vault), got);
            oldBalances[i] = IERC20(tokens[i]).balanceOf(address(vault));
            buys[i] = abi.encode(h);
            budgets[i] = 0.001 ether;
            V2Hop[] memory reverse = new V2Hop[](h.length);
            for (uint256 j; j < h.length; ++j) {
                reverse[j] = h[h.length - 1 - j];
                (reverse[j].tokenIn, reverse[j].tokenOut) = (reverse[j].tokenOut, reverse[j].tokenIn);
            }
            sells[i] = abi.encode(reverse);
        }
        IERC20(W).transfer(address(vault), 0.001 ether);
        vault.seedShares(address(this), 1 ether);
        address newcomer = address(0xBEEF);
        vm.deal(newcomer, 1 ether);
        vm.prank(newcomer);
        uint256 refund = vault.depositETH{value: 0.005 ether}(0.99 ether, budgets, buys, block.timestamp + 300);
        assertEq(refund, 0.00101 ether);
        assertEq(vault.balanceOf(newcomer), 0.99 ether);
        for (uint256 i; i < 3; ++i) {
            uint256 balance = IERC20(tokens[i]).balanceOf(address(vault));
            assertGe(balance * 1 ether, oldBalances[i] * vault.totalSupply());
            uint256 portion = balance * 0.99 ether / vault.totalSupply();
            V2Hop[] memory h = abi.decode(sells[i], (V2Hop[]));
            for (uint256 j; j < h.length; ++j) {
                portion = quote(h[j], portion);
            }
            floors[i] = portion * 9700 / 10000;
        }
        uint256 balanceBefore = newcomer.balance;
        vm.prank(newcomer);
        uint256 returned = vault.withdrawETH(0.99 ether, 0.00099 ether, floors, sells, block.timestamp + 300);
        assertEq(newcomer.balance, balanceBefore + returned);
        assertEq(vault.balanceOf(newcomer), 0);
        assertEq(vault.totalSupply(), 1 ether);
        for (uint256 i; i < 3; ++i) {
            assertGe(IERC20(tokens[i]).balanceOf(address(vault)), oldBalances[i]);
        }
        assertGe(IERC20(W).balanceOf(address(vault)), 0.001 ether);
        emit log_named_uint("Incoming ETH spent", 0.005 ether - refund);
        emit log_named_uint("Incoming ETH exit", returned);
        // Final exit consumes all remaining tokens and cash, with fresh executable floors.
        for (uint256 i; i < 3; ++i) {
            uint256 amount = IERC20(tokens[i]).balanceOf(address(vault));
            V2Hop[] memory h = abi.decode(sells[i], (V2Hop[]));
            for (uint256 j; j < h.length; ++j) {
                amount = quote(h[j], amount);
            }
            floors[i] = amount * 9700 / 10000;
        }
        vault.withdrawETH(1 ether, 0.001 ether, floors, sells, block.timestamp + 300);
        assertEq(vault.totalSupply(), 0);
        assertEq(IERC20(W).balanceOf(address(vault)), 0);
        for (uint256 i; i < 3; ++i) {
            assertEq(IERC20(tokens[i]).balanceOf(address(vault)), 0);
        }
    }
}
