// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V2Hop, V2PoolKey} from "../contracts/v2/Types.sol";

library OfficialVaultCatalogV3 {
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 internal constant EVIDENCE = keccak256("HOODX_OFFICIAL_VAULT_ROUTES_V1_BLOCK_71790487");

    function count() internal pure returns (uint256) { return 47; }
    function evidence() internal pure returns (bytes32) { return EVIDENCE; }
    function fingerprint() internal pure returns (bytes32 digest) {
        digest = keccak256(abi.encode(EVIDENCE, count()));
        for (uint256 i; i < count(); ++i) { (address token, bytes memory buy, bytes memory sell) = routeFor(i); digest = keccak256(abi.encode(digest, token, keccak256(buy), keccak256(sell))); }
    }
    function bridge() internal pure returns (V2Hop memory h) { h.kind = 3; h.tokenIn = WETH; h.tokenOut = USDG; h.fee = 100; }
    function routeFor(uint256 i) internal pure returns (address token, bytes memory buy, bytes memory sell) {
        V2Hop memory asset;
        if (i == 0) { // MSTR
            token = address(bytes20(hex"ec262a75e413fafd0df80480274532c79d42da09")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 1) { // COIN
            token = address(bytes20(hex"6330d8c3178a418788df01a47479c0ce7ccf450b")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 2) { // CRCL
            token = address(bytes20(hex"df0992e440dd0be65bd8439b609d6d4366bf1cb5")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 3) { // GLXY
            token = address(bytes20(hex"2d427692e928fa156ec22acfabafa0447c5805b7")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 4) { // NVDA
            token = address(bytes20(hex"d0601ce157db5bdc3162bbac2a2c8af5320d9eec")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 5) { // AMD
            token = address(bytes20(hex"86923f96303d656e4aa86d9d42d1e57ad2023fdc")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 6) { // INTC
            token = address(bytes20(hex"c72b96e0e48ecd4dc75e1e45396e26300bc39681")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 7) { // TSM
            token = address(bytes20(hex"58ffe4a942d3885baa22d7520691f611ef09e7aa")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 8) { // MU
            token = address(bytes20(hex"ff080c8ce2e5feadaca0da81314ae59d232d4afd")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 9) { // AVGO
            token = address(bytes20(hex"156e175dd063a8ce274c50654ef40e0032b3fbcf")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 10) { // META
            token = address(bytes20(hex"c0d6457c16cc70d6790dd43521c899c87ce02f35")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 11) { // PLTR
            token = address(bytes20(hex"894e1ec2d74ffe5aef8dc8a9e84686accb964f2a")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 12) { // MSFT
            token = address(bytes20(hex"e93237c50d904957cf27e7b1133b510c669c2e74")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 13) { // GOOGL
            token = address(bytes20(hex"2e0847e8910a9732eb3fb1bb4b70a580adad4fe3")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 14) { // GME
            token = address(bytes20(hex"1b0e319c6a659f002271b69db8a7df2f911c153e")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 15) { // AMC
            token = address(bytes20(hex"05a3d1cd21d0c88145e82600e62e7e496e0f222b")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 16) { // RDDT
            token = address(bytes20(hex"05b37fb53a299a1b874a619e1c4c404d52c36f4c")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 17) { // DJT
            token = address(bytes20(hex"1d11f0496982706c5e14a514d4e79f2e6bde4516")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 18) { // BB
            token = address(bytes20(hex"48e39e56acdba37b09020c0b734a613c9a2f100a")); asset.kind = 4; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.key = V2PoolKey(address(bytes20(hex"48e39e56acdba37b09020c0b734a613c9a2f100a")), address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")), 7100, 71, address(bytes20(hex"0000000000000000000000000000000000000000")));
        }
        if (i == 19) { // RBLX
            token = address(bytes20(hex"f0c4bf4c582cb3836e98394b1d4e7b7281101be8")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 20) { // MRNA
            token = address(bytes20(hex"43b07d15ce533bec5476d70c22a78a1b2b662155")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 21) { // LLY
            token = address(bytes20(hex"8005d266423c7ea827372c9c864491e5786600ea")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 22) { // HIMS
            token = address(bytes20(hex"ccee82fe024c36fa15e1005ede3e9e4787e23d09")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 23) { // PFE
            token = address(bytes20(hex"7066a64c24e4206cd62e83bf198c1e7eb361f51e")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 24) { // JNJ
            token = address(bytes20(hex"03dfbbe0ac4e7bcdafd08ed41a400326b77d8c80")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 25) { // SHOP
            token = address(bytes20(hex"f53f66751b1eff985311b693531e3290f600c410")); asset.kind = 4; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.key = V2PoolKey(address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")), address(bytes20(hex"f53f66751b1eff985311b693531e3290f600c410")), 10000, 100, address(bytes20(hex"0000000000000000000000000000000000000000")));
        }
        if (i == 26) { // NET
            token = address(bytes20(hex"116f00968269b7bfbad4109ce591d6e74c0601d4")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 27) { // SNOW
            token = address(bytes20(hex"ba0cab75495255d0cb58e22b648bfed4ecd1f47e")); asset.kind = 4; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.key = V2PoolKey(address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")), address(bytes20(hex"ba0cab75495255d0cb58e22b648bfed4ecd1f47e")), 10000, 200, address(bytes20(hex"0000000000000000000000000000000000000000")));
        }
        if (i == 28) { // ORCL
            token = address(bytes20(hex"b0992820e760d836549ba69bc7598b4af75dee03")); asset.kind = 4; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.key = V2PoolKey(address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")), address(bytes20(hex"b0992820e760d836549ba69bc7598b4af75dee03")), 10000, 200, address(bytes20(hex"0000000000000000000000000000000000000000")));
        }
        if (i == 29) { // GLD
            token = address(bytes20(hex"c9a981fee1f9dec688bb123ccdecc63d0debfc4e")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 30) { // SLV
            token = address(bytes20(hex"411efb0e7f985935daec3d4c3ebaea0d0ad7d89f")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 31) { // USO
            token = address(bytes20(hex"a30fa36db767ad9ed3f7a60fc79526fb4d56d344")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 32) { // USAR
            token = address(bytes20(hex"d917b029c761d264c6a312bbbcda868658ef86a6")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 33) { // SPY
            token = address(bytes20(hex"117cc2133c37b721f49de2a7a74833232b3b4c0c")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 34) { // QQQ
            token = address(bytes20(hex"d5f3879160bc7c32ebb4dc785f8a4f505888de68")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 35) { // SGOV
            token = address(bytes20(hex"92fd66527192e3e61d4ddd13322aa222de86f9b5")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 36) { // VTI
            token = address(bytes20(hex"0594134df3f171a354d9c85ebd65b7a6148f6d09")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 37) { // SPCX
            token = address(bytes20(hex"4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 38) { // TSLA
            token = address(bytes20(hex"322f0929c4625ed5bad873c95208d54e1c003b2d")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 39) { // BA
            token = address(bytes20(hex"4d21483a44bf67a86b77e3da301411880797d452")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 40) { // LMT
            token = address(bytes20(hex"329fcaceb9ad6f9580dd5f643fed0646900d043c")); asset.kind = 4; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.key = V2PoolKey(address(bytes20(hex"329fcaceb9ad6f9580dd5f643fed0646900d043c")), address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")), 5000, 50, address(bytes20(hex"0000000000000000000000000000000000000000")));
        }
        if (i == 41) { // RCAT
            token = address(bytes20(hex"fde6b5d9bb419b10c23268c74e369abff39c0460")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 10000;
        }
        if (i == 42) { // AAPL
            token = address(bytes20(hex"af3d76f1834a1d425780943c99ea8a608f8a93f9")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 500;
        }
        if (i == 43) { // AMZN
            token = address(bytes20(hex"12f190a9f9d7d37a250758b26824b97ce941bf54")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 44) { // COST
            token = address(bytes20(hex"4ea005168d7f09a7a0ba9d1def21a479950e44c2")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 45) { // NFLX
            token = address(bytes20(hex"e0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        if (i == 46) { // LULU
            token = address(bytes20(hex"4e62068525ab11fe768e29dfd00ef909b9803016")); asset.kind = 3; asset.tokenIn = address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168")); asset.tokenOut = token; asset.fee = 3000;
        }
        require(token != address(0), "asset index");
        bool multi = asset.tokenIn == USDG;
        V2Hop[] memory b = new V2Hop[](multi ? 2 : 1);
        b[b.length - 1] = asset;
        if (multi) b[0] = bridge();
        buy = abi.encode(b);
        V2Hop[] memory s = new V2Hop[](b.length);
        for (uint256 j; j < b.length; ++j) { s[j] = b[b.length - 1 - j]; (s[j].tokenIn, s[j].tokenOut) = (s[j].tokenOut, s[j].tokenIn); }
        sell = abi.encode(s);
    }
    function vaultCount() internal pure returns (uint256) { return 10; }
    function vault(uint256 i) internal pure returns (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory weights) {
        if (i == 0) { slug = "chainfin"; symbol = "CHAINX"; cashBps = 2500; indexes = new uint256[](4); weights = new uint16[](4); indexes[0] = 0; weights[0] = 2500; indexes[1] = 1; weights[1] = 2500; indexes[2] = 2; weights[2] = 1750; indexes[3] = 3; weights[3] = 750; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 1) { slug = "siliconx"; symbol = "CHIPX"; cashBps = 2500; indexes = new uint256[](6); weights = new uint16[](6); indexes[0] = 4; weights[0] = 2160; indexes[1] = 5; weights[1] = 940; indexes[2] = 6; weights[2] = 760; indexes[3] = 7; weights[3] = 1415; indexes[4] = 8; weights[4] = 1025; indexes[5] = 9; weights[5] = 1200; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 2) { slug = "aistack"; symbol = "AIX"; cashBps = 2500; indexes = new uint256[](5); weights = new uint16[](5); indexes[0] = 4; weights[0] = 2045; indexes[1] = 10; weights[1] = 1235; indexes[2] = 11; weights[2] = 750; indexes[3] = 12; weights[3] = 1685; indexes[4] = 13; weights[4] = 1785; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 3) { slug = "retailx"; symbol = "CULTX"; cashBps = 2500; indexes = new uint256[](6); weights = new uint16[](6); indexes[0] = 14; weights[0] = 1255; indexes[1] = 15; weights[1] = 750; indexes[2] = 16; weights[2] = 1910; indexes[3] = 17; weights[3] = 750; indexes[4] = 18; weights[4] = 750; indexes[5] = 19; weights[5] = 2085; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 4) { slug = "healthx"; symbol = "HLTHX"; cashBps = 2500; indexes = new uint256[](5); weights = new uint16[](5); indexes[0] = 20; weights[0] = 1000; indexes[1] = 21; weights[1] = 2500; indexes[2] = 22; weights[2] = 750; indexes[3] = 23; weights[3] = 750; indexes[4] = 24; weights[4] = 2500; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 5) { slug = "cloudx"; symbol = "CLOUDX"; cashBps = 2500; indexes = new uint256[](5); weights = new uint16[](5); indexes[0] = 25; weights[0] = 1400; indexes[1] = 26; weights[1] = 750; indexes[2] = 27; weights[2] = 750; indexes[3] = 28; weights[3] = 2100; indexes[4] = 12; weights[4] = 2500; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 6) { slug = "realx"; symbol = "REALX"; cashBps = 2500; indexes = new uint256[](4); weights = new uint16[](4); indexes[0] = 29; weights[0] = 2500; indexes[1] = 30; weights[1] = 2500; indexes[2] = 31; weights[2] = 750; indexes[3] = 32; weights[3] = 1750; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 7) { slug = "corex"; symbol = "COREX"; cashBps = 2500; indexes = new uint256[](5); weights = new uint16[](5); indexes[0] = 33; weights[0] = 2125; indexes[1] = 34; weights[1] = 1675; indexes[2] = 35; weights[2] = 795; indexes[3] = 29; weights[3] = 925; indexes[4] = 36; weights[4] = 1980; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 8) { slug = "frontierx"; symbol = "EDGE"; cashBps = 2500; indexes = new uint256[](6); weights = new uint16[](6); indexes[0] = 37; weights[0] = 2500; indexes[1] = 38; weights[1] = 2000; indexes[2] = 39; weights[2] = 750; indexes[3] = 40; weights[3] = 750; indexes[4] = 41; weights[4] = 750; indexes[5] = 32; weights[5] = 750; return (slug, symbol, cashBps, indexes, weights); }
        if (i == 9) { slug = "consumerx"; symbol = "ICONX"; cashBps = 2500; indexes = new uint256[](6); weights = new uint16[](6); indexes[0] = 42; weights[0] = 2500; indexes[1] = 43; weights[1] = 1480; indexes[2] = 44; weights[2] = 750; indexes[3] = 10; weights[3] = 1270; indexes[4] = 45; weights[4] = 750; indexes[5] = 46; weights[5] = 750; return (slug, symbol, cashBps, indexes, weights); }
        revert("vault index");
    }
}
