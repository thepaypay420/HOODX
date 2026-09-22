// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProportionalJoinHarness} from "./ProportionalJoinHarness.sol";

contract JoinToken is ERC20 {
    constructor() ERC20("Fixture", "FIX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract JoinWeth is JoinToken {
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
    }
}

contract JoinExecutor {
    address public immutable weth;
    uint256 public taxBps;
    address public shortToken;
    address public drainToken;
    address public drainOn;

    constructor(address w) {
        weth = w;
    }

    function setTax(uint256 tax) external {
        taxBps = tax;
    }

    function setShort(address token) external {
        shortToken = token;
    }

    function setDrain(address token, address trigger) external {
        drainToken = token;
        drainOn = trigger;
    }

    function execute(address input, address output, uint256 amount, uint256 floor, bytes calldata, uint256)
        external
        returns (uint256)
    {
        IERC20(input).transferFrom(msg.sender, address(this), amount);
        uint256 actual = output == shortToken ? 0 : amount * (10000 - taxBps) / 10000;
        if (input != weth) require(actual >= floor, "sell floor");
        JoinToken(output).mint(msg.sender, actual);
        if (output == drainOn) JoinToken(drainToken).burn(msg.sender, 1);
        return amount; // Deliberately dishonest return value: receipt balances are authoritative.
    }
}

