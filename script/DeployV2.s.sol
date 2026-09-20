// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {v2BuildFingerprint} from "./V2Build.sol";
import {PinnedV2Config} from "./PinnedV2Config.sol";
import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxExecutorV2} from "../contracts/v2/HoodxExecutorV2.sol";
import {HoodxTwapV2} from "../contracts/v2/HoodxTwapV2.sol";
import {HoodxSeededPolicyV2, HoodxOfficialFactoryV2} from "../contracts/v2/HoodxBootstrapV2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";
import {V2Hop, V2PoolKey} from "../contracts/v2/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniV3Pool} from "../contracts/UniTwap.sol";

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

interface ILegacySettingsV2 {
    function targetBps(address) external view returns (uint16);
    function creatorFeeBps() external view returns (uint16);
}

/// @notice Run without --broadcast to estimate. Live execution is deliberately fail-closed.
contract DeployV2 is Script {
    address constant W = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant STATE = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant MEME = 0xAC45f6FffB17645057aa783b72b2Ce78BD7A1a3A;
    address constant FAANG = 0x037c116d7C09Ed4D2733Eb628488ab9c0394353f;

    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    HoodxExecutorV2 ex;
    HoodxSeededPolicyV2 policy;
    HoodxIndexV2 impl;
    HoodxOfficialFactoryV2 factory;

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        require(vm.envOr("CURATOR_EOA", CURATOR) == CURATOR, "curator mismatch");
        require(
            ROUTER.codehash == 0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde,
            "router bytecode changed"
        );
        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(vm.envOr("HOODX_REVIEWED_BUILD", bytes32(0)) == buildFingerprint(), "reviewed build mismatch");
            string memory stage = vm.envOr("HOODX_DEPLOY_STAGE", string("canary"));
            require(
                keccak256(bytes(stage)) == keccak256("canary") || keccak256(bytes(stage)) == keccak256("production"),
                "unknown stage"
            );
            if (keccak256(bytes(stage)) == keccak256("production")) {
                require(vm.envOr("HOODX_CANARY_RECEIPTS_VERIFIED", false), "live canary receipts not verified");
                require(vm.envOr("HOODX_CANARY_BUILD", bytes32(0)) == buildFingerprint(), "canary build mismatch");
                _verifyEmptyCanary(vm.envAddress("HOODX_CANARY_FACTORY"));
            }
        }
        console2.log("Reviewed build fingerprint");
        console2.logBytes32(buildFingerprint());
        bytes32 evidence = PinnedV2Config.EVIDENCE;
        vm.startBroadcast(DEPLOYER);
        ex = new HoodxExecutorV2(W, ROUTER, PERMIT, FACTORY, STATE, new address[](0));
        address[] memory refs = new address[](15);
        refs[0] = address(bytes20(hex"ed50bdeea8adc232f159486192a4157281d722ff"));
        refs[1] = address(bytes20(hex"c4a21f9d6485fc5893dd4a491b320a83daf4da1d"));
        refs[2] = address(bytes20(hex"a70fc67c9f69da90b63a0e4c05d229954574e313"));
        refs[3] = address(bytes20(hex"97bcdd384fc144899545deb749b6daf2aa52a2c5"));
        refs[4] = address(bytes20(hex"d29893ffac8b29ec4db2cfe0cdb3fe1377c028ff"));
        refs[5] = address(bytes20(hex"9cd74d5980a4bf60408b9ba2b0f6a3d368ebf594"));
        refs[6] = address(bytes20(hex"d64fbda67e1015df43fa5e49f02ca844729e5f94"));
        refs[7] = address(bytes20(hex"4ef94cd1ab45ebbb50f9e73cd6e45c5027caa3f7"));
        refs[8] = address(bytes20(hex"42b19e5e3f28c4148c518444546f102f6ba87ab1"));
        refs[9] = address(bytes20(hex"6d489e07d7fe2b4bc5749f75d56337888b68a34a"));
        refs[10] = address(bytes20(hex"a4bdb396a69617eb7f70e2cc1ef526f7340b1b0d"));
        refs[11] = address(bytes20(hex"8ac92da74ab5f3b1d024dc1943ad7e15dc4179ef"));
        refs[12] = address(bytes20(hex"8bb3514e2204e1cdf3ac149efee7ff04d91b719f"));
        refs[13] = address(bytes20(hex"59895c0302f41aeaa129d2fa2442cec01e7ef45e"));
        refs[14] = address(bytes20(hex"8c2b4303fa0b99d07a5d3e9411497a277e65b673"));
        HoodxSeededPolicyV2.Seed[] memory seeds = new HoodxSeededPolicyV2.Seed[](15);
        bytes32[] memory memeIds = new bytes32[](10);
        bytes32[] memory faangIds = new bytes32[](5);
        uint16[] memory memeWeights = new uint16[](10);
        uint16[] memory faangWeights = new uint16[](5);
        address[] memory expected = new address[](15);
        expected[0] = address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571"));
        expected[1] = address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18"));
        expected[2] = address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4"));
        expected[3] = address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18"));
        expected[4] = address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870"));
        expected[5] = address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50"));
        expected[6] = address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791"));
        expected[7] = address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1"));
        expected[8] = address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c"));
        expected[9] = address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506"));
        expected[10] = address(bytes20(hex"c0d6457c16cc70d6790dd43521c899c87ce02f35"));
        expected[11] = address(bytes20(hex"12f190a9f9d7d37a250758b26824b97ce941bf54"));
        expected[12] = address(bytes20(hex"af3d76f1834a1d425780943c99ea8a608f8a93f9"));
        expected[13] = address(bytes20(hex"e0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8"));
        expected[14] = address(bytes20(hex"2e0847e8910a9732eb3fb1bb4b70a580adad4fe3"));
        for (uint256 i; i < 15; ++i) {
            address old = i < 10 ? MEME : FAANG;
            uint256 index = i < 10 ? i : i - 10;
            (address t, bytes memory buy, bytes memory sell) = routes(old, index);
            require(t == expected[i], "legacy constituent changed");
            IUniV3Pool p = IUniV3Pool(refs[i]);
            address q = p.token0() == t ? p.token1() : p.token0();
            address bridge = q == W ? address(0) : ILegacyV2(old).quoteBridgeV3(q);
            (
                address pinnedToken,
                address pinnedPool,
                uint128 liq,
                uint128 bridgeDepth,
                uint16 pinnedWeight,
                bytes32 pinnedRoute
            ) = PinnedV2Config.asset(i);
            require(t == pinnedToken && refs[i] == pinnedPool, "manifest identity mismatch");
            require(keccak256(abi.encode(buy, sell)) == pinnedRoute, "manifest route mismatch");
            if (bridge != address(0)) {
                require(bridge == address(bytes20(hex"52e65b17fb6e5ba00ed806f37afcd2daa50271ca")), "bridge mismatch");
            }
            HoodxTwapV2 oracle = new HoodxTwapV2(FACTORY, t, W, refs[i], bridge, 1800, liq, bridgeDepth);
            seeds[i] = HoodxSeededPolicyV2.Seed(t, address(oracle), buy, sell, evidence);
            bytes32 id = keccak256(abi.encode(t, address(oracle), buy, sell, seeds[i].evidence));
            uint16 weight = pinnedWeight;
            if (i < 10) {
                memeIds[i] = id;
                memeWeights[i] = weight;
            } else {
                faangIds[i - 10] = id;
                faangWeights[i - 10] = weight;
            }
        }
        policy = new HoodxSeededPolicyV2(CURATOR, address(ex), seeds);
        impl = new HoodxIndexV2(address(policy));
        HoodxIndexV2.Init memory m = HoodxIndexV2.Init(
            CURATOR,
            CURATOR,
            CURATOR,
            CURATOR,
            "696x",
            "696X",
            40,
            10,
            2500,
            0.08 ether,
            "https://www.xhoodindex.com/curators/696_eth.jpg"
        );
        HoodxIndexV2.Init memory f = HoodxIndexV2.Init(
            CURATOR,
            CURATOR,
            CURATOR,
            CURATOR,
            "FAANG X",
            "FAANGX",
            0,
            10,
            2500,
            0.02 ether,
            "https://www.xhoodindex.com/curators/faangx.png"
        );
        factory = new HoodxOfficialFactoryV2(
            CURATOR,
            CURATOR,
            address(impl),
            HoodxOfficialFactoryV2.Basket(m, memeIds, memeWeights),
            HoodxOfficialFactoryV2.Basket(f, faangIds, faangWeights)
        );

        vm.stopBroadcast();
        console2.log("Executor", address(ex));
        console2.log("Policy", address(policy));
        console2.log("Implementation", address(impl));
        console2.log("Factory", address(factory));
        console2.log("696X", factory.bySlug("696x"));
        console2.log("FAANGX", factory.bySlug("faangx"));
        require(factory.owner() == CURATOR && policy.owner() == CURATOR, "incorrect roles");
        require(HoodxIndexV2(payable(factory.bySlug("696x"))).totalAssets() == 0, "696X not empty");
        require(HoodxIndexV2(payable(factory.bySlug("faangx"))).totalAssets() == 0, "FAANGX not empty");
    }

    function buildFingerprint() public pure returns (bytes32) {
        return v2BuildFingerprint();
    }

    function _verifyEmptyCanary(address candidate) private view {
        HoodxOfficialFactoryV2 c = HoodxOfficialFactoryV2(candidate);
        require(c.owner() == CURATOR && c.treasury() == CURATOR, "canary roles mismatch");
        for (uint256 i; i < 2; ++i) {
            HoodxIndexV2 v = HoodxIndexV2(payable(c.bySlug(i == 0 ? "696x" : "faangx")));
            require(
                v.owner() == CURATOR && v.creator() == CURATOR && v.creatorRecipient() == CURATOR
                    && v.treasury() == CURATOR,
                "vault roles mismatch"
            );
            require(v.totalSupply() == 0 && v.totalAssets() == 0 && address(v).balance == 0, "canary not empty");
            require(IERC20(W).balanceOf(address(v)) == 0, "canary cash remains");
            address[] memory ts = v.constituents();
            require(ts.length == (i == 0 ? 10 : 5), "canary configuration mismatch");
            for (uint256 j; j < ts.length; ++j) {
                require(IERC20(ts[j]).balanceOf(address(v)) == 0, "canary assets remain");
            }
        }
    }

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
}
