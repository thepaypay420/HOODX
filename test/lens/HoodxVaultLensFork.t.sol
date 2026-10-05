// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxVaultLens} from "../../contracts/lens/HoodxVaultLens.sol";

interface ISpot {
    function spot() external view returns (uint160 sqrtPriceX96, int24 tick);
}

interface IHoldings {
    struct Holding {
        address sleeve;
        address stock;
        uint256 sleeveShares;
        uint256 sleeveSupply;
        int24 tickLower;
        int24 tickUpper;
        int24 tick;
        uint128 positionLiquidity;
    }

    function holdings() external view returns (Holding[] memory);
    function balanceOf(address) external view returns (uint256);
}

/// @notice HoodxVaultLens on a current-state fork: tick maths against Uniswap's bounds and live pools, and share prices
///         for every HOODX vault kind. Run with HOODX_FORK_TEST=true ROBINHOOD_RPC_URL=<rpc>. Nothing is broadcast.
contract HoodxVaultLensForkTest is Test {
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant BOOST = 0x5e0135C3592095592C4B43d84c817c26A0F43515;
    address constant STKX = 0xB064d074Ff141A68771AF32c3EAB9Dd3c9379f6D;
    address constant STKX_V2 = 0x67D2327eA0C42Cf92C4601ebc59df0F3e9b2aa80;
    address constant TREASURY = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    uint256 constant MIN_SQRT = 4295128739; // Uniswap TickMath.MIN_SQRT_PRICE (tick -887272)
    uint256 constant MAX_SQRT = 1461446703485210103287273052203988822378723970342; // MAX_SQRT_PRICE (tick 887272)

    HoodxVaultLens lens;
    bool live;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) return;
        uint256 b = vm.envOr("HOODX_FORK_BLOCK", uint256(0));
        if (b == 0) vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        else vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), b);
        live = true;
        bytes32 ethPool = keccak256(abi.encode(address(0), USDG, uint24(100), int24(1), address(0)));
        lens = new HoodxVaultLens(BOOST, STATE_VIEW, USDG, ethPool);
    }

    function _rel(uint256 a, uint256 b) internal pure returns (uint256 ppb) {
        uint256 d = a > b ? a - b : b - a;
        return d * 1e9 / b;
    }

    function test_tickMathMatchesUniswapBounds() public view {
        if (!live) return;
        assertEq(lens.sqrtPriceAtTick(0), 1 << 96);
        assertLt(_rel(lens.sqrtPriceAtTick(887272), MAX_SQRT), 1, "max sqrt price within 1 ppb");
        assertLt(_rel(lens.sqrtPriceAtTick(-887272), MIN_SQRT), 1, "min sqrt price within 1 ppb");
    }

    /// Every live sleeve's pool price must sit between the lens's prices at its tick and the next tick.
    function test_tickMathBracketsLivePoolPrices() public view {
        if (!live) return;
        IHoldings.Holding[] memory hs = IHoldings(STKX).holdings();
        for (uint256 i; i < hs.length; ++i) {
            (uint160 s, int24 t) = ISpot(hs[i].sleeve).spot();
            uint256 lo = lens.sqrtPriceAtTick(t);
            uint256 hi = lens.sqrtPriceAtTick(t + 1);
            assertLe(lo * (1e12 - 1) / 1e12, s, "price at tick <= pool price");
            assertGe(hi * (1e12 + 1) / 1e12, s, "pool price < price at next tick");
        }
    }

    function test_sharePrices_allVaultKinds() public {
        if (!live) return;
        uint256 eu = lens.ethUsd();
        emit log_named_decimal_uint("ETH (USD)", eu, 18);
        assertGt(eu, 500e18);
        assertLt(eu, 20_000e18);
        _show("Hands-free LP v3 (STKX)", STKX);
        _show("Hands-free LP v2, retired", STKX_V2);
        _show("Boosted ETH (BOOSTX)", BOOST);
        _show("696X", 0xb645A727ed525321509Ec16aa011D38E52f99a93);
        address[] memory idx = new address[](10);
        idx[0] = 0xF77fb0e5cE0682B8D8064e754cF99d7F3EC643d2; // CHAINX
        idx[1] = 0xb70dD77B61ad2d2D70d14d1e74591fd173f2FBBE; // CHIPX
        idx[2] = 0x5B0a7D7e596fc7E627716945644B3cEe738c82E7; // AIX
        idx[3] = 0xB8C2F95238A9076E73D60273C22724360a7A052b; // CULTX
        idx[4] = 0x8b53F25665e0fE8A860A1120A0A08d0007570166; // HLTHX
        idx[5] = 0x649be0E6396778Cf58cd5bdfD347cbe83508a3ec; // CLOUDX
        idx[6] = 0x1a396BfE4f79b1d12a27524217C4DED677BEF1b9; // REALX
        idx[7] = 0xD6b3ba50aFf684df5B53bAD77CA697F64F076789; // COREX
        idx[8] = 0xaabFc490682AD036b421458F10E14dFc105E3AdC; // EDGE
        idx[9] = 0xba12dD90Af13C89662Cb89b85f940c3b8b9bbA15; // ICONX
        (uint256[] memory e, uint256[] memory u) = lens.sharePrices(idx);
        for (uint256 i; i < idx.length; ++i) {
            emit log_named_address("index vault", idx[i]);
            emit log_named_decimal_uint("  ETH per share", e[i], 18);
            emit log_named_decimal_uint("  USD per share", u[i], 18);
        }
        // a new HOODX stock-LP share is worth about $0.99 at launch: the lens must agree to within a few percent
        (, uint256 usdLp) = lens.sharePrice(STKX);
        assertGt(usdLp, 0.9e18);
        assertLt(usdLp, 1.1e18);
        (uint256 vWei, uint256 vUsd) = lens.positionValue(STKX, TREASURY);
        emit log_named_decimal_uint("treasury STKX position (ETH)", vWei, 18);
        emit log_named_decimal_uint("treasury STKX position (USD)", vUsd, 18);
    }

    function test_unknownAndEmptyVaultsDoNotBreakBatch() public {
        if (!live) return;
        address[] memory v = new address[](2);
        v[0] = address(0xdead);
        v[1] = STKX;
        (uint256[] memory e,) = lens.sharePrices(v);
        assertEq(e[0], 0, "unknown address prices at zero");
        assertGt(e[1], 0, "the real vault still prices");
    }

    function _show(string memory label, address vault) internal {
        (uint256 assets, uint256 supply, HoodxVaultLens.Kind kind) = lens.navEth(vault);
        emit log_named_string("vault", label);
        emit log_named_uint("  kind", uint256(kind));
        emit log_named_decimal_uint("  NAV (ETH)", assets, 18);
        emit log_named_decimal_uint("  supply", supply, 18);
        if (supply > 0) {
            (uint256 e, uint256 u) = lens.sharePrice(vault);
            emit log_named_decimal_uint("  ETH per share", e, 18);
            emit log_named_decimal_uint("  USD per share", u, 18);
        }
    }
}
