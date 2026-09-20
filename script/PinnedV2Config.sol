// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Generated from the candidate routing manifest; release remains gated.
library PinnedV2Config {
    bytes32 internal constant EVIDENCE = 0x0e1af6be6de7cd0e1a3ef8286a0eb1cbd052a0850a08a840d79dca3b5c072f70;

    function asset(uint256 i)
        internal
        pure
        returns (
            address token,
            address referencePool,
            uint128 depth,
            uint128 bridgeDepth,
            uint16 weight,
            bytes32 routeHash
        )
    {
        if (i == 0) {
            return (
                address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571")),
                address(bytes20(hex"ed50bdeea8adc232f159486192a4157281d722ff")),
                138751355470392477324310,
                0,
                1254,
                0x99289ba2a0dece488452e12f866b711ee742db519d82d06042c4102c2d7c8ca5
            );
        }
        if (i == 1) {
            return (
                address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),
                address(bytes20(hex"c4a21f9d6485fc5893dd4a491b320a83daf4da1d")),
                119114027662931544165186,
                0,
                1252,
                0x42528e81450a0e7ec3be9f6cceb2e0a2e7558a6c7abc9f9330442c64fa57b924
            );
        }
        if (i == 2) {
            return (
                address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),
                address(bytes20(hex"a70fc67c9f69da90b63a0e4c05d229954574e313")),
                90792159285378332229662,
                0,
                1252,
                0x3aa9dfc053864c7a33eb9d45f30437974cc7c99d32f7cc669d04c796be25f170
            );
        }
        if (i == 3) {
            return (
                address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),
                address(bytes20(hex"97bcdd384fc144899545deb749b6daf2aa52a2c5")),
                16229335552032950196823,
                0,
                641,
                0xf27141c6494ad659ed6eb03e03cd44064a69e73fcd26fe3ce7695c54b3454e15
            );
        }
        if (i == 4) {
            return (
                address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870")),
                address(bytes20(hex"d29893ffac8b29ec4db2cfe0cdb3fe1377c028ff")),
                103230725373255286024212,
                0,
                863,
                0xb93c3a0024a2ae22ad006bbb8042d85ac7ea2b3516be05de5b82c1540210d2da
            );
        }
        if (i == 5) {
            return (
                address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),
                address(bytes20(hex"9cd74d5980a4bf60408b9ba2b0f6a3d368ebf594")),
                33946211582254223068020,
                0,
                867,
                0xcfdc5d2447ed81a94b8f66dede9c0b942e8cae3b21743efe7369cdd00b5f9242
            );
        }
        if (i == 6) {
            return (
                address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),
                address(bytes20(hex"d64fbda67e1015df43fa5e49f02ca844729e5f94")),
                106085230634528006086092,
                0,
                730,
                0x0b728aa545c8de5fc4dd990b4b3b49fda255db7e5f269bc490cdea26cc121c28
            );
        }
        if (i == 7) {
            return (
                address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1")),
                address(bytes20(hex"4ef94cd1ab45ebbb50f9e73cd6e45c5027caa3f7")),
                1911523244372611338313,
                0,
                0,
                0x3a5b113ee500cb83a045ec3be515f5cfd39f9005b8322f936aec9823b917617d
            );
        }
        if (i == 8) {
            return (
                address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),
                address(bytes20(hex"42b19e5e3f28c4148c518444546f102f6ba87ab1")),
                10547503988287578108863,
                0,
                641,
                0x49eb8f7a58b047fdb3be038400438e9e604bb6ef3df6d7e927173ca38b66572a
            );
        }
        if (i == 9) {
            return (
                address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506")),
                address(bytes20(hex"6d489e07d7fe2b4bc5749f75d56337888b68a34a")),
                28461167245131732876426,
                0,
                0,
                0x2bf00bf0b457212a2aaaa59f5d01df4ed1b5354659f0339710746ee599ec0643
            );
        }
        if (i == 10) {
            return (
                address(bytes20(hex"c0d6457c16cc70d6790dd43521c899c87ce02f35")),
                address(bytes20(hex"a4bdb396a69617eb7f70e2cc1ef526f7340b1b0d")),
                2281990484876342511930,
                0,
                1500,
                0x3ff1036a65ce7f61e3ea97073b2462099bef30e62e8ecfe96522188b3543a7d5
            );
        }
        if (i == 11) {
            return (
                address(bytes20(hex"12f190a9f9d7d37a250758b26824b97ce941bf54")),
                address(bytes20(hex"8ac92da74ab5f3b1d024dc1943ad7e15dc4179ef")),
                1239263804971297627,
                2631289198634062971,
                1500,
                0x58e3502153ceabad81e4727a669a73dd2dcf76028bac61ec5cb3555cddbb854b
            );
        }
        if (i == 12) {
            return (
                address(bytes20(hex"af3d76f1834a1d425780943c99ea8a608f8a93f9")),
                address(bytes20(hex"8bb3514e2204e1cdf3ac149efee7ff04d91b719f")),
                1770718968246383499949,
                0,
                1500,
                0x434a15a197ab3a9542c750a0414f97c1336cd444fd6bc6c4f7feffe00f9bf5b2
            );
        }
        if (i == 13) {
            return (
                address(bytes20(hex"e0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8")),
                address(bytes20(hex"59895c0302f41aeaa129d2fa2442cec01e7ef45e")),
                166595242543676828,
                2631289198634062971,
                1500,
                0x8031a88c902ce36e146ea99c849465bebd2698f9d206432685f789833e73c59f
            );
        }
        if (i == 14) {
            return (
                address(bytes20(hex"2e0847e8910a9732eb3fb1bb4b70a580adad4fe3")),
                address(bytes20(hex"8c2b4303fa0b99d07a5d3e9411497a277e65b673")),
                6227104043496007070054,
                0,
                1500,
                0x868e39db8dbe11e9069a10dc68c16e55cded93120b1e0cddc4cfbf7e675108c2
            );
        }
        revert("unknown asset");
    }
}
