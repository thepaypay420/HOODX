// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HoodxExecutorV3} from "../../contracts/v3/HoodxExecutorV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {V2Hop, V2PoolKey, IV2Weth} from "../../contracts/v2/Types.sol";

interface F3 {
    function getPool(address, address, uint24) external view returns (address);
}

interface P3 {
    function liquidity() external view returns (uint128);
}

interface P2 {
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
}

interface F2 {
    function getPair(address, address) external view returns (address);
}

interface Q3 {
    struct Params {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }
    function quoteExactInputSingle(Params calldata) external returns (uint256, uint160, uint32, uint256);
}

interface Q4 {
    struct Params {
        V2PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }
    function quoteExactInputSingle(Params calldata) external returns (uint256, uint256);
}

/// Execution capability only: quoter-derived floors are NOT independent NAV valuation approval.
contract SuccessorWatchlistForkTest is Test {
    using SafeERC20 for IERC20;
    address constant W = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73"));
    address constant VF = address(bytes20(hex"1f7d7550b1b028f7571e69a784071f0205fd2efa"));
    address constant PF = address(bytes20(hex"8bceaa40b9acdfaedf85adf4ff01f5ad6517937f"));
    HoodxExecutorV3 ex;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envUint("HOODX_FORK_BLOCK"));
        assertEq(block.chainid, 4663);
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        uint256 now_ = vm.getBlockTimestamp();
        vm.warp(now_ - 2 days);
        registry.propose(address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044")), bytes32(uint256(1)));
        registry.propose(address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc")), bytes32(uint256(2)));
        vm.warp(now_);
        registry.activate(address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044")));
        registry.activate(address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc")));
        ex = new HoodxExecutorV3(
            W,
            address(bytes20(hex"8876789976decbfcbbbe364623c63652db8c0904")),
            address(bytes20(hex"000000000022d473030f116ddee9f6b43ac78ba3")),
            VF,
            address(bytes20(hex"f3334192d15450cdd385c8b70e03f9a6bd9e673b")),
            PF,
            address(registry)
        );
        vm.deal(address(this), 1 ether);
        IV2Weth(W).deposit{value: 1 ether}();
    }

    function bridge(address q) internal view returns (V2Hop memory h) {
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
        uint128 best;
        uint24 chosen;
        for (uint256 i; i < 4; i++) {
            address p = F3(VF).getPool(W, q, fees[i]);
            if (p != address(0)) {
                uint128 l = P3(p).liquidity();
                if (l > best) {
                    best = l;
                    chosen = fees[i];
                }
            }
        }
        require(best > 0, "no liquid bridge");
        h.kind = 3;
        h.tokenIn = W;
        h.tokenOut = q;
        h.fee = chosen;
    }

    function quote(V2Hop memory h, uint256 amount) internal returns (uint256 out) {
        if (h.kind == 2) {
            address p = F2(PF).getPair(h.tokenIn, h.tokenOut);
            (uint112 r0, uint112 r1,) = P2(p).getReserves();
            (uint256 rin, uint256 rout) =
                P2(p).token0() == h.tokenIn ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
            return amount * 997 * rout / (rin * 1000 + amount * 997);
        }
        if (h.kind == 3) {
            (out,,,) = Q3(address(bytes20(hex"33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7")))
                .quoteExactInputSingle(Q3.Params(h.tokenIn, h.tokenOut, amount, h.fee, 0));
        } else {
            (out,) = Q4(address(bytes20(hex"8dc178efb8111bb0973dd9d722ebeff267c98f94")))
                .quoteExactInputSingle(Q4.Params(h.key, h.tokenIn == h.key.currency0, uint128(amount), h.hookData));
        }
    }

    function run(V2Hop memory assetHop, uint256 amount) internal {
        address token = assetHop.tokenOut;
        bool needsBridge = assetHop.tokenIn != W && assetHop.tokenIn != address(0);
        V2Hop[] memory b = new V2Hop[](needsBridge ? 2 : 1);
        b[b.length - 1] = assetHop;
        if (needsBridge) b[0] = bridge(assetHop.tokenIn);
        uint256 expected = amount;
        for (uint256 i; i < b.length; i++) {
            expected = quote(b[i], expected);
        }
        require(expected > 0, "zero buy quote");
        IERC20(W).forceApprove(address(ex), amount);
        uint256 got = ex.execute(W, token, amount, expected * 9700 / 10000, abi.encode(b), block.timestamp + 300);
        V2Hop[] memory sell = new V2Hop[](b.length);
        for (uint256 i; i < b.length; i++) {
            sell[i] = b[b.length - 1 - i];
            (sell[i].tokenIn, sell[i].tokenOut) = (sell[i].tokenOut, sell[i].tokenIn);
        }
        expected = got;
        for (uint256 i; i < sell.length; i++) {
            expected = quote(sell[i], expected);
        }
        require(expected > 0, "zero sell quote");
        IERC20(token).forceApprove(address(ex), got);
        uint256 back = ex.execute(token, W, got, expected * 9700 / 10000, abi.encode(sell), block.timestamp + 300);
        emit log_named_uint("ETH returned wei", back);
        assertEq(IERC20(token).balanceOf(address(this)), 0);
        assertEq(IERC20(token).balanceOf(address(ex)), 0);
        assertEq(IERC20(W).balanceOf(address(ex)), 0);
        assertEq(address(ex).balance, 0);
        if (needsBridge) assertEq(IERC20(assetHop.tokenIn).balanceOf(address(ex)), 0);
    }

    function testPONSSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 3000;
        run(h, 0.0001 ether);
    }

    function testPONSMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 3000;
        run(h, 0.001 ether);
    }

    function testPONSLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 3000;
        run(h, 0.005 ether);
    }

    function testAISmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            10000,
            200,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testAIMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            10000,
            200,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testAILarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            10000,
            200,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testCASHCATSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            2690,
            54,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testCASHCATMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            2690,
            54,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testCASHCATLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            2690,
            54,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testIndexSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.0001 ether);
    }

    function testIndexMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.001 ether);
    }

    function testIndexLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.005 ether);
    }

    function testMEMESmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            2969,
            30,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testMEMEMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            2969,
            30,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testMEMELarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            2969,
            30,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testSTONKBROKERSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),
            10000,
            200,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testSTONKBROKERMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),
            10000,
            200,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testSTONKBROKERLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),
            10000,
            200,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testPRISMSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777")),
            15000,
            150,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testPRISMMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777")),
            15000,
            150,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testPRISMLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777")),
            15000,
            150,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testHOOKRSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),
            2500,
            25,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testHOOKRMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),
            2500,
            25,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testHOOKRLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),
            2500,
            25,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testDELTASmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),
            19900,
            199,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testDELTAMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),
            19900,
            199,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testDELTALarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),
            19900,
            199,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testSHROOMSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),
            9000,
            90,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testSHROOMMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),
            9000,
            90,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testSHROOMLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        h.key = V2PoolKey(
            address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")),
            address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),
            9000,
            90,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testBOWSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c"));
        h.key = V2PoolKey(
            address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c")),
            address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.0001 ether);
    }

    function testBOWMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c"));
        h.key = V2PoolKey(
            address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c")),
            address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.001 ether);
    }

    function testBOWLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c"));
        h.key = V2PoolKey(
            address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c")),
            address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.005 ether);
    }

    function testUPSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.0001 ether);
    }

    function testUPMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.001 ether);
    }

    function testUPLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.005 ether);
    }

    function testQUOTRONSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73"));
        h.key = V2PoolKey(
            address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            8388608,
            60,
            address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"))
        );
        run(h, 0.0001 ether);
    }

    function testQUOTRONMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73"));
        h.key = V2PoolKey(
            address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            8388608,
            60,
            address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"))
        );
        run(h, 0.001 ether);
    }

    function testQUOTRONLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73"));
        h.key = V2PoolKey(
            address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            8388608,
            60,
            address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"))
        );
        run(h, 0.005 ether);
    }

    function testNETSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf")),
            8500,
            85,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.0001 ether);
    }

    function testNETMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf")),
            8500,
            85,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.001 ether);
    }

    function testNETLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf")),
            8500,
            85,
            address(bytes20(hex"0000000000000000000000000000000000000000"))
        );
        run(h, 0.005 ether);
    }

    function testZEALSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.0001 ether);
    }

    function testZEALMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.001 ether);
    }

    function testZEALLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.005 ether);
    }

    function testwebsiteSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.0001 ether);
    }

    function testwebsiteMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.001 ether);
    }

    function testwebsiteLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 10000;
        run(h, 0.005 ether);
    }

    function testAriaSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.0001 ether);
    }

    function testAriaMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.001 ether);
    }

    function testAriaLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"a74a94c15b95f8d5f3abdd2db00f6c7384037b55")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.005 ether);
    }

    function testHARMONICSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.0001 ether);
    }

    function testHARMONICMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.001 ether);
    }

    function testHARMONICLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
        h.key = V2PoolKey(
            address(bytes20(hex"0000000000000000000000000000000000000000")),
            address(bytes20(hex"dee52f2ab639b6942b0d0f0565400b93b7a0fbe5")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.005 ether);
    }

    function testQUOTIENTSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 100;
        run(h, 0.0001 ether);
    }

    function testQUOTIENTMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 100;
        run(h, 0.001 ether);
    }

    function testQUOTIENTLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f"));
        h.kind = 3;
        h.tokenIn = W;
        h.fee = 100;
        run(h, 0.005 ether);
    }

    function testPROMETHEUSSmall() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea"));
        h.key = V2PoolKey(
            address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261")),
            address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.0001 ether);
    }

    function testPROMETHEUSMedium() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea"));
        h.key = V2PoolKey(
            address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261")),
            address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.001 ether);
    }

    function testPROMETHEUSLarge() public {
        V2Hop memory h;
        h.tokenOut = address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261"));
        h.kind = 4;
        h.tokenIn = address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea"));
        h.key = V2PoolKey(
            address(bytes20(hex"20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261")),
            address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea")),
            0,
            200,
            address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
        );
        run(h, 0.005 ether);
    }
}
