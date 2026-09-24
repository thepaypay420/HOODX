// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxFactoryV2} from "../../contracts/v2/HoodxFactoryV2.sol";
import {IV2Executor, IV2Policy, IV2Oracle} from "../../contracts/v2/Types.sol";

contract TestTokenV2 is ERC20 {
    bool public blocked;
    bool public gasBurn;

    function setGasBurn(bool value) external {
        gasBurn = value;
    }
    constructor(string memory s) ERC20(s, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(bool b) external {
        blocked = b;
    }

    function _update(address f, address t, uint256 a) internal override {
        if (gasBurn && f != address(0)) {
            assembly { invalid() }
        }
        require(!blocked || f == address(0), "blocked");
        super._update(f, t, a);
    }
}

contract TestWethV2 is TestTokenV2("WETH") {
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 a) external {
        _burn(msg.sender, a);
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok);
    }
}

contract TestOracleV2 is IV2Oracle {
    bool public broken;

    function setBroken(bool b) external {
        broken = b;
    }

    function value(address, uint256 a) external view returns (uint256) {
        require(!broken, "oracle");
        return a;
    }
}

contract TestExecutorV2 is IV2Executor {
    address public immutable weth;
    bool public broken;
    bool public lie;
    uint256 public outputBps = 10_000;
    bytes32 public brokenRoute;
    bytes32 public gasBurnRoute;

    constructor(address w) {
        weth = w;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function setLie(bool b) external {
        lie = b;
    }

    function setOutput(uint256 bps) external {
        outputBps = bps;
    }

    function setBrokenRoute(bytes calldata route) external {
        brokenRoute = keccak256(route);
    }

    function setGasBurnRoute(bytes calldata route) external {
        gasBurnRoute = keccak256(route);
    }
    function validateRoute(bytes calldata, address, address) external pure {}

    function execute(address i, address o, uint256 a, uint256 m, bytes calldata route, uint256)
        external
        returns (uint256 got)
    {
        require(!broken, "router");
        require(brokenRoute == bytes32(0) || brokenRoute != keccak256(route), "route");
        if (gasBurnRoute == keccak256(route)) {
            assembly { invalid() }
        }
        if (lie) return m;
        TestTokenV2(i).transferFrom(msg.sender, address(this), a);
        got = a * outputBps / 10_000;
        require(got >= m, "slip");
        TestTokenV2(o).mint(msg.sender, got);
    }
}

contract TestPolicyV2 is IV2Policy {
    address public immutable executor;
    address public immutable oracle;
    mapping(bytes32 => address) public entries;
    mapping(bytes32 => address) public oracleById;
    uint256 private nonce;

    constructor(address e, address o) {
        executor = e;
        oracle = o;
    }

    function add(address token) external returns (bytes32 id) {
        id = bytes32(uint256(uint160(token)));
        entries[id] = token;
        oracleById[id] = oracle;
    }

    function addWithOracle(address token, address selectedOracle) external returns (bytes32 id) {
        id = keccak256(abi.encode(token, selectedOracle, ++nonce));
        entries[id] = token;
        oracleById[id] = selectedOracle;
    }

    function config(bytes32 id) external view returns (address, address, bytes memory, bytes memory) {
        require(entries[id] != address(0));
        return (entries[id], oracleById[id], hex"01", hex"02");
    }
}

contract VaultV2Test is Test {
    TestWethV2 w;
    TestTokenV2 a;
    TestTokenV2 b;
    TestOracleV2 oracle;
    TestExecutorV2 exec;
    TestPolicyV2 policy;
    HoodxIndexV2 impl;
    HoodxIndexV2 vault;
    HoodxFactoryV2 factory;
    address alice = address(0xa11ce);
    address bob = address(0xb0b);
    address curator = address(0xc0);
    address creator = address(0xc1);
    address treasury = address(0xc2);

    function setUp() public {
        w = new TestWethV2();
        a = new TestTokenV2("A");
        b = new TestTokenV2("B");
        oracle = new TestOracleV2();
        exec = new TestExecutorV2(address(w));
        policy = new TestPolicyV2(address(exec), address(oracle));
        impl = new HoodxIndexV2(address(policy));
        factory = new HoodxFactoryV2(address(this), treasury, address(impl));
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = policy.add(address(a));
        ids[1] = policy.add(address(b));
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        vault = HoodxIndexV2(payable(factory.create("696x", params(), ids, weights)));
        vm.deal(alice, 1_000_000 ether);
        vm.deal(bob, 1_000_000 ether);
        vm.deal(address(w), 1_000_000 ether);
    }

    function params() internal view returns (HoodxIndexV2.Init memory) {
        return HoodxIndexV2.Init(curator, creator, creator, treasury, "Test", "TEST", 0, 10, 2500, 0.02 ether, "");
    }

    function deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = vault.deposit{value: amount}(1e12, block.timestamp);
    }

    function exit(address who, uint256 shares) internal {
        vm.prank(who);
        vault.withdraw(shares, 1, block.timestamp);
    }

    function testRolesAndClone() public {
        assertEq(vault.owner(), curator);
        assertEq(vault.creator(), creator);
        assertEq(vault.treasury(), treasury);
        assertEq(vault.totalSupply(), 0);
        assertEq(address(vault).code.length, 45);
    }

    function testImplementationAndCloneCannotReinitialize() public {
        bytes32[] memory ids = new bytes32[](2);
        uint16[] memory weights = new uint16[](2);
        vm.expectRevert();
        impl.initialize(params(), ids, weights);
        vm.expectRevert();
        vault.initialize(params(), ids, weights);
    }

    function testFirstAndSubsequentDepositFees() public {
        uint256 s = deposit(alice, 1 ether);
        assertEq(w.balanceOf(treasury), 0.001 ether);
        assertEq(vault.totalAssets(), 0.999 ether);
        assertEq(deposit(bob, 1 ether), s);
    }

    function testPartialThenFinalExitLeavesNoAssets() public {
        uint256 s = deposit(alice, 1 ether);
        exit(alice, s / 2);
        exit(alice, s - s / 2);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.totalAssets(), 0);
        assertEq(a.balanceOf(address(vault)), 0);
        assertEq(b.balanceOf(address(vault)), 0);
    }

    function test_FailedSellNeverBurnsOrChangesBags() public {
        uint256 s = deposit(alice, 1 ether);
        uint256 bag = a.balanceOf(address(vault));
        exec.setBroken(true);
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(s, 1, block.timestamp);
        assertEq(vault.balanceOf(alice), s);
        assertEq(a.balanceOf(address(vault)), bag);
    }

    function testNoEffectRouterCannotBurnShares() public {
        uint256 s = deposit(alice, 1 ether);
        exec.setLie(true);
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(s, 1, block.timestamp);
        assertEq(vault.balanceOf(alice), s);
    }

    function testPausedOracleRouterFailureInKind() public {
        uint256 s = deposit(alice, 1 ether);
        vm.prank(curator);
        vault.setPaused(true);
        oracle.setBroken(true);
        exec.setBroken(true);
        vm.prank(alice);
        vault.emergencyRedeemInKind(s, alice);
        assertEq(vault.totalSupply(), 0);
        assertGt(a.balanceOf(alice), 0);
        assertEq(a.balanceOf(address(vault)), 0);
    }

    function test_FailedTokenIsReservedOtherTokensPaidAndRetryWorks() public {
        uint256 s = deposit(alice, 1 ether);
        uint256 bag = a.balanceOf(address(vault));
        a.setBlocked(true);
        vm.prank(alice);
        vault.emergencyRedeemInKind(s, alice);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.reserved(address(a)), bag);
        assertEq(vault.claimable(alice, address(a)), bag);
        assertGt(b.balanceOf(alice), 0);
        assertEq(vault.totalAssets(), 0);
        deposit(bob, 1 ether);
        assertEq(vault.reserved(address(a)), bag);
        a.setBlocked(false);
        vm.prank(alice);
        vault.claim(address(a), bob);
        assertEq(a.balanceOf(bob), bag);
        assertEq(vault.reserved(address(a)), 0);
    }

    function testReservationsCannotBeSoldByCurator() public {
        uint256 s = deposit(alice, 1 ether);
        a.setBlocked(true);
        vm.prank(alice);
        vault.emergencyRedeemInKind(s, alice);
        a.setBlocked(false);
        vm.prank(curator);
        vault.setPaused(true);
        vm.prank(curator);
        vm.expectRevert();
        vault.emergencyUnwind(address(a), 1, 1, block.timestamp);
    }

    function testPauseBlocksEntryBuysTransfersButNotNormalExit() public {
        uint256 s = deposit(alice, 1 ether);
        vm.prank(curator);
        vault.setPaused(true);
        vm.prank(bob);
        vm.expectRevert();
        vault.deposit{value: 1 ether}(1e12, block.timestamp);
        vm.prank(curator);
        vm.expectRevert();
        vault.rebalance(address(a), true, 0.01 ether, 1, block.timestamp);
        vm.prank(alice);
        vm.expectRevert();
        vault.transfer(bob, 1);
        exit(alice, s);
    }

    function testCreatorCuratorSeparation() public {
        vm.prank(curator);
        vm.expectRevert();
        vault.setCreatorEconomics(curator, 50);
        vm.prank(creator);
        vm.expectRevert();
        vault.setPaused(true);
        vm.prank(creator);
        vault.setCreatorEconomics(bob, 50);
        assertEq(vault.creatorRecipient(), bob);
        vm.prank(curator);
        vault.transferOwnership(bob);
        assertEq(vault.owner(), curator);
        vm.prank(bob);
        vault.acceptOwnership();
        assertEq(vault.creator(), creator);
    }

    function test_FailedBuyRemainsCash() public {
        exec.setBroken(true);
        deposit(alice, 1 ether);
        assertEq(w.balanceOf(address(vault)), 0.999 ether);
        assertEq(a.balanceOf(address(vault)), 0);
    }

    function testOracleFailureBlocksDepositNotInKind() public {
        deposit(alice, 1 ether);
        oracle.setBroken(true);
        vm.prank(bob);
        vm.expectRevert();
        vault.deposit{value: 1 ether}(1e12, block.timestamp);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.emergencyRedeemInKind(shares, alice);
    }

    function testUnwindRetainsCashInVault() public {
        deposit(alice, 1 ether);
        vm.prank(curator);
        vault.setPaused(true);
        uint256 old = w.balanceOf(address(vault));
        uint256 amount = a.balanceOf(address(vault));
        vm.prank(curator);
        vault.emergencyUnwind(address(a), amount, 1, block.timestamp);
        assertGt(w.balanceOf(address(vault)), old);
        assertEq(w.balanceOf(curator), 0);
    }

    function testUnauthorizedEntryPointsAndInvalidRecipient() public {
        deposit(alice, 1 ether);
        vm.expectRevert();
        vault.executeBuy(address(a), 1, 1, block.timestamp);
        vm.expectRevert();
        vault.payClaim(alice, address(a), bob);
        vm.prank(alice);
        vm.expectRevert();
        vault.emergencyRedeemInKind(1, address(vault));
    }

    function testFuzzProportionalInKind(uint96 x, uint96 y, uint64 part) public {
        uint256 ax = bound(x, 0.02 ether, 100 ether);
        uint256 by = bound(y, 0.02 ether, 100 ether);
        uint256 s = deposit(alice, ax);
        deposit(bob, by);
        uint256 amount = bound(part, 1, s);
        uint256 expected = a.balanceOf(address(vault)) * amount / vault.totalSupply();
        vm.prank(alice);
        vault.emergencyRedeemInKind(amount, alice);
        assertEq(a.balanceOf(alice), expected);
        assertEq(vault.balanceOf(alice), s - amount);
    }

    function testFuzzDonationDoesNotProfitInBoundedRoundtrip(uint96 donation, uint96 victim) public {
        uint256 d = bound(donation, 0, 100 ether);
        uint256 v = bound(victim, 0.02 ether, 100 ether);
        uint256 initial = alice.balance;
        uint256 s = deposit(alice, 0.02 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: d}("");
        assertTrue(ok);
        uint256 bs = deposit(bob, v);
        exit(bob, bs);
        exit(alice, s);
        assertLe(alice.balance, initial);
    }

    function test24AssetGasAndExit() public {
        bytes32[] memory ids = new bytes32[](24);
        uint16[] memory weights = new uint16[](24);
        for (uint256 i; i < 24; ++i) {
            ids[i] = policy.add(address(new TestTokenV2("T")));
            weights[i] = i == 23 ? 324 : 312;
        }
        HoodxIndexV2 basket = HoodxIndexV2(payable(factory.create("faangx", params(), ids, weights)));
        uint256 gasStart = gasleft();
        vm.prank(alice);
        uint256 s = basket.deposit{value: 1 ether}(1e12, block.timestamp);
        emit log_named_uint("24 asset first deposit", gasStart - gasleft());
        gasStart = gasleft();
        vm.prank(bob);
        uint256 bs = basket.deposit{value: 1 ether}(1e12, block.timestamp);
        emit log_named_uint("24 asset repeated deposit", gasStart - gasleft());
        gasStart = gasleft();
        vm.prank(alice);
        basket.withdraw(s, 1, block.timestamp);
        emit log_named_uint("24 asset normal withdrawal", gasStart - gasleft());
        vm.prank(curator);
        basket.setPaused(true);
        gasStart = gasleft();
        vm.prank(bob);
        basket.emergencyRedeemInKind(bs, bob);
        emit log_named_uint("24 asset direct redemption", gasStart - gasleft());
        assertEq(basket.totalAssets(), 0);
    }
}

