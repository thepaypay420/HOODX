// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TestWethV2, TestTokenV2} from "../v2/VaultV2.t.sol";
import {PairFactoryFixtureV3, PairFixtureV3} from "./SuccessorV3.t.sol";
import {QuotronRouterFixture, QuotronHookFixture} from "./RoutingV3.t.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";
import {HoodxIndexV3} from "../../contracts/v3/HoodxIndexV3.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxFactoryV3} from "../../contracts/v3/HoodxFactoryV3.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {TestOracleV2} from "../v2/VaultV2.t.sol";

contract TaxPairFactoryV3 {
    mapping(address => mapping(address => address)) public getPair;

    function add(address a, address b) external returns (PairFixtureV3 pair) {
        pair = new PairFixtureV3(a, b);
        getPair[a][b] = address(pair);
        getPair[b][a] = address(pair);
    }
}

contract TransferTaxTokenV3 is ERC20 {
    uint256 public tax = 300;
    constructor() ERC20("Taxed", "TAX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTax(uint256 bps) external {
        tax = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value * tax / 10000;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

contract PoolIdentityFixtureV3 {
    address public weth;
    address public v2Factory;

    constructor(address w, address f) {
        weth = w;
        v2Factory = f;
    }
}

contract TransferTaxV3Test is Test {
    TestWethV2 w;
    TransferTaxTokenV3 t;
    PairFixtureV3 pair;
    HoodxRoutingV3 routing;
    TaxPairFactoryV3 f;
    receive() external payable {}

    function setUp() public {
        w = new TestWethV2();
        t = new TransferTaxTokenV3();
        f = new TaxPairFactoryV3();
        pair = f.add(address(w), address(t));
        w.mint(address(pair), 1000 ether);
        t.mint(address(pair), 1000 ether);
        pair.sync();
        PoolIdentityFixtureV3 pools = new PoolIdentityFixtureV3(address(w), address(f));
        TestTokenV2 q = new TestTokenV2("Q");
        QuotronHookFixture h = new QuotronHookFixture();
        QuotronRouterFixture qr = new QuotronRouterFixture(address(w), q, h);
        h.configure(address(qr));
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        routing = new HoodxRoutingV3(address(pools), address(qr), address(registry), address(q), address(h));
        w.mint(address(this), 10 ether);
        w.approve(address(routing), type(uint256).max);
        t.approve(address(routing), type(uint256).max);
    }

    function route(bool buying) internal view returns (bytes memory) {
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 6;
        h[0].fee = 3000;
        h[0].hookData = abi.encode(uint256(300));
        h[0].tokenIn = buying ? address(w) : address(t);
        h[0].tokenOut = buying ? address(t) : address(w);
        return abi.encode(h);
    }

    function testEveryTransferTaxRoundTrip() public {
        uint256 out = routing.execute(address(w), address(t), 1 ether, 0.96 ether, route(true), block.timestamp);
        assertEq(out, t.balanceOf(address(this)));
        assertEq(t.balanceOf(address(routing)), 0);
        uint256 received = routing.execute(address(t), address(w), out, 0.92 ether, route(false), block.timestamp);
        assertGt(received, 0.92 ether);
        assertEq(t.balanceOf(address(this)), 0);
        assertEq(w.balanceOf(address(routing)), 0);
    }

    function testOutputTaxIncreaseRevertsWholeBuy() public {
        t.setTax(400);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        routing.execute(address(w), address(t), 1 ether, 1, route(true), block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
        assertEq(w.balanceOf(address(pair)), 1000 ether);
    }

    function testInputTaxIncreaseRevertsWholeSell() public {
        t.mint(address(this), 1 ether);
        t.setTax(400);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        routing.execute(address(t), address(w), 1 ether, 1, route(false), block.timestamp);
        assertEq(t.balanceOf(address(this)), 1 ether);
    }

    function testNetMinimumIsEnforcedAfterTax() public {
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        routing.execute(address(w), address(t), 1 ether, 0.99 ether, route(true), block.timestamp);
        assertEq(t.balanceOf(address(this)), 0);
    }

    function testDonationCannotBeConsumed() public {
        w.transfer(address(pair), 1);
        vm.expectRevert(HoodxRoutingV3.InvalidSettlement.selector);
        routing.execute(address(w), address(t), 1 ether, 1, route(true), block.timestamp);
    }

    function testFuzzNetOutputMatchesWallet(uint96 size) public {
        uint256 amount = bound(uint256(size), 1e10, 1 ether);
        uint256 before_ = w.balanceOf(address(this));
        uint256 out = routing.execute(address(w), address(t), amount, 1, route(true), block.timestamp);
        assertEq(t.balanceOf(address(this)), out);
        assertEq(before_ - w.balanceOf(address(this)), amount);
    }

    function makeVault() internal returns (HoodxIndexV3 v) {
        TransferTaxTokenV3 second = new TransferTaxTokenV3();
        PairFixtureV3 p = f.add(address(w), address(second));
        w.mint(address(p), 1000 ether);
        second.mint(address(p), 1000 ether);
        p.sync();
        HoodxPolicyV2 policy = new HoodxPolicyV2(address(this), address(routing));
        TestOracleV2 oracle = new TestOracleV2();
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = policy.approveConfig(address(t), address(oracle), route(true), route(false), bytes32(uint256(1)));
        V2Hop[] memory b = abi.decode(route(true), (V2Hop[]));
        b[0].tokenOut = address(second);
        V2Hop[] memory s = abi.decode(route(false), (V2Hop[]));
        s[0].tokenIn = address(second);
        ids[1] = policy.approveConfig(
            address(second), address(oracle), abi.encode(b), abi.encode(s), bytes32(uint256(2))
        );
        HoodxFeeModelV3 model = new HoodxFeeModelV3(address(routing), address(0), address(0));
        HoodxIndexV3 impl = new HoodxIndexV3(address(policy), address(model));
        HoodxFactoryV3 factory = new HoodxFactoryV3(address(this), address(0xbeef), address(impl));
        HoodxIndexV2.Init memory params = HoodxIndexV2.Init(
            address(this),
            address(this),
            address(this),
            address(0xbeef),
            "Tax basket",
            "TAX",
            0,
            10,
            2500,
            0.02 ether,
            ""
        );
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        v = HoodxIndexV3(payable(factory.create("taxbasket", params, ids, weights)));
        vm.deal(address(this), 1 ether);
        vm.deal(address(w), 3000 ether);
    }

    function testTaxedVaultPartialAndFinalETHWithdrawal() public {
        HoodxIndexV3 v = makeVault();
        uint256 shares = v.deposit{value: 0.08 ether}(v.previewDeposit(0.08 ether) * 99 / 100, block.timestamp);
        assertGt(t.balanceOf(address(v)), 0);
        assertEq(v.executionFactor(address(t), true), 967090000000000000);
        uint256 portion = shares / 2;
        v.withdraw(portion, v.previewWithdraw(portion) * 99 / 100, block.timestamp);
        v.withdraw(v.balanceOf(address(this)), v.previewWithdraw(v.balanceOf(address(this))) * 99 / 100, block.timestamp);
        assertEq(v.totalSupply(), 0);
        assertEq(t.balanceOf(address(v)), 0);
        assertEq(w.balanceOf(address(v)), 0);
    }

    function testTaxedInKindClaimReceivesNetAndClearsGrossReserve() public {
        HoodxIndexV3 v = makeVault();
        uint256 shares = v.deposit{value: 0.08 ether}(v.previewDeposit(0.08 ether) * 99 / 100, block.timestamp);
        uint256 held = t.balanceOf(address(v));
        v.emergencyRedeemInKind(shares, address(this));
        assertEq(t.balanceOf(address(this)), held - held * 300 / 10000);
        assertEq(v.claimable(address(this), address(t)), 0);
        assertEq(v.reserved(address(t)), 0);
        assertEq(t.balanceOf(address(v)), 0);
    }
}
