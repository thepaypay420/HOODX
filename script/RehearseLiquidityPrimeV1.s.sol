// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxLiquiditySleeveV1} from "../contracts/liquidity/HoodxLiquiditySleeveV1.sol";
import {HoodxLiquidityIndexV1} from "../contracts/liquidity/HoodxLiquidityIndexV1.sol";
import {HoodxLiquidityControllerV1} from "../contracts/liquidity/HoodxLiquidityControllerV1.sol";
import {IUniswapV3PoolLike} from "../contracts/liquidity/UniswapV3Types.sol";

/// @notice Deploys and wires the first four-sleeve LP-index pilot on a fork only.
/// @dev It deliberately rejects broadcasting. Seeding remains a separately reviewed operation.
contract RehearseLiquidityPrimeV1 is Script {
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    address constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address constant WETH_SPY = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;
    address constant WETH_PONS = 0xEd50bDeeA8aDC232f159486192a4157281D722ff;
    address constant CASHCAT_WETH = 0xd42A491087a15E5afd51FEb3606066Cc152d2b09;

    function run() external {
        require(!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast), "simulation only");
        require(block.chainid == 4663, "wrong chain");

        address[4] memory pools = [WETH_USDG, WETH_SPY, WETH_PONS, CASHCAT_WETH];
        int24[4] memory widths = [int24(2_000), int24(4_000), int24(6_000), int24(7_200)];
        string[4] memory names =
            ["HOODX LP WETH-USDG", "HOODX LP WETH-SPY", "HOODX LP WETH-PONS", "HOODX LP CASHCAT-WETH"];
        string[4] memory symbols = ["hxLP-WU", "hxLP-WS", "hxLP-WP", "hxLP-CW"];

        vm.startBroadcast(CURATOR);
        address[] memory sleeves = new address[](4);
        for (uint256 i; i < pools.length; ++i) {
            (int24 lower, int24 upper) = _range(pools[i], widths[i]);
            sleeves[i] = address(
                new HoodxLiquiditySleeveV1(
                    CURATOR, POSITION_MANAGER, FACTORY, pools[i], lower, upper, names[i], symbols[i]
                )
            );
        }
        HoodxLiquidityIndexV1 index = new HoodxLiquidityIndexV1(CURATOR, WETH, sleeves, "HOODX Liquidity Prime", "HLPX");

        HoodxLiquidityControllerV1.Policy[] memory policies = new HoodxLiquidityControllerV1.Policy[](4);
        policies[0] = _policy(2_000, 300, 120, 2_000, 30 minutes, 1 hours, 12 hours);
        policies[1] = _policy(4_000, 600, 300, 4_000, 1 hours, 4 hours, 24 hours);
        policies[2] = _policy(6_000, 900, 600, 6_000, 30 minutes, 30 minutes, 6 hours);
        policies[3] = _policy(7_200, 1_200, 720, 7_200, 30 minutes, 30 minutes, 6 hours);
        HoodxLiquidityControllerV1 controller =
            new HoodxLiquidityControllerV1(address(index), CURATOR, sleeves, policies);
        index.transferOwnership(address(controller));
        for (uint256 i; i < sleeves.length; ++i) {
            HoodxLiquiditySleeveV1(sleeves[i]).transferOwnership(address(controller));
        }
        controller.activate();
        vm.stopBroadcast();

        require(index.owner() == address(controller), "index owner");
        for (uint256 i; i < sleeves.length; ++i) {
            require(HoodxLiquiditySleeveV1(sleeves[i]).owner() == address(controller), "sleeve owner");
            console2.log("SIMULATED sleeve", sleeves[i]);
        }
        console2.log("SIMULATED index", address(index));
        console2.log("SIMULATED controller", address(controller));
        console2.log("Seed target bps: 3000 / 2500 / 2000 / 1000 / 1500 WETH reserve");
    }

    function _range(address pool, int24 halfWidth) internal view returns (int24 lower, int24 upper) {
        (, int24 tick,,,,,) = IUniswapV3PoolLike(pool).slot0();
        int24 spacing = IUniswapV3PoolLike(pool).tickSpacing();
        require(halfWidth % spacing == 0, "unaligned width");
        int24 center = tick - (tick % spacing);
        lower = center - halfWidth;
        upper = center + halfWidth;
    }

    function _policy(int24 width, int24 buffer, int24 deviation, int24 move, uint32 twap, uint32 dwell, uint32 cooldown)
        internal
        pure
        returns (HoodxLiquidityControllerV1.Policy memory)
    {
        return HoodxLiquidityControllerV1.Policy(width, buffer, deviation, move, twap, dwell, cooldown);
    }
}