// A receiver attempts a second exit during the native payout of its first exit.
contract ReentrantReceiverV2 {
    HoodxIndexV2 public vault;
    bool public attempted;
    bool public reentered;

    constructor(HoodxIndexV2 v) {
        vault = v;
    }

    function enter() external payable {
        vault.deposit{value: msg.value}(1e12, block.timestamp);
    }

    function leave() external {
        vault.withdraw(vault.balanceOf(address(this)), 1, block.timestamp);
    }

    receive() external payable {
        attempted = true;
        (reentered,) = address(vault).call(abi.encodeCall(vault.withdraw, (1, 1, block.timestamp)));
    }
}

contract VaultCallbackV2Test is VaultV2Test {
    function testNativeReceiverCannotReenterWithdrawal() public {
        ReentrantReceiverV2 receiver = new ReentrantReceiverV2(vault);
        vm.deal(address(this), 1 ether);
        receiver.enter{value: 1 ether}();
        receiver.leave();
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentered());
        assertEq(vault.balanceOf(address(receiver)), 0);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.totalAssets(), 0);
    }

    function testDonationBeforeFirstDepositReservedForTreasury() public {
        a.mint(address(vault), 100 ether);
        vm.deal(address(vault), 100 ether);
        uint256 shares = deposit(alice, 1 ether);
        assertEq(vault.claimable(treasury, address(a)), 100 ether);
        assertEq(vault.claimable(treasury, address(0)), 100 ether);
        assertEq(vault.totalAssets(), 0.999 ether);
        exit(alice, shares);
        assertEq(vault.totalAssets(), 0);
        vm.prank(treasury);
        vault.claim(address(a), treasury);
        assertEq(a.balanceOf(treasury), 100 ether);
        vm.prank(treasury);
        vault.claim(address(0), treasury);
        assertEq(treasury.balance, 100 ether);
    }
}

