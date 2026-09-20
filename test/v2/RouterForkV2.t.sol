// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxExecutorV2} from "../../contracts/v2/HoodxExecutorV2.sol";
import {V2Hop, V2PoolKey, IV2Weth} from "../../contracts/v2/Types.sol";

interface ILegacyV2 {
    function nTokens() external view returns (uint256);
    function tokenAt(uint256) external view returns (address);
    function isV4(address) external view returns (bool);
    function quoteOf(address) external view returns (address);
    function poolOf(address) external view returns (address);
    function quoteBridgeV3(address) external view returns (address);
    function v4Key(address) external view returns (V2PoolKey memory);
}

interface IPosmKeyV2 {
    function poolKeys(bytes25) external view returns (V2PoolKey memory);
}

interface IPermitReadV2 {
    function allowance(address, address, address) external view returns (uint160, uint48, uint48);
}

interface IPoolFeeV2 {
    function fee() external view returns (uint24);
}

contract RouterForkV2Test is Test {
    address constant W = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant STATE = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant MEME = 0xAC45f6FffB17645057aa783b72b2Ce78BD7A1a3A;
    address constant FAANG = 0x037c116d7C09Ed4D2733Eb628488ab9c0394353f;
    HoodxExecutorV2 ex;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com"));
        uint256 blockNo = vm.envOr("HOODX_FORK_BLOCK", uint256(67565367));
        if (blockNo == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNo);
        assertEq(block.chainid, 4663);
        ex = new HoodxExecutorV2(W, ROUTER, PERMIT, FACTORY, STATE, new address[](0));
        vm.deal(address(this), 10 ether);
        IV2Weth(W).deposit{value: 1 ether}();
    }
    receive() external payable {}

    function hop(address i, address o, uint24 fee) internal pure returns (V2Hop memory h) {
        h.kind = 3;
        h.tokenIn = i;
        h.tokenOut = o;
        h.fee = fee;
    }

    function routes(address legacy, uint256 index)
        internal
        view
        returns (address token, bytes memory buy, bytes memory sell)
    {
        ILegacyV2 v = ILegacyV2(legacy);
        token = v.tokenAt(index);
        address quote = v.quoteOf(token);
        bool bridge = quote != address(0) && quote != W;
        V2Hop[] memory b = new V2Hop[](bridge ? 2 : 1);
        V2Hop[] memory s = new V2Hop[](bridge ? 2 : 1);
        V2Hop memory h;
        if (v.isV4(token)) {
            h.kind = 4;
            h.key = v.v4Key(token);
            h.tokenIn = h.key.currency0 == token ? h.key.currency1 : h.key.currency0;
            h.tokenOut = token;
        } else {
            h = hop(bridge ? quote : W, token, IPoolFeeV2(v.poolOf(token)).fee());
        }
        b[bridge ? 1 : 0] = abi.decode(abi.encode(h), (V2Hop));
        (h.tokenIn, h.tokenOut) = (h.tokenOut, h.tokenIn);
        s[0] = h;
        if (bridge) {
            uint24 f = IPoolFeeV2(v.quoteBridgeV3(quote)).fee();
            b[0] = hop(W, quote, f);
            s[1] = hop(quote, W, f);
        }
        buy = abi.encode(b);
        sell = abi.encode(s);
    }

    function roundtrip(address old, uint256 index, uint256 amount) internal {
        (address token, bytes memory buy, bytes memory sell) = routes(old, index);
        uint256 cash = IERC20(W).balanceOf(address(this));
        IERC20(W).approve(address(ex), amount);
        uint256 got = ex.execute(W, token, amount, 1, buy, block.timestamp);
        assertGt(got, 0);
        IERC20(token).approve(address(ex), got);
        uint256 back = ex.execute(token, W, got, 1, sell, block.timestamp);
        assertGt(back, amount * 90 / 100, "roundtrip loss exceeds 10%");
        assertEq(IERC20(token).balanceOf(address(ex)), 0);
        assertEq(IERC20(W).balanceOf(address(ex)), 0);
        (uint160 permitted,,) = IPermitReadV2(PERMIT).allowance(address(ex), token, ROUTER);
        assertEq(permitted, 0);
        uint256 tokenAllowance = IERC20(token).allowance(address(ex), PERMIT);
        assertTrue(tokenAllowance == 0 || tokenAllowance == type(uint256).max);
        assertEq(IERC20(W).allowance(address(ex), PERMIT), 0);
        assertEq(IERC20(W).balanceOf(address(this)), cash - amount + back);
    }

    function testFork696x0() public {
        roundtrip(MEME, 0, 0.001 ether);
    }

    function testFork696x1() public {
        roundtrip(MEME, 1, 0.001 ether);
    }

    function testFork696x2() public {
        roundtrip(MEME, 2, 0.001 ether);
    }

    function testFork696x3() public {
        roundtrip(MEME, 3, 0.001 ether);
    }

    function testFork696x4() public {
        roundtrip(MEME, 4, 0.001 ether);
    }

    function testFork696x5() public {
        roundtrip(MEME, 5, 0.001 ether);
    }

    function testFork696x6() public {
        roundtrip(MEME, 6, 0.001 ether);
    }

    function testFork696x7() public {
        roundtrip(MEME, 7, 0.001 ether);
    }

    function testFork696x8() public {
        roundtrip(MEME, 8, 0.001 ether);
    }

    function testFork696x9() public {
        roundtrip(MEME, 9, 0.001 ether);
    }

    function testForkFaang0() public {
        roundtrip(FAANG, 0, 0.001 ether);
    }

    function testForkFaang1AMZN() public {
        roundtrip(FAANG, 1, 0.001 ether);
    }

    function testForkFaang2() public {
        roundtrip(FAANG, 2, 0.001 ether);
    }

    function testForkFaang3NFLX() public {
        roundtrip(FAANG, 3, 0.001 ether);
    }

    function testForkFaang4() public {
        roundtrip(FAANG, 4, 0.001 ether);
    }

    function testForkLargerPons() public {
        roundtrip(MEME, 0, 0.01 ether);
    }

    function testForkAllLarger696x() public {
        for (uint256 i; i < 10; ++i) {
            roundtrip(MEME, i, 0.01 ether);
        }
    }

    function testForkAllLargerFaang() public {
        for (uint256 i; i < 5; ++i) {
            roundtrip(FAANG, i, 0.01 ether);
        }
    }

    function testForkRepeatedUSDGNoDust() public {
        address usdg = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
        uint256 beforeRouter = IERC20(usdg).balanceOf(ROUTER);
        for (uint256 i; i < 5; ++i) {
            roundtrip(FAANG, 1, 0.001 ether);
            roundtrip(FAANG, 3, 0.001 ether);
        }
        assertEq(IERC20(usdg).balanceOf(address(ex)), 0);
        assertEq(IERC20(usdg).balanceOf(ROUTER), beforeRouter);
    }

    function testForkSlippageAtomicMixedRoute() public {
        (address token, bytes memory buy,) = routes(FAANG, 1);
        uint256 beforeW = IERC20(W).balanceOf(address(this));
        IERC20(W).approve(address(ex), 0.001 ether);
        vm.expectRevert();
        ex.execute(W, token, 0.001 ether, type(uint128).max, buy, block.timestamp);
        assertEq(IERC20(W).balanceOf(address(this)), beforeW);
        assertEq(IERC20(token).balanceOf(address(this)), 0);
    }

    function testForkRealReturnDeltaHookCapability() public {
        V2PoolKey memory k = IPosmKeyV2(0x58daec3116aae6D93017bAAea7749052E8a04fA7)
            .poolKeys(bytes25(bytes32(0x77ea11bbfb8f1259c702cb0ebc2105b7c007db89cf30c2f1a8776886a4467c07)));
        address token = k.currency1;
        assertEq(keccak256(abi.encode(k)), bytes32(0x77ea11bbfb8f1259c702cb0ebc2105b7c007db89cf30c2f1a8776886a4467c07));
        assertTrue(k.hooks != address(0));
        address[] memory hooks = new address[](1);
        hooks[0] = k.hooks;
        ex = new HoodxExecutorV2(W, ROUTER, PERMIT, FACTORY, STATE, hooks);
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 4;
        h[0].key = k;
        h[0].tokenIn = k.currency0 == token ? k.currency1 : k.currency0;
        h[0].tokenOut = token;
        IERC20(W).approve(address(ex), 0.001 ether);
        uint256 got = ex.execute(W, token, 0.001 ether, 1, abi.encode(h), block.timestamp);
        (h[0].tokenIn, h[0].tokenOut) = (h[0].tokenOut, h[0].tokenIn);
        IERC20(token).approve(address(ex), got);
        uint256 back = ex.execute(token, W, got, 1, abi.encode(h), block.timestamp);
        assertGt(back, 0.0009 ether);
    }
}
