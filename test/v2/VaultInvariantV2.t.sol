// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {VaultV2Test, TestTokenV2, TestWethV2, TestExecutorV2, TestOracleV2, TestPolicyV2} from "./VaultV2.t.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract VaultHandlerV2 is Test {
    HoodxIndexV2 public vault;
    TestWethV2 public w;
    TestTokenV2 public a;
    TestTokenV2 public b;
    TestExecutorV2 public ex;
    uint256 public deposits;
    uint256 public donations;
    uint256 public ethPaid;
    address public constant ALICE = address(0xa11ce);
    address public constant BOB = address(0xb0b);
    address public constant TREASURY = address(0xc2);

    constructor() {
        w = new TestWethV2();
        a = new TestTokenV2("A");
        b = new TestTokenV2("B");
        ex = new TestExecutorV2(address(w));
        TestPolicyV2 p = new TestPolicyV2(address(ex), address(new TestOracleV2()));
        HoodxIndexV2 impl = new HoodxIndexV2(address(p));
        vault = HoodxIndexV2(payable(Clones.clone(address(impl))));
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = p.add(address(a));
        ids[1] = p.add(address(b));
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        vault.initialize(
            HoodxIndexV2.Init(
                address(this), address(this), TREASURY, TREASURY, "Invariant", "INV", 0, 10, 2500, 0.02 ether, ""
            ),
            ids,
            weights
        );
        vm.deal(ALICE, 1_000_000 ether);
        vm.deal(BOB, 1_000_000 ether);
        vm.deal(address(w), 1_000_000 ether);
    }

    function user(uint256 seed) internal pure returns (address) {
        return seed % 2 == 0 ? ALICE : BOB;
    }

    function deposit(uint96 raw, uint256 seed) external {
        if (vault.paused()) return;
        uint256 amount = bound(raw, 0.02 ether, 1 ether);
        vm.prank(user(seed));
        vault.deposit{value: amount}(1e12, block.timestamp);
        deposits += amount;
    }

    function donate(uint96 raw) external {
        uint256 amount = bound(raw, 0, 1 ether);
        a.mint(address(vault), amount);
        donations += amount;
    }

    function pause(bool b_) external {
        vault.setPaused(b_);
    }

    function redeem(uint96 raw, uint256 seed, bool kind) external {
        address who = user(seed);
        uint256 bal = vault.balanceOf(who);
        if (bal == 0) return;
        uint256 shares = bound(raw, 1, bal);
        if (
            !kind
                && (vault.freeBalance(address(w)) * shares / vault.totalSupply() + vault.freeBalance(address(a))
                            * shares / vault.totalSupply() + vault.freeBalance(address(b)) * shares
                            / vault.totalSupply()) == 0
        ) return;
        uint256 old = who.balance;
        vm.prank(who);
        if (kind) vault.emergencyRedeemInKind(shares, who);
        else vault.withdraw(shares, 1, block.timestamp);
        ethPaid += who.balance - old;
    }

    function transfer(uint96 raw, uint256 seed) external {
        if (vault.paused()) return;
        address who = user(seed);
        uint256 bal = vault.balanceOf(who);
        if (bal == 0) return;
        vm.prank(who);
        vault.transfer(who == ALICE ? BOB : ALICE, bound(raw, 0, bal));
    }
}

contract VaultInvariantV2Test is StdInvariant, Test {
    VaultHandlerV2 h;

    function setUp() public {
        h = new VaultHandlerV2();
        targetContract(address(h));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = h.deposit.selector;
        selectors[1] = h.donate.selector;
        selectors[2] = h.pause.selector;
        selectors[3] = h.redeem.selector;
        selectors[4] = h.transfer.selector;
        targetSelector(FuzzSelector(address(h), selectors));
    }

    function invariantSupplyMatchesClaims() public view {
        HoodxIndexV2 v = h.vault();
        assertEq(v.totalSupply(), v.balanceOf(h.ALICE()) + v.balanceOf(h.BOB()));
    }

    function invariantConservation() public view {
        HoodxIndexV2 v = h.vault();
        uint256 accounted = v.totalAssets() + v.reserved(address(0)) + v.reserved(address(h.w()))
            + v.reserved(address(h.a())) + v.reserved(address(h.b())) + h.ethPaid() + h.w().balanceOf(h.TREASURY());
        address[2] memory users = [h.ALICE(), h.BOB()];
        for (uint256 i; i < 2; ++i) {
            accounted += h.w().balanceOf(users[i]) + h.a().balanceOf(users[i]) + h.b().balanceOf(users[i]);
        }
        assertEq(accounted, h.deposits() + h.donations());
    }

    function invariantNoExecutorAllowance() public view {
        assertEq(h.w().allowance(address(h.vault()), address(h.ex())), 0);
        assertEq(h.a().allowance(address(h.vault()), address(h.ex())), 0);
        assertEq(h.b().allowance(address(h.vault()), address(h.ex())), 0);
    }
}
