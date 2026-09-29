// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxLaunchHunterV1} from "../../contracts/launch/HoodxLaunchHunterV1.sol";

contract HunterToken is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract HunterWeth is ERC20("WETH", "WETH") {
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract HunterOracle {
    uint256 public price = 1 ether;

    function setPrice(uint256 value) external {
        price = value;
    }

    function value(address, uint256 amount) external view returns (uint256) {
        return amount * price / 1 ether;
    }
}

contract HunterExecutor {
    address public immutable weth;
    mapping(address => uint256) public rate;

    constructor(address weth_) {
        weth = weth_;
    }

    function setRate(address token, uint256 value) external {
        rate[token] = value;
    }

    function validateRoute(bytes calldata, address input, address output) external pure {
        require(input != output && input != address(0) && output != address(0));
    }

    function execute(address input, address output, uint256 amount, uint256 minOut, bytes calldata, uint256)
        external
        returns (uint256)
    {
        IERC20(input).transferFrom(msg.sender, address(this), amount);
        uint256 received = input == weth
            ? amount * 1 ether / (rate[output] == 0 ? 1 ether : rate[output])
            : amount * (rate[input] == 0 ? 1 ether : rate[input]) / 1 ether;
        HunterToken(output).mint(msg.sender, received);
        require(received >= minOut);
        return received;
    }
}

contract HunterPolicy {
    struct Config {
        address token;
        address oracle;
        bytes buy;
        bytes sell;
    }
    address public immutable executor;
    mapping(bytes32 => Config) internal configs;

    constructor(address executor_) {
        executor = executor_;
    }

    function add(address token, address oracle) external returns (bytes32 id) {
        id = keccak256(abi.encode(token));
        configs[id] = Config(token, oracle, hex"01", hex"02");
    }

    function config(bytes32 id) external view returns (address, address, bytes memory, bytes memory) {
        Config storage c = configs[id];
        require(c.token != address(0));
        return (c.token, c.oracle, c.buy, c.sell);
    }
}

contract LaunchHunterV1Test is Test {
    HunterWeth weth;
    HunterExecutor executor;
    HunterPolicy policy;
    HoodxLaunchHunterV1 hunter;
    HunterToken[] tokens;
    HunterOracle[] oracles;
    bytes32[] ids;
    address curator = address(0xC0FFEE);

    function setUp() public {
        weth = new HunterWeth();
        executor = new HunterExecutor(address(weth));
        policy = new HunterPolicy(address(executor));
        for (uint256 i; i < 6; ++i) {
            HunterToken token = new HunterToken(string.concat("T", vm.toString(i)));
            HunterOracle oracle = new HunterOracle();
            tokens.push(token);
            oracles.push(oracle);
            ids.push(policy.add(address(token), address(oracle)));
            executor.setRate(address(token), 1 ether);
        }
        hunter = new HoodxLaunchHunterV1(address(policy), curator, 100 ether, 200 ether);
        vm.deal(curator, 101 ether);
        vm.prank(curator);
        hunter.bootstrap{value: 100 ether}(curator);
    }

    function _arm(uint256 i, bytes32 cluster) internal {
        vm.prank(curator);
        hunter.arm(ids[i], cluster, keccak256(abi.encode("review", i)));
    }

    function _enter(uint256 i, uint256 amount) internal {
        vm.warp(block.timestamp + 24 hours);
        vm.prank(curator);
        hunter.enter(address(tokens[i]), amount, amount * 95 / 100, vm.getBlockTimestamp() + 5 minutes);
    }

    function testBootstrapIsExactAndOneTime() public {
        assertEq(hunter.balanceOf(curator), 200 ether);
        assertEq(weth.balanceOf(address(hunter)), 100 ether);
        vm.prank(curator);
        vm.expectRevert();
        hunter.bootstrap{value: 100 ether}(curator);
    }

    function testAdmissionDelayAndProbeCap() public {
        _arm(0, keccak256("A"));
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 0.5 ether, 0.47 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 0.5001 ether, 0.47 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.prank(curator);
        hunter.enter(address(tokens[0]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(tokens[0].balanceOf(address(hunter)), 0.5 ether);
        assertEq(hunter.riskyAssets(), 0.5 ether);
    }

    function testFiveSlotsAndOnePerCluster() public {
        for (uint256 i; i < 6; ++i) {
            _arm(i, keccak256(abi.encode(i < 2 ? uint256(1) : i)));
        }
        vm.warp(block.timestamp + 24 hours);
        vm.startPrank(curator);
        hunter.enter(address(tokens[0]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.expectRevert();
        hunter.enter(address(tokens[1]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        for (uint256 i = 2; i < 6; ++i) {
            hunter.enter(address(tokens[i]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        }
        vm.stopPrank();
        assertEq(hunter.activeTokens().length, 5);
    }

    function testAnyoneCanEnforceTwelveHourExit() public {
        _arm(0, keccak256("A"));
        _enter(0, 0.5 ether);
        vm.expectRevert();
        hunter.enforceExit(address(tokens[0]), 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.warp(block.timestamp + 12 hours);
        hunter.enforceExit(address(tokens[0]), 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 0);
        assertEq(weth.balanceOf(address(hunter)), 100 ether);
    }

    function testRecoverPrincipalAndTrailingExit() public {
        _arm(0, keccak256("A"));
        _enter(0, 0.5 ether);
        oracles[0].setPrice(2 ether);
        executor.setRate(address(tokens[0]), 2 ether);
        vm.prank(curator);
        hunter.recoverPrincipal(address(tokens[0]), 0.25 ether, 0.5 ether, vm.getBlockTimestamp() + 5 minutes);
        (,,,,,,, bool active, bool recovered,, uint256 high) = hunter.candidate(address(tokens[0]));
        assertTrue(active);
        assertTrue(recovered);
        assertEq(high, 0.5 ether);
        oracles[0].setPrice(1 ether);
        executor.setRate(address(tokens[0]), 1 ether);
        hunter.enforceExit(address(tokens[0]), 0.2375 ether, vm.getBlockTimestamp() + 5 minutes);
        assertEq(hunter.activeTokens().length, 0);
    }

    function testEmergencyRecoveryDoesNotNeedARoute() public {
        _arm(0, keccak256("A"));
        _enter(0, 0.5 ether);
        uint256 shares = hunter.balanceOf(curator);
        vm.prank(curator);
        hunter.redeemInKind(shares, curator);
        assertEq(hunter.totalSupply(), 0);
        assertEq(hunter.activeTokens().length, 0);
        assertEq(weth.balanceOf(curator), 99.5 ether);
        assertEq(tokens[0].balanceOf(curator), 0.5 ether);
    }

    function testSequentialHoldersRedeemProRataWithoutStrandingValue() public {
        _arm(0, keccak256("A"));
        _enter(0, 0.5 ether);
        address bob = address(0xB0B);
        vm.prank(curator);
        hunter.transfer(bob, 50 ether);

        vm.prank(bob);
        hunter.redeemInKind(50 ether, bob);
        assertEq(weth.balanceOf(bob), 24.875 ether);
        assertEq(tokens[0].balanceOf(bob), 0.125 ether);

        vm.prank(curator);
        hunter.redeemInKind(150 ether, curator);
        assertEq(weth.balanceOf(curator), 74.625 ether);
        assertEq(tokens[0].balanceOf(curator), 0.375 ether);
        assertEq(hunter.totalSupply(), 0);
        assertEq(weth.balanceOf(address(hunter)), 0);
        assertEq(tokens[0].balanceOf(address(hunter)), 0);
    }

    function testOneBadTokenCannotBlockWethRecovery() public {
        _arm(0, keccak256("A"));
        _enter(0, 0.5 ether);
        uint256 shares = hunter.balanceOf(curator);
        vm.mockCallRevert(
            address(tokens[0]),
            abi.encodeWithSelector(IERC20.transfer.selector, curator, 0.5 ether),
            bytes("malicious transfer")
        );
        vm.prank(curator);
        hunter.redeemInKind(shares, curator);
        assertEq(weth.balanceOf(curator), 99.5 ether);
        assertEq(hunter.claimable(curator, address(tokens[0])), 0.5 ether);
        vm.clearMockedCalls();
        vm.prank(curator);
        hunter.claim(address(tokens[0]), curator);
        assertEq(tokens[0].balanceOf(curator), 0.5 ether);
    }

    function testBalanceLossBelowReservedCannotBlockAnotherHoldersWeth() public {
        _arm(0, keccak256("A"));
        _enter(0, 0.5 ether);
        address bob = address(0xB0B);
        vm.prank(curator);
        hunter.transfer(bob, 100 ether);
        vm.mockCallRevert(
            address(tokens[0]),
            abi.encodeWithSelector(IERC20.transfer.selector, bob, 0.25 ether),
            bytes("malicious transfer")
        );
        vm.prank(bob);
        hunter.redeemInKind(100 ether, bob);
        assertEq(hunter.claimable(bob, address(tokens[0])), 0.25 ether);
        vm.clearMockedCalls();

        tokens[0].burn(address(hunter), 0.3 ether);
        assertEq(hunter.freeBalance(address(tokens[0])), 0);
        vm.prank(curator);
        hunter.redeemInKind(100 ether, curator);
        assertEq(weth.balanceOf(curator), 49.75 ether);
        assertEq(hunter.totalSupply(), 0);
    }

    function testRuntimeChangeAfterReviewFailsClosed() public {
        _arm(0, keccak256("A"));
        vm.etch(address(tokens[0]), hex"00");
        vm.warp(block.timestamp + 24 hours);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
    }

    function testDonationCannotIncreaseRiskBudgetOrPermanentlyPoisonCandidate() public {
        _arm(0, keccak256("A"));
        tokens[0].mint(address(hunter), 1);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.prank(curator);
        hunter.cancel(address(tokens[0]));
        vm.prank(curator);
        hunter.rescueUnexpectedToken(address(tokens[0]), curator, 1);
        assertEq(tokens[0].balanceOf(address(hunter)), 0);
    }

    function testOnlyCuratorCanArmEnterPauseAndEmergencyExit() public {
        vm.expectRevert();
        hunter.arm(ids[0], keccak256("A"), keccak256("e"));
        _arm(0, keccak256("A"));
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
        vm.expectRevert();
        hunter.setManagementPaused(true);
        vm.prank(curator);
        hunter.setManagementPaused(true);
        vm.prank(curator);
        vm.expectRevert();
        hunter.enter(address(tokens[0]), 0.5 ether, 0.475 ether, vm.getBlockTimestamp() + 5 minutes);
    }
}
