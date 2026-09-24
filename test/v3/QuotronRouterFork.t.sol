// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";

interface IQuotronRouterProbe {
    function quotron() external view returns (address);
    function buyExactEth(uint256 minimum, address recipient, uint256 deadline) external payable returns (uint256);
    function sellExactQuotronForEth(uint256 amount, uint256 minimum, address recipient, uint256 deadline)
        external
        returns (uint256);
}

interface IQuotronFeeProbe {
    function currentFeeBps(address account) external view returns (uint256);
    function isTransferRestricted(address account) external view returns (bool);
}

/// Diagnostic only. Snapshot-derived quotes do not establish independent NAV or release readiness.
contract QuotronRouterForkTest is SuccessorWatchlistForkTest {
    receive() external payable {}

    function integrated(bool independent) internal {
        address qr = address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18"));
        address qh = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        address token = IQuotronRouterProbe(qr).quotron();
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        uint256 now_ = vm.getBlockTimestamp();
        vm.warp(now_ - 2 days);
        registry.propose(qh, bytes32(uint256(1)));
        vm.warp(now_);
        registry.activate(qh);
        HoodxRoutingV3 routing = new HoodxRoutingV3(address(ex), qr, address(registry), token, qh);
        V2Hop[] memory hops = new V2Hop[](1);
        hops[0].kind = 5;
        hops[0].tokenIn = W;
        hops[0].tokenOut = token;
        IERC20(W).approve(address(routing), 0.001 ether);
        uint256 quoted;
        HoodxTwapV2 oracle;
        if (independent) {
            // Candidate only; retain substantial historical depth, not a one-unit placeholder.
            oracle = new HoodxTwapV2(
                VF,
                token,
                W,
                address(bytes20(hex"df63749e93d443ed548186a351ae6b37d8914ac3")),
                address(0),
                1800,
                163579489062792213,
                0
            );
            quoted = 0.001 ether * 1e18 / oracle.value(token, 1e18);
            HoodxFeeModelV3 model = new HoodxFeeModelV3(address(routing), qh, address(0));
            quoted = quoted * model.factor(abi.encode(hops)) / 1e18;
        } else {
            uint256 snapshot = vm.snapshotState();
            quoted = routing.execute(W, token, 0.001 ether, 1, abi.encode(hops), block.timestamp + 300);
            assertTrue(vm.revertToState(snapshot));
        }
        emit log_named_uint("Protected buy minimum", quoted * 9700 / 10000);
        uint256 bought =
            routing.execute(W, token, 0.001 ether, quoted * 9700 / 10000, abi.encode(hops), block.timestamp + 300);
        hops[0].tokenIn = token;
        hops[0].tokenOut = W;
        IERC20(token).approve(address(routing), bought);
        if (independent) {
            HoodxFeeModelV3 model = new HoodxFeeModelV3(address(routing), qh, address(0));
            quoted = oracle.value(token, bought) * model.factor(abi.encode(hops)) / 1e18;
        } else {
            uint256 snapshot = vm.snapshotState();
            quoted = routing.execute(token, W, bought, 1, abi.encode(hops), block.timestamp + 300);
            assertTrue(vm.revertToState(snapshot));
        }
        emit log_named_uint("Protected sell minimum", quoted * 9700 / 10000);
        uint256 returned =
            routing.execute(token, W, bought, quoted * 9700 / 10000, abi.encode(hops), block.timestamp + 300);
        emit log_named_uint("Integrated ETH returned wei", returned);
        assertEq(IERC20(token).balanceOf(address(this)), 0);
        assertEq(IERC20(token).balanceOf(address(routing)), 0);
        assertEq(IERC20(W).balanceOf(address(routing)), 0);
        assertEq(address(routing).balance, 0);
        assertEq(IERC20(token).allowance(address(routing), qr), 0);
    }

    function testIntegratedQuoteRoundTrip() public {
        integrated(false);
    }

    function testIndependentOracleRoundTrip() public {
        integrated(true);
    }

    function testCanonicalTaxedPrism() public {
        address qr = address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18"));
        address qh = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        address prism = address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"));
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        HoodxRoutingV3 routing =
            new HoodxRoutingV3(address(ex), qr, address(registry), IQuotronRouterProbe(qr).quotron(), qh);
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 6;
        h[0].fee = 3000;
        h[0].hookData = abi.encode(uint256(300));
        h[0].tokenIn = W;
        h[0].tokenOut = prism;
        IERC20(W).approve(address(routing), 0.001 ether);
        uint256 snapshot = vm.snapshotState();
        uint256 quoted = routing.execute(W, prism, 0.001 ether, 1, abi.encode(h), block.timestamp);
        assertTrue(vm.revertToState(snapshot));
        uint256 got = routing.execute(W, prism, 0.001 ether, quoted * 9700 / 10000, abi.encode(h), block.timestamp);
        emit log_named_uint("PRISM net received", got);
        h[0].tokenIn = prism;
        h[0].tokenOut = W;
        IERC20(prism).approve(address(routing), got);
        snapshot = vm.snapshotState();
        quoted = routing.execute(prism, W, got, 1, abi.encode(h), block.timestamp);
        assertTrue(vm.revertToState(snapshot));
        uint256 returned = routing.execute(prism, W, got, quoted * 9700 / 10000, abi.encode(h), block.timestamp);
        emit log_named_uint("PRISM ETH returned wei", returned);
        assertEq(IERC20(prism).balanceOf(address(this)), 0);
        assertEq(IERC20(prism).balanceOf(address(routing)), 0);
        assertEq(IERC20(W).balanceOf(address(routing)), 0);
    }

    function testCanonicalRouterRoundTrip() public {
        IQuotronRouterProbe router =
            IQuotronRouterProbe(address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")));
        IQuotronFeeProbe hook = IQuotronFeeProbe(address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc")));
        IERC20 token = IERC20(router.quotron());
        vm.deal(address(this), 1 ether);
        emit log_named_uint("Current hook fee bps", hook.currentFeeBps(address(this)));
        uint256 snapshot = vm.snapshotState();
        // Discovery happens only in a reverted fork snapshot, never a live transaction.
        uint256 quoted = router.buyExactEth{value: 0.001 ether}(1, address(this), block.timestamp + 300);
        assertTrue(vm.revertToState(snapshot));
        uint256 bought =
            router.buyExactEth{value: 0.001 ether}(quoted * 9700 / 10000, address(this), block.timestamp + 300);
        assertEq(token.balanceOf(address(this)), bought);
        assertFalse(hook.isTransferRestricted(address(this)), "buyer transfer locked");
        // Executor-to-vault and vault-to-executor transfers must both work.
        address vault = makeAddr("probeVault");
        assertTrue(token.transfer(vault, bought));
        vm.prank(vault);
        assertTrue(token.transfer(address(this), bought));
        assertTrue(token.approve(address(router), bought));
        snapshot = vm.snapshotState();
        quoted = router.sellExactQuotronForEth(bought, 1, address(this), block.timestamp + 300);
        assertTrue(vm.revertToState(snapshot));
        uint256 returned =
            router.sellExactQuotronForEth(bought, quoted * 9700 / 10000, address(this), block.timestamp + 300);
        emit log_named_uint("ETH returned wei", returned);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(vault), 0);
        assertEq(token.allowance(address(this), address(router)), 0);
    }
}
