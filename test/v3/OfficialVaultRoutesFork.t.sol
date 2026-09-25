// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HoodxExecutorV3} from "../../contracts/v3/HoodxExecutorV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {V2Hop, V2PoolKey, IV2Weth} from "../../contracts/v2/Types.sol";
import {OfficialVaultCatalogV3} from "../../script/OfficialVaultCatalogV3.sol";

interface OVCQ3 {
    struct Params { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }
    function quoteExactInputSingle(Params calldata) external returns (uint256, uint160, uint32, uint256);
}
interface OVCQ4 {
    struct Params { V2PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }
    function quoteExactInputSingle(Params calldata) external returns (uint256, uint256);
}

contract OfficialVaultRoutesForkTest is Test {
    using SafeERC20 for IERC20;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant V2_FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;
    address constant V3_QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant V4_QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    HoodxExecutorV3 executor;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) { vm.skip(true); return; }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envUint("HOODX_FORK_BLOCK"));
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        executor = new HoodxExecutorV3(WETH, 0x8876789976dEcBfCbBbe364623C63652db8C0904, 0x000000000022D473030F116dDEE9F6B43aC78BA3, V3_FACTORY, 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b, V2_FACTORY, address(registry));
        vm.deal(address(this), 1 ether);
        IV2Weth(WETH).deposit{value: 1 ether}();
    }

    function _quote(V2Hop memory hop, uint256 amount) internal returns (uint256 out) {
        if (hop.kind == 3) (out,,,) = OVCQ3(V3_QUOTER).quoteExactInputSingle(OVCQ3.Params(hop.tokenIn, hop.tokenOut, amount, hop.fee, 0));
        else if (hop.kind == 4) (out,) = OVCQ4(V4_QUOTER).quoteExactInputSingle(OVCQ4.Params(hop.key, hop.tokenIn == hop.key.currency0, uint128(amount), hop.hookData));
        else revert("unexpected route");
    }

    function _run(uint256 index, uint256 amount) internal {
        (address token, bytes memory buy, bytes memory sell) = OfficialVaultCatalogV3.routeFor(index);
        V2Hop[] memory buys = abi.decode(buy, (V2Hop[]));
        uint256 expected = amount;
        for (uint256 i; i < buys.length; ++i) expected = _quote(buys[i], expected);
        assertGt(expected, 0, "zero buy quote");
        IERC20(WETH).forceApprove(address(executor), amount);
        uint256 got = executor.execute(WETH, token, amount, expected * 95 / 100, buy, block.timestamp + 300);
        V2Hop[] memory sells = abi.decode(sell, (V2Hop[]));
        expected = got;
        for (uint256 i; i < sells.length; ++i) expected = _quote(sells[i], expected);
        assertGt(expected, 0, "zero sell quote");
        IERC20(token).forceApprove(address(executor), got);
        uint256 back = executor.execute(token, WETH, got, expected * 95 / 100, sell, block.timestamp + 300);
        assertGt(back, 0, "zero round trip");
        assertEq(IERC20(token).balanceOf(address(executor)), 0, "executor token residue");
        assertEq(IERC20(WETH).balanceOf(address(executor)), 0, "executor WETH residue");
    }

    function _runAll(uint256 amount) internal { for (uint256 i; i < OfficialVaultCatalogV3.count(); ++i) { emit log_named_uint("route", i); _run(i, amount); } }
    function testAllOfficialRoutesSmallRoundTrip() public { _runAll(0.0001 ether); }
    function testAllOfficialRoutesBasketSleeveRoundTrip() public { _runAll(0.002 ether); }
}