contract ProportionalJoinTest is Test {
    JoinToken a;
    JoinToken b;
    JoinWeth w;
    JoinExecutor ex;
    ProportionalJoinHarness vault;
    address holder = address(0x1234);
    receive() external payable {}

    function setUp() public {
        a = new JoinToken();
        b = new JoinToken();
        w = new JoinWeth();
        ex = new JoinExecutor(address(w));
        address[] memory tokens = new address[](2);
        tokens[0] = address(a);
        tokens[1] = address(b);
        vault = new ProportionalJoinHarness(address(ex), tokens);
        a.mint(address(vault), 1 ether);
        b.mint(address(vault), 1 ether);
        vm.deal(address(this), 20 ether);
        w.deposit{value: 1 ether}();
        w.transfer(address(vault), 1 ether);
        vault.seedShares(holder, 1 ether);
    }

    function join(uint256 shares, uint256 budget, uint256 value) internal returns (uint256) {
        uint256[] memory budgets = new uint256[](2);
        budgets[0] = budget;
        budgets[1] = budget;
        bytes[] memory routes = new bytes[](2);
        return vault.depositETH{value: value}(shares, budgets, routes, block.timestamp);
    }

    function testExactJoinPreservesHolderAndRefundsExcessCash() public {
        uint256 refund = join(0.1 ether, 0.1 ether, 0.4 ether);
        assertEq(refund, 0.1 ether);
        assertEq(vault.balanceOf(address(this)), 0.1 ether);
        assertEq(a.balanceOf(address(vault)), 1.1 ether);
        assertEq(b.balanceOf(address(vault)), 1.1 ether);
        assertEq(w.balanceOf(address(vault)), 1.1 ether);
        assertEq(w.allowance(address(vault), address(ex)), 0);
    }

    function testTaxPaidByIncomingDeposit() public {
        ex.setTax(300);
        join(0.1 ether, 0.11 ether, 0.4 ether);
        assertGe(a.balanceOf(address(vault)) * 1 ether, 1 ether * vault.totalSupply());
        assertGe(b.balanceOf(address(vault)) * 1 ether, 1 ether * vault.totalSupply());
        assertEq(w.balanceOf(address(vault)), 1.1 ether);
    }

    function testTaxShortfallRevertsRatherThanDilutes() public {
        ex.setTax(300);
        vm.expectRevert(abi.encodeWithSelector(ProportionalJoinHarness.ShortContribution.selector, address(a)));
        join(0.1 ether, 0.1 ether, 0.3 ether);
        assertEq(vault.totalSupply(), 1 ether);
        assertEq(a.balanceOf(address(vault)), 1 ether);
        assertEq(w.balanceOf(address(ex)), 0);
    }

    function testLastAssetFailureRollsBackEarlierPurchases() public {
        ex.setShort(address(b));
        vm.expectRevert(abi.encodeWithSelector(ProportionalJoinHarness.ShortContribution.selector, address(b)));
        join(0.1 ether, 0.1 ether, 0.3 ether);
        assertEq(a.balanceOf(address(vault)), 1 ether);
        assertEq(vault.totalSupply(), 1 ether);
        assertEq(w.balanceOf(address(ex)), 0);
    }

    function testLaterRouteCannotStealEarlierContribution() public {
        ex.setDrain(address(a), address(b));
        vm.expectRevert(abi.encodeWithSelector(ProportionalJoinHarness.ShortContribution.selector, address(a)));
        join(0.1 ether, 0.1 ether, 0.3 ether);
    }

    function testDonationRequiresMoreContribution() public {
        a.mint(address(vault), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(ProportionalJoinHarness.ShortContribution.selector, address(a)));
        join(0.1 ether, 0.1 ether, 0.3 ether);
        assertEq(a.balanceOf(address(vault)), 2 ether);
    }

    function testCannotSpendExistingCash() public {
        vm.expectRevert(ProportionalJoinHarness.InvalidJoin.selector);
        join(0.1 ether, 0.1 ether, 0.2 ether);
    }

    function testZeroSharesRejected() public {
        vm.expectRevert(ProportionalJoinHarness.InvalidJoin.selector);
        join(0, 0.1 ether, 0.3 ether);
    }

    function testOneWeiSleeveRoundsUp() public view {
        assertEq(vault.required(1, 1, 1 ether), 1);
    }

    function testPartialETHExitPreservesRemainingBacking() public {
        join(0.1 ether, 0.1 ether, 0.3 ether);
        uint256[] memory floors = new uint256[](2);
        floors[0] = 0.1 ether;
        floors[1] = 0.1 ether;
        bytes[] memory routes = new bytes[](2);
        uint256 received = vault.withdrawETH(0.1 ether, 0.3 ether, floors, routes, block.timestamp);
        assertEq(received, 0.3 ether);
        assertEq(vault.totalSupply(), 1 ether);
        assertEq(a.balanceOf(address(vault)), 1 ether);
        assertEq(b.balanceOf(address(vault)), 1 ether);
        assertEq(w.balanceOf(address(vault)), 1 ether);
        assertEq(a.allowance(address(vault), address(ex)), 0);
    }

    function testAggregateExitFloorRevertsAllSales() public {
        join(0.1 ether, 0.1 ether, 0.3 ether);
        uint256[] memory floors = new uint256[](2);
        floors[0] = 0.1 ether;
        floors[1] = 0.1 ether;
        bytes[] memory routes = new bytes[](2);
        vm.expectRevert(ProportionalJoinHarness.InvalidJoin.selector);
        vault.withdrawETH(0.1 ether, 0.3 ether + 1, floors, routes, block.timestamp);
        assertEq(vault.balanceOf(address(this)), 0.1 ether);
        assertEq(a.balanceOf(address(vault)), 1.1 ether);
    }

    function testExitCannotIgnorePerAssetFloor() public {
        join(0.1 ether, 0.1 ether, 0.3 ether);
        uint256[] memory floors = new uint256[](2);
        floors[0] = 0.1 ether;
        floors[1] = 0.1 ether + 1;
        bytes[] memory routes = new bytes[](2);
        vm.expectRevert(bytes("sell floor"));
        vault.withdrawETH(0.1 ether, 1, floors, routes, block.timestamp);
        assertEq(vault.balanceOf(address(this)), 0.1 ether);
        assertEq(a.balanceOf(address(vault)), 1.1 ether);
    }

    function testFuzzNoDilutionByRounding(uint128 balance, uint96 shares, uint96 supply) public view {
        uint256 s = uint256(supply) + 1;
        uint256 m = uint256(shares) + 1;
        uint256 contribution = vault.required(balance, m, s);
        // Algebraically equivalent to (balance+contribution)/(s+m) >= balance/s.
        // Bounded operands keep this independent cross-product assertion within uint256.
        assertGe(contribution * s, uint256(balance) * m);
        if (contribution > 0) assertLt((contribution - 1) * s, uint256(balance) * m);
    }
}
