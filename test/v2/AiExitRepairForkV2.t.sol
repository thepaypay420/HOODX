// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {V2Hop, IV2Executor, IV2Oracle} from "../../contracts/v2/Types.sol";

interface IAiRepairPolicy {
    function approveConfig(address token, address oracle, bytes calldata buy, bytes calldata sell, bytes32 evidence)
        external
        returns (bytes32);
}

interface IAiRepairController {
    function replaceConfig(bytes32 id) external;
}

interface IAiRepairVault {
    function balanceOf(address owner) external view returns (uint256);
    function withdraw(uint256 shares, uint256 minEth, uint256 deadline) external;
}

contract AiExitRepairForkV2Test is Test {
    using SafeERC20 for IERC20;

    address constant VAULT = 0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292;
    address constant AI = 0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant EXECUTOR = 0xa3E8761ce43D1a6aFC5229D2aA83dCc5e2bbdD62;
    address constant ORACLE = 0xC2730EB5a2f7BAD1609749BE19a47386F6bCeeEC;
    address constant POLICY = 0x8e36fB11545Fc1683f35a079d3F9f1A715DbEC70;
    address constant CONTROLLER = 0x32d806935f5118a60bB90137e699B81a0348e643;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), 72_531_387);
    }

    function testAlternativePointThreePercentPoolClearsProtectedFloorForFullLiveBalance() public {
        uint256 amount = IERC20(AI).balanceOf(VAULT);
        uint256 floor = IV2Oracle(ORACLE).value(AI, amount) * 9700 / 10_000;

        V2Hop[] memory route = new V2Hop[](1);
        route[0].kind = 3;
        route[0].tokenIn = AI;
        route[0].tokenOut = WETH;
        route[0].fee = 3000;

        vm.startPrank(VAULT);
        IERC20(AI).forceApprove(EXECUTOR, amount);
        uint256 received = IV2Executor(EXECUTOR).execute(
            AI, WETH, amount, floor, abi.encode(route), block.timestamp + 300
        );
        vm.stopPrank();

        console2.log("AI amount", amount);
        console2.log("protected floor", floor);
        console2.log("received", received);
        assertGe(received, floor);
    }

    function testConfigReplacementRestoresCompleteEthWithdrawal() public {
        V2Hop[] memory buy = new V2Hop[](1);
        buy[0].kind = 3;
        buy[0].tokenIn = WETH;
        buy[0].tokenOut = AI;
        buy[0].fee = 3000;

        V2Hop[] memory sell = new V2Hop[](1);
        sell[0].kind = 3;
        sell[0].tokenIn = AI;
        sell[0].tokenOut = WETH;
        sell[0].fee = 3000;

        vm.startPrank(CURATOR);
        bytes32 id = IAiRepairPolicy(POLICY).approveConfig(
            AI, ORACLE, abi.encode(buy), abi.encode(sell), keccak256("696X AI 0.3% direct route repair 2026-09-25")
        );
        IAiRepairController(CONTROLLER).replaceConfig(id);

        uint256 shares = IAiRepairVault(VAULT).balanceOf(CURATOR);
        uint256 ethBefore = CURATOR.balance;
        IAiRepairVault(VAULT).withdraw(shares, 1, block.timestamp + 300);
        vm.stopPrank();

        assertEq(IAiRepairVault(VAULT).balanceOf(CURATOR), 0);
        assertGt(CURATOR.balance, ethBefore);
    }
}
