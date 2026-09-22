// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxFreshTwapV3} from "../../contracts/v3/HoodxFreshTwapV3.sol";
import {V2Hop, V2PoolKey} from "../../contracts/v2/Types.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxIndexV3} from "../../contracts/v3/HoodxIndexV3.sol";
import {HoodxClTwapV3} from "../../contracts/v3/HoodxClTwapV3.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

// Candidate validation only. Depth baselines are pinned to pre-maintenance block 68903983,
// not lowered to match today's liquidity. Passing does not replace economic source review.
contract MaturedOracleForkTest is SuccessorWatchlistForkTest {
    function basket(bool net) internal returns (HoodxIndexV3 vault) {
        address qh = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        address ph = address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"));
        HoodxRoutingV3 router = new HoodxRoutingV3(
            address(ex),
            address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")),
            address(new HoodxHookRegistryV3(address(this))),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            qh
        );
        HoodxFeeModelV3 fees = new HoodxFeeModelV3(address(router), qh, ph);
        HoodxPolicyV2 policy = new HoodxPolicyV2(address(this), address(router));
        bytes32[] memory ids = new bytes32[](2);
        for (uint256 i; i < 2; i++) {
            address token = i == 0
                ? address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"))
                : address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
            address pool = i == 0
                ? address(bytes20(hex"f1d6b8ecaf2271233bed626fb1962bc0c39cb1f3"))
                : address(bytes20(hex"f1bef60e5cf6c00e7e1308d3710811dad71f4b6c"));
            HoodxFreshTwapV3 oracle = new HoodxFreshTwapV3(
                address(
                    new HoodxTwapV2(
                        VF, token, W, pool, address(0), 1800, i == 0 ? 347815142061690044664 : 7668210664725484672756, 0
                    )
                ),
                1800
            );
            address selectedOracle = address(oracle);
            if (i == 1 && net) {
                token = address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf"));
                address usd = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
                HoodxFreshTwapV3 bridgeOracle = new HoodxFreshTwapV3(
                    address(
                        new HoodxTwapV2(
                            VF,
                            usd,
                            W,
                            address(bytes20(hex"52e65b17fb6e5ba00ed806f37afcd2daa50271ca")),
                            address(0),
                            1800,
                            2631289198634062971,
                            0
                        )
                    ),
                    1800
                );
                selectedOracle = address(
                    new HoodxClTwapV3(
                        address(bytes20(hex"1ac9db4a2608ba45d6127b1737949b51bb54b7f3")),
                        address(bytes20(hex"99e70a5b06215e5d2f3bec773b4f59c008fc1673")),
                        address(bytes20(hex"11725976bf1f38c4ab78d1f480bc5883d70d9dc3")),
                        token,
                        address(bridgeOracle),
                        1800,
                        1800,
                        2118471187028
                    )
                );
            }
            V2Hop[] memory h = new V2Hop[](1);
            h[0].kind = i == 0 ? 6 : 3;
            h[0].tokenIn = W;
            h[0].tokenOut = token;
            if (i == 0) {
                h[0].fee = 3000;
                h[0].hookData = abi.encode(uint256(300));
            } else {
                h[0].fee = 10000;
            }
            if (i == 1 && net) {
                h[0].kind = 4;
                h[0].fee = 0;
                h[0].tokenIn = address(0);
                h[0].key = V2PoolKey(address(0), token, 8500, 85, address(0));
            }
            bytes memory buy = abi.encode(h);
            (h[0].tokenIn, h[0].tokenOut) = (h[0].tokenOut, h[0].tokenIn);
            ids[i] = policy.approveConfig(token, selectedOracle, buy, abi.encode(h), bytes32(uint256(i + 1)));
        }
        vault = HoodxIndexV3(payable(Clones.clone(address(new HoodxIndexV3(address(policy), address(fees))))));
        uint16[] memory weights = new uint16[](2);
        weights[0] = 2500;
        weights[1] = 2500;
        vault.initialize(
            HoodxIndexV3.Init(
                address(this),
                address(this),
                address(0xCAFE),
                address(0xBEEF),
                "Candidate basket",
                "TEST",
                25,
                25,
                5000,
                0.02 ether,
                ""
            ),
            ids,
            weights
        );
    }

    function join(HoodxIndexV3 vault, address user) internal returns (uint256 shares) {
        vm.deal(user, 1 ether);
        uint256 minimum = vault.previewDeposit(0.02 ether) * 9900 / 10000;
        vm.prank(user);
        shares = vault.deposit{value: 0.02 ether}(minimum, block.timestamp);
        address[] memory ts = vault.constituents();
        for (uint256 i; i < ts.length; i++) {
            assertGt(vault.freeBalance(ts[i]), 0, "A buy must not silently defer");
        }
        assertEq(vault.balanceOf(user), shares);
    }

    function empty(HoodxIndexV3 vault) internal view {
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.freeBalance(W), 0);
        assertEq(address(vault).balance, 0);
        address[] memory ts = vault.constituents();
        for (uint256 i; i < ts.length; i++) {
            assertEq(IERC20(ts[i]).balanceOf(address(vault)), 0);
            assertEq(vault.reserved(ts[i]), 0);
        }
    }

    function testMaturedBasketTwoUsersPartialFinalExit() public {
        lifecycle(false);
    }

    function testMaturedNetBasketTwoUsersPartialFinalExit() public {
        lifecycle(true);
    }

    function lifecycle(bool net) internal {
        HoodxIndexV3 vault = basket(net);
        address alice = address(0xA11CE);
        address bob = address(0xB0B);
        uint256 a = join(vault, alice);
        uint256 b = join(vault, bob);
        assertEq(vault.totalSupply(), a + b);
        uint256 minimum = vault.previewWithdraw(a / 2) * 9700 / 10000;
        vm.prank(alice);
        vault.withdraw(a / 2, minimum, block.timestamp);
        assertEq(vault.balanceOf(bob), b);
        minimum = vault.previewWithdraw(b) * 9700 / 10000;
        vm.prank(bob);
        vault.withdraw(b, minimum, block.timestamp);
        a = vault.balanceOf(alice);
        minimum = vault.previewWithdraw(a) * 9700 / 10000;
        vm.prank(alice);
        vault.withdraw(a, minimum, block.timestamp);
        empty(vault);
    }

    function testMaturedBasketPausedInKindTaxedExit() public {
        inKind(false);
    }

    function testMaturedNetBasketPausedInKindTaxedExit() public {
        inKind(true);
    }

    function inKind(bool net) internal {
        HoodxIndexV3 vault = basket(net);
        address alice = address(0xA11CE);
        uint256 shares = join(vault, alice);
        address[] memory ts = vault.constituents();
        uint256 prism = vault.freeBalance(ts[0]);
        uint256 zeal = vault.freeBalance(ts[1]);
        vault.setPaused(true);
        vm.warp(block.timestamp + 1801); // In-kind exit must survive stale reference prices.
        vm.prank(alice);
        vm.expectRevert(HoodxIndexV3.Paused.selector);
        vault.deposit{value: 0.02 ether}(1e12, block.timestamp);
        vm.prank(alice);
        vault.emergencyRedeemInKind(shares, alice);
        if (net) assertEq(vault.claimable(alice, ts[0]), 0, "PRISM should fit automatic claim gas");
        for (uint256 i; i < ts.length; i++) {
            uint256 pending = vault.claimable(alice, ts[i]);
            if (pending > 0) {
                emit log_named_uint("Deferred gross claim", pending);
                assertEq(vault.reserved(ts[i]), pending);
                assertEq(vault.freeBalance(ts[i]), 0);
                vm.prank(address(0xBAD));
                vm.expectRevert();
                vault.claim(ts[i], address(0xBAD));
                vm.prank(alice);
                vault.claim(ts[i], alice);
            }
        }
        assertGe(IERC20(ts[0]).balanceOf(alice), prism * 9700 / 10000);
        assertLe(IERC20(ts[0]).balanceOf(alice), prism);
        assertEq(IERC20(ts[1]).balanceOf(alice), zeal);
        assertEq(vault.claimable(alice, ts[0]), 0);
        assertEq(vault.claimable(alice, ts[1]), 0);
        empty(vault);
    }

    function check(bool prism, uint256 amount) internal {
        checkRoute(prism, amount, false);
    }

    function checkRoute(bool prism, uint256 amount, bool v3) internal {
        address token = prism
            ? address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"))
            : address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
        address pool = prism
            ? address(bytes20(hex"f1d6b8ecaf2271233bed626fb1962bc0c39cb1f3"))
            : address(bytes20(hex"f1bef60e5cf6c00e7e1308d3710811dad71f4b6c"));
        uint128 depth = prism ? 347815142061690044664 : 7668210664725484672756;
        HoodxTwapV2 base = new HoodxTwapV2(VF, token, W, pool, address(0), 1800, depth, 0);
        HoodxFreshTwapV3 oracle = new HoodxFreshTwapV3(address(base), 1800);
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        address qh = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        address ph = address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"));
        HoodxRoutingV3 router = new HoodxRoutingV3(
            address(ex),
            address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")),
            address(registry),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            qh
        );
        HoodxFeeModelV3 fees = new HoodxFeeModelV3(address(router), qh, ph);
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = prism ? 6 : 4;
        h[0].tokenIn = prism ? W : address(0);
        h[0].tokenOut = token;
        if (prism) {
            h[0].fee = 3000;
            h[0].hookData = abi.encode(uint256(300));
        } else {
            h[0].key = V2PoolKey(address(0), token, 0, 200, ph);
        }
        if (v3) {
            h[0].kind = 3;
            h[0].tokenIn = W;
            h[0].fee = 10000;
            h[0].key = V2PoolKey(address(0), address(0), 0, 0, address(0));
        }
        uint256 fair = amount * 1e18 / oracle.value(token, 1e18);
        uint256 minimum = fair * fees.factor(abi.encode(h)) / 1e18 * 9700 / 10000;
        emit log_named_uint("Independent protected buy minimum", minimum);
        IERC20(W).approve(address(router), amount);
        uint256 snap = vm.snapshotState();
        uint256 executable = router.execute(W, token, amount, 1, abi.encode(h), block.timestamp);
        emit log_named_uint("Actual net buy diagnostic", executable);
        assertTrue(vm.revertToState(snap));
        uint256 got = router.execute(W, token, amount, minimum, abi.encode(h), block.timestamp);
        (h[0].tokenIn, h[0].tokenOut) = (h[0].tokenOut, h[0].tokenIn);
        minimum = oracle.value(token, got) * fees.factor(abi.encode(h)) / 1e18 * 9700 / 10000;
        emit log_named_uint("Independent protected sell minimum", minimum);
        IERC20(token).approve(address(router), got);
        uint256 back = router.execute(token, W, got, minimum, abi.encode(h), block.timestamp);
        emit log_named_uint("ETH returned", back);
        assertEq(IERC20(token).balanceOf(address(this)), 0);
        assertEq(IERC20(token).balanceOf(address(router)), 0);
        assertEq(IERC20(W).balanceOf(address(router)), 0);
    }

    function testMaturedZealV3Small() public {
        checkRoute(false, 0.0001 ether, true);
    }

    function testMaturedZealV3Medium() public {
        checkRoute(false, 0.001 ether, true);
    }

    function testMaturedZealV3Large() public {
        checkRoute(false, 0.005 ether, true);
    }

    function testMaturedPrismSmall() public {
        check(true, 0.0001 ether);
    }

    function testMaturedPrismMedium() public {
        check(true, 0.001 ether);
    }

    function testMaturedPrismLarge() public {
        check(true, 0.005 ether);
    }

    function testMaturedZealSmall() public {
        check(false, 0.0001 ether);
    }

    function testMaturedZealMedium() public {
        check(false, 0.001 ether);
    }

    function testMaturedZealLarge() public {
        check(false, 0.005 ether);
    }
}
