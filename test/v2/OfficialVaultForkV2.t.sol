// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {PinnedV2Config} from "../../script/PinnedV2Config.sol";
import {RouterForkV2Test, ILegacyV2} from "./RouterForkV2.t.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxSeededPolicyV2, HoodxOfficialFactoryV2} from "../../contracts/v2/HoodxBootstrapV2.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniV3Pool} from "../../contracts/UniTwap.sol";

interface ILegacySettingsV2 {
    function targetBps(address) external view returns (uint16);
    function creatorFeeBps() external view returns (uint16);
}

contract OfficialVaultForkV2Test is RouterForkV2Test {
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function testForkOfficialFullStackExitSafety() public {
        _runOfficial(false);
    }

    function testForkOfficialNormalExitAtRecordedStableBlock() public {
        string memory saved = vm.envOr("HOODX_FORK_BLOCK", string("0"));
        vm.setEnv("HOODX_FORK_BLOCK", "67591644");
        setUp();
        vm.setEnv("HOODX_FORK_BLOCK", saved);
        _runOfficial(true);
    }

    function _runOfficial(bool requireNormal) internal {
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
        for (uint256 i; i < 15; ++i) {
            address old = i < 10 ? MEME : FAANG;
            uint256 index = i < 10 ? i : i - 10;
            (address t, bytes memory buy, bytes memory sell) = routes(old, index);
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
            seeds[i] = HoodxSeededPolicyV2.Seed(t, address(oracle), buy, sell, keccak256("FORK EXPERIMENT ONLY"));
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
        HoodxSeededPolicyV2 policy = new HoodxSeededPolicyV2(CURATOR, address(ex), seeds);
        HoodxIndexV2 impl = new HoodxIndexV2(address(policy));
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
        HoodxIndexV2.Init memory f =
            HoodxIndexV2.Init(CURATOR, CURATOR, CURATOR, CURATOR, "FAANG X", "FAANGX", 0, 10, 2500, 0.02 ether, "");
        HoodxOfficialFactoryV2 factory = new HoodxOfficialFactoryV2(
            CURATOR,
            CURATOR,
            address(impl),
            HoodxOfficialFactoryV2.Basket(m, memeIds, memeWeights),
            HoodxOfficialFactoryV2.Basket(f, faangIds, faangWeights)
        );
        assertEq(factory.owner(), CURATOR);
        assertEq(policy.owner(), CURATOR);
        cycle(HoodxIndexV2(payable(factory.bySlug("696x"))), 0.08 ether, requireNormal);
        cycle(HoodxIndexV2(payable(factory.bySlug("faangx"))), 0.02 ether, requireNormal);
    }

    function cycle(HoodxIndexV2 v, uint256 capital, bool requireNormal) internal {
        assertEq(v.owner(), CURATOR);
        assertEq(v.creator(), CURATOR);
        assertEq(v.creatorRecipient(), CURATOR);
        uint256 beforeEth = address(this).balance;
        uint256 gasStart = gasleft();
        uint256 shares = v.deposit{value: capital}(1e12, block.timestamp);
        emit log_named_uint("first deposit gas", gasStart - gasleft());
        address[] memory ts = v.constituents();
        for (uint256 i; i < ts.length; ++i) {
            if (v.targetBps(ts[i]) > 0) assertGt(IERC20(ts[i]).balanceOf(address(v)), 0, "intended buy deferred");
        }
        assertGt(v.totalAssets(), capital * 95 / 100);
        bool normal = true;
        gasStart = gasleft();
        try v.withdraw(shares / 2, capital * 45 / 100, block.timestamp) {
            emit log_named_uint("partial withdraw gas", gasStart - gasleft());
        } catch {
            require(!requireNormal, "required normal partial exit failed");
            assertEq(v.balanceOf(address(this)), shares, "failed withdrawal burned shares");
            normal = false;
        }
        if (normal) {
            uint256 remaining = v.balanceOf(address(this));
            gasStart = gasleft();
            try v.withdraw(remaining, capital * 45 / 100, block.timestamp) {
                emit log_named_uint("final withdraw gas", gasStart - gasleft());
            } catch {
                require(!requireNormal, "required normal final exit failed");
                assertEq(v.balanceOf(address(this)), remaining, "failed final withdrawal burned shares");
                normal = false;
            }
        }
        if (!normal) {
            emit log_string("Normal exit protected by minimum output; verified direct redemption instead. NOT a normal-canary pass.");
            uint256[] memory beforeTokens = new uint256[](ts.length);
            for (uint256 i; i < ts.length; ++i) {
                beforeTokens[i] = IERC20(ts[i]).balanceOf(address(this));
            }
            v.emergencyRedeemInKind(v.balanceOf(address(this)), address(this));
            for (uint256 i; i < ts.length; ++i) {
                if (v.targetBps(ts[i]) > 0) assertGt(IERC20(ts[i]).balanceOf(address(this)), beforeTokens[i]);
            }
        }
        assertEq(v.totalSupply(), 0);
        assertEq(v.totalAssets(), 0);
        assertEq(address(v).balance, 0);
        assertEq(IERC20(W).balanceOf(address(v)), 0);
        for (uint256 i; i < ts.length; ++i) {
            assertEq(IERC20(ts[i]).balanceOf(address(v)), 0);
        }
        if (normal) assertGt(address(this).balance, beforeEth - capital / 10);
    }
}
