// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Local-fork validation of the HUNTX fee model (read-only research; runs only on a fork).
// For each case: fork at the block before the window, mint our range position directly on
// the V4 PoolManager, replay the recorded swaps (same direction, same exact-input size) in
// order with our liquidity present, then burn and record the fees actually accrued.

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        returns (int256 callerDelta, int256 feesAccrued);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface IERC20 {
    function transfer(address to, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

contract Replayer {
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    uint160 constant MIN_SQRT = 4295128740;
    uint160 constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;

    PoolKey public key;
    int256 public lastFees;
    int256 public lastDelta;
    uint256 public failedSwaps;

    function setKey(PoolKey calldata k) external {
        key = k;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(PM), "pm");
        (uint8 op, int24 tl, int24 tu, int256 liq, bool z, uint256 amt) =
            abi.decode(data, (uint8, int24, int24, int256, bool, uint256));
        int256 delta;
        if (op == 0) {
            (int256 cd, int256 fa) = PM.modifyLiquidity(key, ModifyLiquidityParams(tl, tu, liq, bytes32(0)), "");
            delta = cd;
            lastFees = fa;
            lastDelta = cd;
        } else {
            delta = PM.swap(key, SwapParams(z, -int256(amt), z ? MIN_SQRT + 1 : MAX_SQRT - 1), "");
        }
        _settle(key.currency0, int128(delta >> 128));
        _settle(key.currency1, int128(delta));
        return "";
    }

    function _settle(address c, int128 d) internal {
        if (d < 0) {
            PM.sync(c);
            IERC20(c).transfer(address(PM), uint256(uint128(-d)));
            PM.settle();
        } else if (d > 0) {
            PM.take(c, address(this), uint256(uint128(d)));
        }
    }

    function modify(int24 tl, int24 tu, int256 liq) external {
        PM.unlock(abi.encode(uint8(0), tl, tu, liq, false, uint256(0)));
    }

    function doSwap(bool z, uint256 amt) external {
        try PM.unlock(abi.encode(uint8(1), int24(0), int24(0), int256(0), z, amt)) {}
        catch {
            failedSwaps++;
        }
    }
}

contract FeeReplayTest is Test {
    using stdJson for string;

    /// Gas of a lean direct-PoolManager vault's actions on a real stock-token pool (fork only).
    function test_gas() public {
        string memory root = vm.projectRoot();
        string memory j = vm.readFile(string.concat(root, "/gascase.json"));
        vm.createSelectFork(vm.envString("HUNTX_FORK_RPC"), j.readUint(".fork_block"));
        Replayer r = new Replayer();
        PoolKey memory k = PoolKey(j.readAddress(".c0"), j.readAddress(".c1"), uint24(j.readUint(".fee")),
            int24(j.readInt(".spacing")), address(0));
        r.setKey(k);
        address pm = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
        vm.startPrank(pm);
        IERC20(k.currency0).transfer(address(r), j.readUint(".need0"));
        IERC20(k.currency1).transfer(address(r), j.readUint(".need1"));
        vm.stopPrank();
        int24 tl = int24(j.readInt(".tick_lower"));
        int24 tu = int24(j.readInt(".tick_upper"));
        int256 liq = int256(j.readUint(".liquidity"));
        uint256 g0 = gasleft();
        r.modify(tl, tu, liq);
        uint256 gMint = g0 - gasleft();
        g0 = gasleft();
        r.doSwap(j.readBool(".swap_z"), j.readUint(".swap_amt"));
        uint256 gSwap = g0 - gasleft();
        g0 = gasleft();
        r.modify(tl, tu, -liq);
        uint256 gBurn = g0 - gasleft();
        vm.writeFile(string.concat(root, "/gas.csv"),
            string.concat(vm.toString(gMint), ",", vm.toString(gSwap), ",", vm.toString(gBurn), "\n"));
    }

    function test_replay() public {
        string memory root = vm.projectRoot();
        string memory j = vm.readFile(string.concat(root, "/cases.json"));
        uint256 n = j.readUint(".n");
        string memory outAll = "";
        for (uint256 i = 0; i < n; i++) {
            string memory p = string.concat(".cases[", vm.toString(i), "]");
            vm.createSelectFork(vm.envString("HUNTX_FORK_RPC"), j.readUint(string.concat(p, ".fork_block")));
            Replayer r = new Replayer();
            PoolKey memory k = PoolKey(
                j.readAddress(string.concat(p, ".c0")),
                j.readAddress(string.concat(p, ".c1")),
                uint24(j.readUint(string.concat(p, ".fee"))),
                int24(j.readInt(string.concat(p, ".spacing"))),
                address(0)
            );
            r.setKey(k);
            // Fund from the PoolManager's own balance ON THE FORK (deal() cannot find some proxy slots).
            address pm = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
            vm.startPrank(pm);
            IERC20(k.currency0).transfer(address(r), j.readUint(string.concat(p, ".need0")));
            IERC20(k.currency1).transfer(address(r), j.readUint(string.concat(p, ".need1")));
            vm.stopPrank();
            int24 tl = int24(j.readInt(string.concat(p, ".tick_lower")));
            int24 tu = int24(j.readInt(string.concat(p, ".tick_upper")));
            int256 liq = int256(j.readUint(string.concat(p, ".liquidity")));
            r.modify(tl, tu, liq);
            bool[] memory dirs = j.readBoolArray(string.concat(p, ".zero_for_one"));
            uint256[] memory amts = j.readUintArray(string.concat(p, ".amount_in"));
            for (uint256 s = 0; s < dirs.length; s++) {
                r.doSwap(dirs[s], amts[s]);
            }
            r.modify(tl, tu, -liq);
            int256 fees = r.lastFees();
            string memory line = string.concat(
                vm.toString(i), ",", vm.toString(int256(int128(fees >> 128))), ",",
                vm.toString(int256(int128(fees))), ",", vm.toString(r.failedSwaps()), ",", vm.toString(dirs.length)
            );
            outAll = string.concat(outAll, line, "\n");
        }
        vm.writeFile(string.concat(root, "/results.csv"), outAll);
    }
}