contract GasBurningRecipientV2 {
    receive() external payable {
        assembly { invalid() }
    }
}

contract EmergencyGasV2Test is VaultV2Test {
    function testGasBurningTokenDefersOnlyItsClaim() public {
        uint256 shares = deposit(alice, 1 ether);
        uint256 expected = a.balanceOf(address(vault));
        a.setGasBurn(true);
        vm.prank(alice);
        vault.emergencyRedeemInKind(shares, alice);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.reserved(address(a)), expected);
        assertEq(vault.claimable(alice, address(a)), expected);
        assertGt(b.balanceOf(alice), 0);
        a.setGasBurn(false);
        vm.prank(alice);
        vault.claim(address(a), alice);
        assertEq(a.balanceOf(alice), expected);
        assertEq(vault.reserved(address(a)), 0);
    }

    function testGasBurningNativeRecipientCannotBlockTokens() public {
        uint256 shares = deposit(alice, 1 ether);
        vm.deal(address(vault), 1 ether);
        GasBurningRecipientV2 recipient = new GasBurningRecipientV2();
        vm.prank(alice);
        vault.emergencyRedeemInKind(shares, address(recipient));
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.claimable(alice, address(0)), 1 ether);
        assertGt(a.balanceOf(address(recipient)), 0);
        assertGt(b.balanceOf(address(recipient)), 0);
        vm.prank(alice);
        vault.claim(address(0), alice);
        assertEq(vault.reserved(address(0)), 0);
    }
}
