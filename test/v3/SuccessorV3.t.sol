// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestTokenV2, TestWethV2} from "../v2/VaultV2.t.sol";
import {PermitMockV2, RouterMockV2, FactoryMockV2, StateMockV2} from "../v2/ExecutorV2.t.sol";
import {HoodxExecutorV3} from "../../contracts/v3/HoodxExecutorV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxIndexV3} from "../../contracts/v3/HoodxIndexV3.sol";
import {HoodxFactoryV3} from "../../contracts/v3/HoodxFactoryV3.sol";
import {TestOracleV2} from "../v2/VaultV2.t.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";

contract PairFixtureV3 {
    address public factory;
    address public token0;
    address public token1;
    uint112 r0;
    uint112 r1;
    bool public shortOutput;

    constructor(address a, address b) {
        factory = msg.sender;
        token0 = a;
        token1 = b;
    }

    function setShort(bool value) external {
        shortOutput = value;
    }

    function sync() public {
        r0 = uint112(IERC20(token0).balanceOf(address(this)));
        r1 = uint112(IERC20(token1).balanceOf(address(this)));
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (r0, r1, uint32(block.timestamp));
    }

    function swap(uint256 a, uint256 b, address to, bytes calldata) external {
        if (a > 0) IERC20(token0).transfer(to, shortOutput ? a - 1 : a);
        if (b > 0) IERC20(token1).transfer(to, shortOutput ? b - 1 : b);
        sync();
    }
}

contract PairFactoryFixtureV3 {
    PairFixtureV3 public pair;

    constructor(address a, address b) {
        pair = new PairFixtureV3(a, b);
    }

    function getPair(address, address) external view returns (address) {
        return address(pair);
    }
}

