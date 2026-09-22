// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {HoodxClTwapV3} from "../../contracts/v3/HoodxClTwapV3.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxFreshTwapV3} from "../../contracts/v3/HoodxFreshTwapV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {V2Hop, V2PoolKey} from "../../contracts/v2/Types.sol";

contract ClOracleForkTest is SuccessorWatchlistForkTest {
    function checkCl(uint256 amount) internal {
        address token = address(bytes20(hex"ca9c78dd337a67f6e0077f65f5e9218719d30edf"));
        address usd = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
        HoodxFreshTwapV3 bridgeOracle = new HoodxFreshTwapV3(
            address(
                new HoodxTwapV2(
                    VF,
                    usd,
                    W,
                    address(bytes20(hex"52e65b17fb6e5ba00ed806f37afcd2daa50271ca")),
                    address(0),
                    1800,
                    2631289198634062971,
                    0
                )
            ),
            1800
        );
        // Fixed discovery baseline: harmonic depth at block 69383632. Candidate, not economic approval.
        HoodxClTwapV3 oracle = new HoodxClTwapV3(
            address(bytes20(hex"1ac9db4a2608ba45d6127b1737949b51bb54b7f3")),
            address(bytes20(hex"99e70a5b06215e5d2f3bec773b4f59c008fc1673")),
            address(bytes20(hex"11725976bf1f38c4ab78d1f480bc5883d70d9dc3")),
            token,
            address(bridgeOracle),
            1800,
            1800,
            2118471187028
        );
        V2Hop[] memory h = new V2Hop[](1);
        h[0].kind = 4;
        h[0].tokenIn = address(0);
        h[0].tokenOut = token;
        h[0].key = V2PoolKey(address(0), token, 8500, 85, address(0));
        uint256 minimum = (amount * 1e18 / oracle.value(token, 1e18)) * 991500 / 1000000 * 9700 / 10000;
        emit log_named_uint("NET protected buy minimum", minimum);
        IERC20(W).approve(address(ex), amount);
        uint256 got = ex.execute(W, token, amount, minimum, abi.encode(h), block.timestamp);
        emit log_named_uint("NET bought", got);
        minimum = oracle.value(token, got) * 991500 / 1000000 * 9700 / 10000;
        (h[0].tokenIn, h[0].tokenOut) = (h[0].tokenOut, h[0].tokenIn);
        IERC20(token).approve(address(ex), got);
        uint256 back = ex.execute(token, W, got, minimum, abi.encode(h), block.timestamp);
        emit log_named_uint("NET ETH returned", back);
        assertEq(IERC20(token).balanceOf(address(this)), 0);
        assertEq(IERC20(token).balanceOf(address(ex)), 0);
        assertEq(IERC20(W).balanceOf(address(ex)), 0);
    }

    function testClNetSmall() public {
        checkCl(0.0001 ether);
    }

    function testClNetMedium() public {
        checkCl(0.001 ether);
    }

    function testClNetLarge() public {
        checkCl(0.005 ether);
    }
}
