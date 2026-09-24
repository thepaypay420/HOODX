// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {TestTokenV2, TestWethV2, TestExecutorV2} from "../v2/VaultV2.t.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";

contract QuotronHookFixture {
    address public canonicalRouter;
    bool public locked;

    function configure(address r) external {
        canonicalRouter = r;
    }

    function setLocked(bool value) external {
        locked = value;
    }

    function isTransferRestricted(address) external view returns (bool) {
        return locked;
    }
}

contract QuotronRouterFixture {
    address public weth;
    TestTokenV2 public quotron;
    QuotronHookFixture public hook;
    uint256 public mode;

    constructor(address w, TestTokenV2 t, QuotronHookFixture h) {
        weth = w;
        quotron = t;
        hook = h;
    }

    function setMode(uint256 value) external {
        mode = value;
    }

    function buyExactEth(uint256 minimum, address recipient, uint256) external payable returns (uint256 out) {
        out = msg.value * 9700 / 10000;
        // Mode 1 models a router that lies about satisfying the minimum.
        if (mode != 1) require(out >= minimum, "minimum");
        quotron.mint(recipient, out);
        if (mode == 2) hook.setLocked(true);
        if (mode == 3) {
            (bool ok,) = msg.sender.call{value: 1}("");
            require(ok);
        }
    }

    function sellExactQuotronForEth(uint256 amount, uint256 minimum, address recipient, uint256)
        external
        returns (uint256 out)
    {
        quotron.transferFrom(msg.sender, address(this), amount);
        out = amount * 9700 / 10000;
        require(out >= minimum, "minimum");
        (bool ok,) = recipient.call{value: out}("");
        require(ok);
    }
    receive() external payable {}
}

contract RoutingV3Test is Test {
    TestWethV2 w;
    TestTokenV2 t;
    TestExecutorV2 base;
    QuotronHookFixture hook;
    QuotronRouterFixture router;
    HoodxHookRegistryV3 registry;
    HoodxRoutingV3 routing;

    function setUp() public {
        w = new TestWethV2();
        t = new TestTokenV2("Q");
        base = new TestExecutorV2(address(w));
        hook = new QuotronHookFixture();
        router = new QuotronRouterFixture(address(w), t, hook);
        hook.configure(address(router));
        registry = new HoodxHookRegistryV3(address(this));
        registry.propose(address(hook), bytes32(uint256(1)));
        vm.warp(vm.getBlockTimestamp() + 2 days);
        registry.activate(address(hook));
        routing = new HoodxRoutingV3(address(base), address(router), address(registry), address(t), address(hook));
        vm.deal(address(this), 100 ether);
        w.deposit{value: 10 ether}();
        vm.deal(address(router), 100 ether);
        w.approve(address(routing), type(uint256).max);
        t.approve(address(routing), type(uint256).max);
    }

    function route(bool buying) internal view returns (bytes memory) {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 5;
        h[0].tokenIn = buying ? address(w) : address(t);
        h[0].tokenOut = buying ? address(t) : address(w);
        return abi.encode(h);
    }

    function buy(uint256 minimum) internal returns (uint256) {
        return routing.execute(address(w), address(t), 1 ether, minimum, route(true), block.timestamp);
    }

    function testRoundTripAndApprovalReset() public {
        uint256 out = buy(0.97 ether);
        uint256 back = routing.execute(address(t), address(w), out, 0.9409 ether, route(false), block.timestamp);
        assertEq(back, 0.9409 ether);
        assertEq(t.balanceOf(address(this)), 0);
        assertEq(t.allowance(address(routing), address(router)), 0);
        assertEq(address(routing).balance, 0);
        assertEq(w.balanceOf(address(routing)), 0);
        assertEq(t.balanceOf(address(routing)), 0);
    }

    function testRejectsRouterMinimumLie() public {
        router.setMode(1);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        buy(1 ether);
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testRejectsNewTransferLockAtomically() public {
        router.setMode(2);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        buy(0.97 ether);
        assertFalse(hook.locked());
        assertEq(t.balanceOf(address(this)), 0);
    }

    function testRejectsUnexpectedRefundAtomically() public {
        router.setMode(3);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        buy(0.97 ether);
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testRevocationStopsSpecialRoute() public {
        registry.revoke(address(hook));
        vm.expectRevert(HoodxRoutingV3.InvalidRoute.selector);
        buy(0.97 ether);
    }

    function testCodeChangeStopsSpecialRoute() public {
        vm.etch(address(router), hex"00");
        vm.expectRevert(HoodxRoutingV3.InvalidRoute.selector);
        buy(0.97 ether);
    }

    function testRejectsWrongTokenIdentity() public {
        TestTokenV2 other = new TestTokenV2("other");
        vm.expectRevert(HoodxRoutingV3.InvalidRoute.selector);
        new HoodxRoutingV3(address(base), address(router), address(registry), address(other), address(hook));
    }

    function testPreservesPreexistingBalances() public {
        w.transfer(address(routing), 17);
        t.mint(address(routing), 23);
        vm.deal(address(routing), 29);
        buy(0.97 ether);
        assertEq(w.balanceOf(address(routing)), 17);
        assertEq(t.balanceOf(address(routing)), 23);
        assertEq(address(routing).balance, 29);
    }

    function testFuzzMinimumNeverBypassed(uint96 requested) public {
        uint256 minimum = bound(uint256(requested), 1, 2 ether);
        router.setMode(1);
        if (minimum > 0.97 ether) vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        uint256 result = buy(minimum);
        if (minimum <= 0.97 ether) assertGe(result, minimum);
    }

    function testCanonicalPoolForwardingAndApprovalReset() public {
        V2Hop[] memory h = abi.decode(route(true), (V2Hop[]));
        h[0].kind = 3;
        h[0].fee = 3000;
        uint256 out = routing.execute(address(w), address(t), 1 ether, 1 ether, abi.encode(h), block.timestamp);
        assertEq(out, 1 ether);
        assertEq(w.allowance(address(routing), address(base)), 0);
        assertEq(w.balanceOf(address(routing)), 0);
        assertEq(t.balanceOf(address(routing)), 0);
    }

    function testRejectsLyingBaseExecutor() public {
        V2Hop[] memory h = abi.decode(route(true), (V2Hop[]));
        h[0].kind = 3;
        base.setLie(true);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        routing.execute(address(w), address(t), 1 ether, 1 ether, abi.encode(h), block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
        assertEq(w.allowance(address(routing), address(base)), 0);
    }

    function testHopMinimumCannotBeIgnored() public {
        V2Hop[] memory h = abi.decode(route(true), (V2Hop[]));
        h[0].minHopPriceX36 = 1e36;
        router.setMode(1);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        routing.execute(address(w), address(t), 1 ether, 1, abi.encode(h), block.timestamp);
    }

    function testRejectsCallerSuppliedHookPayload() public {
        V2Hop[] memory h = abi.decode(route(true), (V2Hop[]));
        h[0].hookData = hex"1234";
        vm.expectRevert(HoodxRoutingV3.InvalidRoute.selector);
        routing.execute(address(w), address(t), 1 ether, 1, abi.encode(h), block.timestamp);
    }
}