contract SuccessorV3Test is Test {
    TestWethV2 w;
    TestTokenV2 t;
    HoodxExecutorV3 ex;
    HoodxHookRegistryV3 registry;
    PairFixtureV3 pair;
    PermitMockV2 permit;
    RouterMockV2 router;

    function setUp() public {
        w = new TestWethV2();
        t = new TestTokenV2("T");
        registry = new HoodxHookRegistryV3(address(this));
        permit = new PermitMockV2();
        router = new RouterMockV2(address(permit));
        PairFactoryFixtureV3 f = new PairFactoryFixtureV3(address(w), address(t));
        pair = f.pair();
        ex = new HoodxExecutorV3(
            address(w),
            address(router),
            address(permit),
            address(new FactoryMockV2()),
            address(new StateMockV2()),
            address(f),
            address(registry)
        );
        w.mint(address(pair), 1000 ether);
        t.mint(address(pair), 1000 ether);
        pair.sync();
        w.mint(address(this), 10 ether);
        w.approve(address(ex), type(uint256).max);
    }

    function route(uint8 kind) internal view returns (bytes memory) {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = kind;
        h[0].tokenIn = address(w);
        h[0].tokenOut = address(t);
        h[0].fee = 3000;
        return abi.encode(h);
    }

    function testV2ExactSettlement() public {
        uint256 out = ex.execute(address(w), address(t), 1 ether, 0.99 ether, route(2), block.timestamp);
        assertEq(t.balanceOf(address(this)), out);
        assertEq(w.balanceOf(address(ex)), 0);
        assertEq(t.balanceOf(address(ex)), 0);
        assertEq(w.allowance(address(ex), address(permit)), 0);
    }

    function testV3SettlementStillWorks() public {
        ex.execute(address(w), address(t), 1 ether, 0.99 ether, route(3), block.timestamp);
        assertEq(t.balanceOf(address(this)), 1 ether);
    }

    function testMinimumRollsBackPairAndWallet() public {
        vm.expectRevert();
        ex.execute(address(w), address(t), 1 ether, 2 ether, route(2), block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
        assertEq(w.balanceOf(address(pair)), 1000 ether);
    }

    function testPairDonationCannotBeSpent() public {
        w.mint(address(pair), 1);
        vm.expectRevert();
        ex.execute(address(w), address(t), 1 ether, 0.99 ether, route(2), block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testShortPairOutputReverts() public {
        pair.setShort(true);
        vm.expectRevert();
        ex.execute(address(w), address(t), 1 ether, 0.99 ether, route(2), block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testInputTransferFailureRollsBack() public {
        w.setBlocked(true);
        vm.expectRevert();
        ex.execute(address(w), address(t), 1 ether, 0.99 ether, route(2), block.timestamp);
        assertEq(t.balanceOf(address(this)), 0);
    }

    function testHookDelayAndCodePin() public {
        registry.propose(address(t), bytes32(uint256(1)));
        vm.expectRevert();
        registry.activate(address(t));
        vm.warp(block.timestamp + 2 days);
        registry.activate(address(t));
        assertTrue(registry.isApprovedHook(address(t)));
        vm.etch(address(t), hex"60006000f3");
        assertFalse(registry.isApprovedHook(address(t)));
    }

    function testRevocationCancelsPendingApproval() public {
        registry.propose(address(t), bytes32(uint256(1)));
        registry.revoke(address(t));
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert();
        registry.activate(address(t));
    }

    function testOnlyOwnerCanPropose() public {
        vm.prank(address(0x123));
        vm.expectRevert();
        registry.propose(address(t), bytes32(uint256(1)));
    }

    function testCodeChangeBeforeActivationFails() public {
        registry.propose(address(t), bytes32(uint256(1)));
        vm.warp(block.timestamp + 2 days);
        vm.etch(address(t), hex"60006000f3");
        vm.expectRevert();
        registry.activate(address(t));
    }

    function testFuzzV2DeltaConservation(uint96 raw) public {
        uint256 amount = bound(raw, 1e12, 5 ether);
        uint256 expected = amount * 997 * 1000 ether / (1000 ether * 1000 + amount * 997);
        uint256 out = ex.execute(address(w), address(t), amount, expected, route(2), block.timestamp);
        assertEq(out, expected);
        assertEq(w.balanceOf(address(this)), 10 ether - amount);
        assertEq(w.balanceOf(address(ex)), 0);
        assertEq(t.balanceOf(address(ex)), 0);
    }

    receive() external payable {}

    function makeVault() internal returns (HoodxIndexV3 vault) {
        HoodxPolicyV2 policy = new HoodxPolicyV2(address(this), address(ex));
        TestOracleV2 oracle = new TestOracleV2();
        TestTokenV2 u = new TestTokenV2("U");
        bytes32[] memory ids = new bytes32[](2);
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 2;
        h[0].fee = 3000;
        h[0].tokenIn = address(w);
        h[0].tokenOut = address(t);
        bytes memory buy = abi.encode(h);
        h[0].tokenIn = address(t);
        h[0].tokenOut = address(w);
        ids[0] = policy.approveConfig(address(t), address(oracle), buy, abi.encode(h), bytes32(uint256(1)));
        h[0].kind = 3;
        h[0].tokenIn = address(w);
        h[0].tokenOut = address(u);
        buy = abi.encode(h);
        h[0].tokenIn = address(u);
        h[0].tokenOut = address(w);
        ids[1] = policy.approveConfig(address(u), address(oracle), buy, abi.encode(h), bytes32(uint256(2)));
        HoodxIndexV3 impl = new HoodxIndexV3(address(policy), address(0));
        HoodxFactoryV3 factory = new HoodxFactoryV3(address(this), address(0xbeef), address(impl));
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        HoodxIndexV2.Init memory params = HoodxIndexV2.Init(
            address(this),
            address(this),
            address(this),
            address(0xbeef),
            "Successor",
            "NEXT",
            0,
            10,
            2500,
            0.02 ether,
            ""
        );
        vault = HoodxIndexV3(payable(factory.create("successor", params, ids, weights)));
        assertEq(vault.version(), 3);
        vm.deal(address(this), 1 ether);
        vm.deal(address(w), 1000 ether);
    }

    function testMixedPoolVaultPartialAndFinalExit() public {
        HoodxIndexV3 v = makeVault();
        uint256 shares = v.deposit{value: 0.08 ether}(v.previewDeposit(0.08 ether) * 99 / 100, block.timestamp);
        assertGt(t.balanceOf(address(v)), 0);
        uint256 portion = shares / 2;
        uint256 min = v.totalAssets() * portion / v.totalSupply() * 97 / 100;
        v.withdraw(portion, min, block.timestamp);
        uint256 rest = v.balanceOf(address(this));
        min = v.totalAssets() * rest / v.totalSupply() * 97 / 100;
        v.withdraw(rest, min, block.timestamp);
        assertEq(v.totalSupply(), 0);
        assertEq(t.balanceOf(address(v)), 0);
        assertEq(w.balanceOf(address(v)), 0);
    }

    function testSuccessorPausedInKindExit() public {
        HoodxIndexV3 v = makeVault();
        v.deposit{value: 0.08 ether}(v.previewDeposit(0.08 ether) * 99 / 100, block.timestamp);
        v.setPaused(true);
        v.emergencyRedeemInKind(v.balanceOf(address(this)), address(this));
        assertEq(v.totalSupply(), 0);
        assertEq(t.balanceOf(address(v)), 0);
        assertEq(w.balanceOf(address(v)), 0);
        assertGt(t.balanceOf(address(this)), 0);
    }
}
