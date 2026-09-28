// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {V2Hop, V2PoolKey} from "../../contracts/v2/Types.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxFeeModelV4} from "../../contracts/v3/HoodxFeeModelV4.sol";

contract EmptyFeeV4 {}

contract ExecutorFeeV4 {
    address public immutable weth;
    constructor(address weth_) { weth = weth_; }
}

contract DopplerFeeV4 {
    address public immutable poolManager;
    struct State {
        address numeraire;
        address nested;
        bytes graduationData;
        uint8 status;
        V2PoolKey key;
    }
    mapping(address => State) internal states;

    constructor(address manager) { poolManager = manager; }

    function set(address asset, address numeraire, address nested, uint8 status, V2PoolKey memory key) external {
        states[asset] = State(numeraire, nested, "", status, key);
    }

    function getState(address asset)
        external
        view
        returns (address, uint256, address, bytes memory, uint8, V2PoolKey memory, int24)
    {
        State storage s = states[asset];
        return (s.numeraire, 1, s.nested, s.graduationData, s.status, s.key, -887000);
    }
}

contract RehypeFeeV4 {
    address public immutable INITIALIZER;
    address public immutable poolManager;
    struct Info { address asset; address numeraire; address buyback; }
    struct Schedule { uint32 start; uint24 startFee; uint24 endFee; uint24 lastFee; uint32 duration; }
    mapping(bytes32 => Info) internal infos;
    mapping(bytes32 => Schedule) internal schedules;

    constructor(address initializer, address manager) {
        INITIALIZER = initializer;
        poolManager = manager;
    }

    function set(bytes32 id, address asset, address numeraire, uint32 start, uint24 startFee, uint24 endFee, uint32 duration)
        external
    {
        infos[id] = Info(asset, numeraire, address(0));
        schedules[id] = Schedule(start, startFee, endFee, startFee, duration);
    }

    function getPoolInfo(bytes32 id) external view returns (address, address, address) {
        Info storage i = infos[id];
        return (i.asset, i.numeraire, i.buyback);
    }

    function getFeeSchedule(bytes32 id) external view returns (uint32, uint24, uint24, uint24, uint32) {
        Schedule storage s = schedules[id];
        return (s.start, s.startFee, s.endFee, s.lastFee, s.duration);
    }
}

contract FeeModelV4Test is Test {
    address constant WETH = address(0x100);
    address constant ASSET = address(0x200);
    address constant ASSET_TWO = address(0x300);
    EmptyFeeV4 manager;
    ExecutorFeeV4 executor;
    DopplerFeeV4 doppler;
    RehypeFeeV4 rehype;
    HoodxFeeModelV4 model;

    function setUp() public {
        manager = new EmptyFeeV4();
        executor = new ExecutorFeeV4(WETH);
        doppler = new DopplerFeeV4(address(manager));
        rehype = new RehypeFeeV4(address(doppler), address(manager));
        model = new HoodxFeeModelV4(
            address(executor), address(0), address(0), address(manager), address(doppler), address(rehype)
        );
    }

    function testReviewedFamilyAllowsImmediateNewAssetsAfterLaunchFeeDecays() public {
        vm.warp(1_000);
        bytes memory first = _configure(ASSET, 900, 800_000, 17_500, 14);
        bytes memory second = _configure(ASSET_TWO, 900, 800_000, 17_500, 14);
        doppler.set(ASSET_TWO, WETH, address(rehype), 1, _key(ASSET_TWO));
        assertEq(model.factor(first), 884_250_000_000_000_000);
        assertEq(model.factor(second), 884_250_000_000_000_000);
    }

    function testRejectsUnsafeOpeningFeeThenAcceptsWithoutCooldown() public {
        vm.warp(1_000);
        bytes memory route = _configure(ASSET, 1_000, 800_000, 17_500, 14);
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(route);
        vm.warp(1_014);
        assertEq(model.factor(route), 884_250_000_000_000_000);
    }

    function testRejectsUnreviewedNestedHook() public {
        vm.warp(1_000);
        bytes memory route = _configure(ASSET, 900, 17_500, 17_500, 0);
        doppler.set(ASSET, WETH, address(new EmptyFeeV4()), 2, _key(ASSET));
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(route);
    }

    function testRejectsChangedReviewedBytecode() public {
        vm.warp(1_000);
        bytes memory route = _configure(ASSET, 900, 17_500, 17_500, 0);
        vm.etch(address(rehype), hex"60006000fd");
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(route);
    }

    function testRejectsMismatchedPoolIdentityAndStatus() public {
        vm.warp(1_000);
        bytes memory route = _configure(ASSET, 900, 17_500, 17_500, 0);
        doppler.set(ASSET, WETH, address(rehype), 3, _key(ASSET));
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(route);

        doppler.set(ASSET, WETH, address(rehype), 2, _key(ASSET_TWO));
        vm.expectRevert(HoodxFeeModelV3.UnsupportedFee.selector);
        model.factor(route);
    }

    function testExistingFixedFeeRoutesStillUseV3Rules() public view {
        V2Hop[] memory hops = new V2Hop[](1);
        hops[0].kind = 3;
        hops[0].fee = 3_000;
        assertEq(model.factor(abi.encode(hops)), 997_000_000_000_000_000);
    }

    function _configure(address asset, uint32 start, uint24 startFee, uint24 endFee, uint32 duration)
        private
        returns (bytes memory route)
    {
        V2PoolKey memory key = _key(asset);
        doppler.set(asset, WETH, address(rehype), 2, key);
        rehype.set(keccak256(abi.encode(key)), asset, WETH, start, startFee, endFee, duration);
        V2Hop[] memory hops = new V2Hop[](1);
        hops[0].kind = 4;
        hops[0].tokenIn = WETH;
        hops[0].tokenOut = asset;
        hops[0].key = key;
        return abi.encode(hops);
    }

    function _key(address asset) private view returns (V2PoolKey memory) {
        return V2PoolKey(WETH, asset, model.DYNAMIC_FEE_FLAG(), 200, address(doppler));
    }
}
