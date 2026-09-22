// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {HoodxProportionalPolicyV3} from "../../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {V2Hop, V2PoolKey} from "../../contracts/v2/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// Full watchlist execution/accounting integration. Fork only, no live approval.
contract ProportionalBasketForkTest is SuccessorWatchlistForkTest {
    receive() external payable {}

    function routeFor(uint256 i) internal view returns (address token, bytes memory buy, bytes memory sell) {
        V2Hop memory h;
        if (i == 0) {
            h.tokenOut = address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571"));
            h.kind = 3;
            h.tokenIn = W;
            h.fee = 3000;
        }
        if (i == 1) {
            h.tokenOut = address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
            h.key = V2PoolKey(
                address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),
                address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
                10000,
                200,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 2) {
            h.tokenOut = address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
            h.key = V2PoolKey(
                address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),
                address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
                2690,
                54,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 3) {
            h.tokenOut = address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870"));
            h.kind = 3;
            h.tokenIn = W;
            h.fee = 10000;
        }
        if (i == 4) {
            h.tokenOut = address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
            h.key = V2PoolKey(
                address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),
                address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
                2969,
                30,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 5) {
            h.tokenOut = address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),
                10000,
                200,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 6) {
            h.tokenOut = address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777")),
                15000,
                150,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 7) {
            h.tokenOut = address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),
                2500,
                25,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 8) {
            h.tokenOut = address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
            h.key = V2PoolKey(
                address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
                address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),
                19900,
                199,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 9) {
            h.tokenOut = address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
            h.key = V2PoolKey(
                address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
                address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),
                9000,
                90,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 10) {
            h.tokenOut = address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c"));
            h.key = V2PoolKey(
                address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c")),
                address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),
                0,
                200,
                address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
            );
        }
        if (i == 11) {
            h.tokenOut = address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1"));
            h.kind = 3;
            h.tokenIn = W;
            h.fee = 10000;
        }
        if (i == 12) {
            h.tokenOut = address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f"));
            h.kind = 5;
            h.tokenIn = W;
        }
        if (i == 13) {
            h.tokenOut = address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf")),
                8500,
                85,
                address(bytes20(hex"0000000000000000000000000000000000000000"))
            );
        }
        if (i == 14) {
            h.tokenOut = address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc")),
                0,
                200,
                address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
            );
        }
        if (i == 15) {
            h.tokenOut = address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506"));
            h.kind = 3;
            h.tokenIn = W;
            h.fee = 10000;
        }
        if (i == 16) {
            h.tokenOut = address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55")),
                0,
                200,
                address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
            );
        }
        if (i == 17) {
            h.tokenOut = address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5")),
                0,
                200,
                address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
            );
        }
        if (i == 18) {
            h.tokenOut = address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f"));
            h.kind = 3;
            h.tokenIn = W;
            h.fee = 100;
        }
        if (i == 19) {
            h.tokenOut = address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea"));
            h.key = V2PoolKey(
                address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261")),
                address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea")),
                0,
                200,
                address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
            );
        }
        token = h.tokenOut;
        bool multi = h.tokenIn != W && h.tokenIn != address(0);
        V2Hop[] memory b = new V2Hop[](multi ? 2 : 1);
        b[b.length - 1] = h;
        if (multi) b[0] = bridge(h.tokenIn);
        buy = abi.encode(b);
        V2Hop[] memory r = new V2Hop[](b.length);
        for (uint256 j; j < b.length; ++j) {
            r[j] = b[b.length - 1 - j];
            (r[j].tokenIn, r[j].tokenOut) = (r[j].tokenOut, r[j].tokenIn);
        }
        sell = abi.encode(r);
    }

    function exactSimulation(HoodxRoutingV3 router, address input, address output, uint256 amount, bytes memory route)
        internal
        returns (uint256 got)
    {
        uint256 snapshot = vm.snapshotState();
        IERC20(input).approve(address(router), amount);
        got = router.execute(input, output, amount, 1, route, block.timestamp + 300);
        assertTrue(vm.revertToState(snapshot));
    }

    function vaultFloors(
        HoodxRoutingV3 router,
        HoodxProportionalV3 vault,
        address[] memory tokens,
        bytes[] memory sells,
        uint256 shares
    ) internal returns (uint256[] memory floors) {
        floors = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            uint256 snapshot = vm.snapshotState();
            uint256 amount = vault.freeBalance(tokens[i]) * shares / vault.totalSupply();
            if (amount != 0) {
                vm.prank(address(vault));
                IERC20(tokens[i]).approve(address(router), amount);
                vm.prank(address(vault));
                uint256 got = router.execute(tokens[i], W, amount, 1, sells[i], block.timestamp + 300);
                floors[i] = got * 9700 / 10000;
                assertGt(floors[i], 0);
            }
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testProportionalFullWatchlistLifecycle() public {
        address qh = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        uint256 now_ = vm.getBlockTimestamp();
        vm.warp(now_ - 2 days);
        registry.propose(qh, bytes32(uint256(1)));
        vm.warp(now_);
        registry.activate(qh);
        HoodxRoutingV3 router = new HoodxRoutingV3(
            address(ex),
            address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")),
            address(registry),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            qh
        );
        HoodxProportionalPolicyV3 policy = new HoodxProportionalPolicyV3(address(this), address(router));
        HoodxFeeModelV3 fees =
            new HoodxFeeModelV3(address(router), qh, address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044")));
        bytes32[] memory ids = new bytes32[](20);
        uint16[] memory weights = new uint16[](20);
        uint256[] memory floors = new uint256[](20);
        bytes[] memory sells = new bytes[](20);
        address[] memory tokens = new address[](20);
        uint256 net = 0.08 ether * 9950 / 10000;
        uint256 seedBudget = net * 375 / 10000;
        for (uint256 i; i < 20; ++i) {
            bytes memory buy;
            (tokens[i], buy, sells[i]) = routeFor(i);
            ids[i] = policy.approveRoute(tokens[i], buy, sells[i], bytes32(i + 1));
            weights[i] = 375;
            floors[i] = exactSimulation(router, W, tokens[i], seedBudget, buy) * 9700 / 10000;
            assertGt(floors[i], 0);
        }
        HoodxProportionalV3 impl = new HoodxProportionalV3(address(policy), address(fees));
        HoodxProportionalV3 vault = HoodxProportionalV3(payable(Clones.clone(address(impl))));
        vault.initialize(
            HoodxProportionalV3.Init(
                address(this),
                address(this),
                address(0x888),
                address(0x777),
                "Watchlist",
                "LIST",
                40,
                10,
                2500,
                0.02 ether,
                ""
            ),
            ids,
            weights
        );
        vm.deal(address(this), 1 ether);
        vault.bootstrap{value: 0.08 ether}(floors, vault.planNonce(), block.timestamp + 300);
        uint256 initialShares = vault.totalSupply();
        uint256[] memory initial = new uint256[](20);
        for (uint256 i; i < 20; ++i) {
            initial[i] = vault.freeBalance(tokens[i]);
            assertGt(initial[i], 0);
        }
        uint256 cashBefore = vault.freeBalance(W);
        uint256 shares = initialShares / 2;
        (, uint256[] memory needed) = vault.requiredContributions(shares);
        uint256[] memory budgets = new uint256[](20);
        for (uint256 i; i < 20; ++i) {
            budgets[i] = seedBudget * 105 / 200;
        }
        address newcomer = address(0xBEEF);
        vm.deal(newcomer, 1 ether);
        uint256 nonce = vault.planNonce();
        vm.prank(newcomer);
        vault.depositExactShares{value: 0.05 ether}(shares, budgets, needed, nonce, block.timestamp + 300);
        for (uint256 i; i < 20; ++i) {
            assertGe(vault.freeBalance(tokens[i]) * initialShares, initial[i] * vault.totalSupply());
        }
        assertGe(vault.freeBalance(W) * initialShares, cashBefore * vault.totalSupply());
        // Partial ETH redemption first, then the rest in kind while paused.
        uint256 partialShares = shares / 2;
        floors = vaultFloors(router, vault, tokens, sells, partialShares);
        uint256 minimumEth = vault.freeBalance(W) * partialShares / vault.totalSupply();
        for (uint256 i; i < floors.length; ++i) minimumEth += floors[i];
        nonce = vault.planNonce();
        vm.prank(newcomer);
        vault.withdraw(partialShares, minimumEth, floors, nonce, block.timestamp + 300);
        vault.setPaused(true);
        vm.prank(newcomer);
        vault.emergencyRedeemInKind(shares - partialShares, newcomer);
        for (uint256 i; i < 20; ++i) {
            assertGe(vault.freeBalance(tokens[i]), initial[i]);
            assertEq(vault.claimable(newcomer, tokens[i]), 0);
        }
        floors = vaultFloors(router, vault, tokens, sells, initialShares);
        minimumEth = vault.freeBalance(W);
        for (uint256 i; i < floors.length; ++i) minimumEth += floors[i];
        vault.withdraw(initialShares, minimumEth, floors, vault.planNonce(), block.timestamp + 300);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.freeBalance(W), 0);
        for (uint256 i; i < 20; ++i) {
            assertEq(vault.freeBalance(tokens[i]), 0);
            assertEq(IERC20(tokens[i]).balanceOf(address(router)), 0);
        }
    }
}
