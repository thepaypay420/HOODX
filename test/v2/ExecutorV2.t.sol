// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {TestTokenV2, TestWethV2} from "./VaultV2.t.sol";
import {HoodxExecutorV2} from "../../contracts/v2/HoodxExecutorV2.sol";
import {V2Hop} from "../../contracts/v2/Types.sol";

contract PermitMockV2 {
    mapping(address => mapping(address => mapping(address => uint160))) public permits;

    function approve(address t, address s, uint160 a, uint48) external {
        permits[msg.sender][t][s] = a;
    }

    function pull(address from, address t, address to, uint160 a) external {
        require(permits[from][t][msg.sender] >= a);
        permits[from][t][msg.sender] -= a;
        TestTokenV2(t).transferFrom(from, to, a);
    }
}

contract PoolMockV2 {
    uint128 public liquidity = 1;
}

contract FactoryMockV2 {
    address immutable pool;

    constructor() {
        pool = address(new PoolMockV2());
    }

    function getPool(address, address, uint24) external view returns (address) {
        return pool;
    }
}

contract StateMockV2 {
    function getLiquidity(bytes32) external pure returns (uint128) {
        return 1;
    }
}

contract RouterMockV2 {
    PermitMockV2 immutable permit;
    uint256 public mode;

    constructor(address p) {
        permit = PermitMockV2(p);
    }

    function setMode(uint256 m) external {
        mode = m;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256) external payable {
        require(commands.length == 1 && commands[0] == 0x00);
        (address recipient, uint256 amount,, bytes memory path, bool payer, uint256[] memory prices) =
            abi.decode(inputs[0], (address, uint256, uint256, bytes, bool, uint256[]));
        require(payer && prices.length == 1 && recipient == msg.sender);
        address tokenIn;
        address tokenOut;
        assembly {
            tokenIn := shr(96, mload(add(path, 32)))
            tokenOut := shr(96, mload(add(path, 55)))
        }
        permit.pull(msg.sender, tokenIn, address(this), uint160(mode == 1 ? amount + 1 : amount));
        if (mode == 2) recipient = address(0xbad);
        TestTokenV2(tokenOut).mint(recipient, mode == 3 ? amount / 2 : amount);
        // A canonical router does not retain input; this mock burns it to model settlement.
        TestTokenV2(tokenIn).transfer(address(0x1234), amount);
    }
}

contract ExecutorV2Test is Test {
    TestWethV2 w;
    TestTokenV2 token;
    PermitMockV2 permit;
    RouterMockV2 router;
    HoodxExecutorV2 ex;
    bytes route;

    function setUp() public {
        w = new TestWethV2();
        token = new TestTokenV2("OUT");
        permit = new PermitMockV2();
        router = new RouterMockV2(address(permit));
        ex = new HoodxExecutorV2(
            address(w),
            address(router),
            address(permit),
            address(new FactoryMockV2()),
            address(new StateMockV2()),
            new address[](0)
        );
        V2Hop[] memory hops = new V2Hop[](1);
        hops[0].kind = 3;
        hops[0].tokenIn = address(w);
        hops[0].tokenOut = address(token);
        hops[0].fee = 3000;
        route = abi.encode(hops);
        w.mint(address(this), 10 ether);
        w.approve(address(ex), 1 ether);
    }

    function trade() internal {
        ex.execute(address(w), address(token), 1 ether, 0.97 ether, route, block.timestamp);
    }

    function testExactInputOutputAndClearedApprovals() public {
        trade();
        assertEq(token.balanceOf(address(this)), 1 ether);
        assertEq(w.allowance(address(ex), address(permit)), 0);
        assertEq(permit.permits(address(ex), address(w), address(router)), 0);
        assertEq(w.balanceOf(address(ex)), 0);
    }

    function testExcessInputRevertsAllTransfers() public {
        router.setMode(1);
        vm.expectRevert();
        trade();
        assertEq(w.balanceOf(address(this)), 10 ether);
        assertEq(token.balanceOf(address(0xbad)), 0);
    }

    function testRedirectedOutputRevertsAllTransfers() public {
        router.setMode(2);
        vm.expectRevert();
        trade();
        assertEq(w.balanceOf(address(this)), 10 ether);
        assertEq(token.balanceOf(address(0xbad)), 0);
    }

    function testInadequateOutputRevertsAllTransfers() public {
        router.setMode(3);
        vm.expectRevert();
        trade();
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testMalformedDataCannotCallArbitraryTarget() public {
        vm.expectRevert();
        ex.execute(address(w), address(token), 1 ether, 1, abi.encode(address(0xbad), bytes("attack")), block.timestamp);
    }

    function testCannotSpendAnotherCallersFunds() public {
        vm.prank(address(0xbad));
        vm.expectRevert();
        ex.execute(address(w), address(token), 1 ether, 1, route, block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testPreexistingBalancesCannotBeSwept() public {
        w.mint(address(ex), 7 ether);
        token.mint(address(ex), 8 ether);
        trade();
        assertEq(w.balanceOf(address(ex)), 7 ether);
        assertEq(token.balanceOf(address(ex)), 8 ether);
    }

    function testUnknownHookRejectedBeforeFundsMove() public {
        V2Hop[] memory hops = abi.decode(route, (V2Hop[]));
        hops[0].kind = 4;
        hops[0].key.hooks = address(0xbad);
        vm.expectRevert();
        ex.execute(address(w), address(token), 1 ether, 1, abi.encode(hops), block.timestamp);
        assertEq(w.balanceOf(address(this)), 10 ether);
    }

    function testExpiredAndZeroMinOutRejected() public {
        vm.warp(10);
        vm.expectRevert();
        ex.execute(address(w), address(token), 1 ether, 1, route, 9);
        vm.expectRevert();
        ex.execute(address(w), address(token), 1 ether, 0, route, 10);
    }
}
