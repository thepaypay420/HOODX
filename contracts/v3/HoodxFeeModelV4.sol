// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {V2Hop, V2PoolKey} from "../v2/Types.sol";
import {HoodxFeeModelV3} from "./HoodxFeeModelV3.sol";

interface IDopplerInitializerFeeV4 {
    function poolManager() external view returns (address);
    function getState(address asset)
        external
        view
        returns (
            address numeraire,
            uint256 totalTokensOnBondingCurve,
            address dopplerHook,
            bytes memory graduationDopplerHookCalldata,
            uint8 status,
            V2PoolKey memory poolKey,
            int24 farTick
        );
}

interface IRehypeFeeV4 {
    function INITIALIZER() external view returns (address);
    function poolManager() external view returns (address);
    function getPoolInfo(bytes32 poolId) external view returns (address asset, address numeraire, address buybackDst);
    function getFeeSchedule(bytes32 poolId)
        external
        view
        returns (uint32 startingTime, uint24 startFee, uint24 endFee, uint24 lastFee, uint32 durationSeconds);
}

interface IExecutorIdentityFeeV4 {
    function weth() external view returns (address);
}

/// @notice Fee model for the reviewed Doppler/Rehype route family.
/// A hook implementation is reviewed once. New assets using the exact same
/// immutable outer and nested hook bytecode can then be admitted immediately.
/// Runtime state is still checked on every quote and execution.
contract HoodxFeeModelV4 is HoodxFeeModelV3 {
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 public constant MAX_DOPPLER_LP_FEE = 100_000; // Outer hook hard cap: 10%.
    uint24 public constant MAX_REHYPE_FEE = 100_000; // HOODX hook-fee cap: 10%.
    uint8 public constant INITIALIZED = 1;
    uint8 public constant LOCKED = 2;

    address public immutable poolManager;
    address public immutable dopplerInitializer;
    address public immutable rehypeHook;
    bytes32 public immutable dopplerInitializerHash;
    bytes32 public immutable rehypeHookHash;

    constructor(
        address executor_,
        address quotronHook_,
        address ponsHook_,
        address poolManager_,
        address dopplerInitializer_,
        address rehypeHook_
    ) HoodxFeeModelV3(executor_, quotronHook_, ponsHook_) {
        if (
            poolManager_.code.length == 0 || dopplerInitializer_.code.length == 0 || rehypeHook_.code.length == 0
                || IDopplerInitializerFeeV4(dopplerInitializer_).poolManager() != poolManager_
                || IRehypeFeeV4(rehypeHook_).poolManager() != poolManager_
                || IRehypeFeeV4(rehypeHook_).INITIALIZER() != dopplerInitializer_
        ) revert UnsupportedFee();
        poolManager = poolManager_;
        dopplerInitializer = dopplerInitializer_;
        rehypeHook = rehypeHook_;
        dopplerInitializerHash = dopplerInitializer_.codehash;
        rehypeHookHash = rehypeHook_.codehash;
    }

    function factor(bytes memory route) public view override returns (uint256 retained) {
        V2Hop[] memory h = abi.decode(route, (V2Hop[]));
        bool doppler = false;
        for (uint256 i; i < h.length; ++i) {
            if (h[i].kind == 4 && h[i].key.fee == DYNAMIC_FEE_FLAG) doppler = true;
        }
        if (!doppler) return super.factor(route);
        if (h.length != 1) revert UnsupportedFee();
        return _dopplerFactor(h[0]);
    }

    function _dopplerFactor(V2Hop memory h) private view returns (uint256 retained) {
        V2PoolKey memory key = h.key;
        if (
            h.kind != 4 || key.fee != DYNAMIC_FEE_FLAG || key.hooks != dopplerInitializer
                || h.hookData.length != 0 || dopplerInitializer.codehash != dopplerInitializerHash
                || rehypeHook.codehash != rehypeHookHash
        ) revert UnsupportedFee();

        address weth = IExecutorIdentityFeeV4(executor).weth();
        address asset;
        if (key.currency0 == weth && key.currency1 != address(0)) asset = key.currency1;
        else if (key.currency1 == weth && key.currency0 != address(0)) asset = key.currency0;
        else revert UnsupportedFee();
        if (
            !((h.tokenIn == weth && h.tokenOut == asset) || (h.tokenIn == asset && h.tokenOut == weth))
        ) revert UnsupportedFee();

        (
            address numeraire,,
            address nested,
            ,
            uint8 status,
            V2PoolKey memory registeredKey,

        ) = IDopplerInitializerFeeV4(dopplerInitializer).getState(asset);
        if (
            numeraire != weth || nested != rehypeHook || (status != INITIALIZED && status != LOCKED)
                || keccak256(abi.encode(registeredKey)) != keccak256(abi.encode(key))
        ) revert UnsupportedFee();

        bytes32 poolId = keccak256(abi.encode(key));
        (address registeredAsset, address registeredNumeraire,) = IRehypeFeeV4(rehypeHook).getPoolInfo(poolId);
        if (registeredAsset != asset || registeredNumeraire != weth) revert UnsupportedFee();

        (uint32 start, uint24 startFee, uint24 endFee,, uint32 duration) =
            IRehypeFeeV4(rehypeHook).getFeeSchedule(poolId);
        if (startFee < endFee || (startFee > endFee && duration == 0)) revert UnsupportedFee();
        uint256 current = _currentFee(start, startFee, endFee, duration);
        if (current > MAX_REHYPE_FEE) revert UnsupportedFee();

        // The pinned outer hook permits the nested reviewed module to raise the
        // Uniswap LP fee as high as 10%. Reserve that full amount even when the
        // current pool fee is lower, eliminating a quote/execution race.
        retained = Math.mulDiv(1e18 - uint256(MAX_DOPPLER_LP_FEE) * 1e12, 1e18 - current * 1e12, 1e18);
        if (retained < 800e15) revert UnsupportedFee();
    }

    function _currentFee(uint32 start, uint24 startFee, uint24 endFee, uint32 duration)
        private
        view
        returns (uint256)
    {
        if (startFee == endFee || duration == 0 || block.timestamp <= start) return startFee;
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= duration) return endFee;
        return uint256(startFee) - Math.mulDiv(uint256(startFee - endFee), elapsed, duration);
    }
}
