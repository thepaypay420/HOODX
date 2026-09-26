// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V2Hop, V2PoolKey} from "../contracts/v2/Types.sol";

/// @notice Exact route manifest for the reviewed 21-asset 696X successor canary.
/// Bridge fees are pinned so live approvals cannot drift from the routes tested on the fork.
library ProportionalWatchlistV3 {
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;

    bytes32 internal constant EVIDENCE = keccak256("HOODX_696X_WATCHLIST_ROUTE_REVIEW_V2_2026-09-26");

    function count() internal pure returns (uint256) {
        return 21;
    }

    /// @dev 25% remains in cash. Three 3.58% sleeves plus eighteen 3.57% sleeves total 75%.
    function targetFor(uint256 i) internal pure returns (uint16) {
        require(i < count(), "asset index");
        return i < 3 ? 358 : 357;
    }

    function evidence() internal pure returns (bytes32) {
        return EVIDENCE;
    }

    function fingerprint() internal pure returns (bytes32 digest) {
        digest = keccak256(abi.encode(EVIDENCE, count()));
        for (uint256 i; i < count(); ++i) {
            (address token, bytes memory buy, bytes memory sell) = routeFor(i);
            digest = keccak256(abi.encode(digest, token, keccak256(buy), keccak256(sell)));
        }
    }

    function bridge(address quote) internal pure returns (V2Hop memory h) {
        h.kind = 3;
        h.tokenIn = WETH;
        h.tokenOut = quote;
        if (quote == USDG) h.fee = 100;
        else if (quote == SPY || quote == SPCX) h.fee = 500;
        else revert("unsupported bridge");
    }

    function routeFor(uint256 i) internal pure returns (address token, bytes memory buy, bytes memory sell) {
        V2Hop memory h;
        if (i == 0) {
            h.tokenOut = address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571"));
            h.kind = 3;
            h.tokenIn = WETH;
            h.fee = 3000;
        }
        if (i == 1) {
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
        }
        if (i == 2) {
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
        }
        if (i == 3) {
            h.tokenOut = address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870"));
            h.kind = 3;
            h.tokenIn = WETH;
            h.fee = 10000;
        }
        if (i == 4) {
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
        }
        if (i == 5) {
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
        }
        if (i == 6) {
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
        }
        if (i == 7) {
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
        }
        if (i == 8) {
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
        }
        if (i == 9) {
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
        }
        if (i == 10) {
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
        }
        if (i == 11) {
            h.tokenOut = address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1"));
            h.kind = 3;
            h.tokenIn = WETH;
            h.fee = 10000;
        }
        if (i == 12) {
            h.tokenOut = address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f"));
            h.kind = 5;
            h.tokenIn = WETH;
        }
        if (i == 13) {
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
        }
        if (i == 14) {
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
        }
        if (i == 15) {
            h.tokenOut = address(bytes20(hex"91a2dae9699f0b82540b5886b0d8759c22820ba3"));
            h.kind = 3;
            h.tokenIn = WETH;
            h.fee = 10000;
        }
        if (i == 16) {
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
        }
        if (i == 17) {
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
        }
        if (i == 18) {
            h.tokenOut = address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f"));
            h.kind = 3;
            h.tokenIn = WETH;
            h.fee = 100;
        }
        if (i == 19) {
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
        }
        if (i == 20) {
            h.tokenOut = address(bytes20(hex"7a8cda6a1cab3e5146cd13cb623a3bb284fb4ad1"));
            h.kind = 4;
            h.tokenIn = address(bytes20(hex"0000000000000000000000000000000000000000"));
            h.key = V2PoolKey(
                address(bytes20(hex"0000000000000000000000000000000000000000")),
                address(bytes20(hex"7a8cda6a1cab3e5146cd13cb623a3bb284fb4ad1")),
                0,
                200,
                address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"))
            );
        }
        token = h.tokenOut;
        bool multi = h.tokenIn != WETH && h.tokenIn != address(0);
        V2Hop[] memory b = new V2Hop[](multi ? 2 : 1);
        b[b.length - 1] = h;
        if (multi) b[0] = bridge(h.tokenIn);
        buy = abi.encode(b);
        V2Hop[] memory r = new V2Hop[](b.length);
        for (uint256 j; j < b.length; ++j) {
            r[j] = b[b.length - 1 - j];
            (r[j].tokenIn, r[j].tokenOut) = (r[j].tokenOut, r[j].tokenIn);
        }
        sell = abi.encode(r);
    }
}
