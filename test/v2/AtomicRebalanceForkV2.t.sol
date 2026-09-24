// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxRebalanceControllerV2} from "../../contracts/v2/HoodxRebalanceControllerV2.sol";
import {IV2Oracle} from "../../contracts/v2/Types.sol";

contract AtomicRebalanceForkV2Test is Test {
    address internal constant VAULT_696X = 0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292;
    address internal constant VAULT_FAANGX = 0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
    }

    function testForkCurrent696XAtomicSellRebalance() public {
        _exerciseSell(HoodxIndexV2(payable(VAULT_696X)));
    }

    function testForkCurrentFAANGXAtomicSellRebalance() public {
        _exerciseSell(HoodxIndexV2(payable(VAULT_FAANGX)));
    }

    function _exerciseSell(HoodxIndexV2 vault) internal {
        address curator = vault.owner();
        if (vault.paused()) {
            vm.prank(curator);
            vault.setPaused(false);
        }

        address[] memory tokens = vault.constituents();
        uint16[] memory weights = new uint16[](tokens.length);
        address sellToken;
        uint256 sellAmount;
        uint256 sellValue;
        for (uint256 i; i < tokens.length; ++i) {
            weights[i] = vault.targetBps(tokens[i]);
            uint256 candidate = vault.freeBalance(tokens[i]) / 20;
            if (sellToken == address(0) && candidate != 0) {
                uint256 value = _value(vault, tokens[i], candidate);
                if (value >= 0.0002 ether) {
                    sellToken = tokens[i];
                    sellAmount = candidate;
                    sellValue = value;
                }
            }
        }
        require(sellToken != address(0), "no executable fork sale");

        HoodxRebalanceControllerV2 controller = new HoodxRebalanceControllerV2(address(vault), curator);
        vm.prank(curator);
        vault.transferOwnership(address(controller));
        vm.prank(curator);
        controller.activate();

        uint256 cashBefore = vault.freeBalance(vault.weth());
        uint16 cashBps = vault.cashTargetBps();
        bytes32 basketHash = keccak256(abi.encode(tokens));
        HoodxRebalanceControllerV2.Step[] memory steps = new HoodxRebalanceControllerV2.Step[](1);
        steps[0] = HoodxRebalanceControllerV2.Step(sellToken, false, sellAmount, sellValue * 97 / 100);

        vm.prank(curator);
        controller.atomicRebalance(
            cashBps,
            weights,
            steps,
            basketHash,
            cashBefore,
            block.timestamp + 5 minutes
        );

        assertEq(vault.owner(), address(controller));
        assertEq(controller.curator(), curator);
        assertGt(vault.freeBalance(sellToken), 0);
        assertGt(vault.freeBalance(vault.weth()), cashBefore);
    }

    function _value(HoodxIndexV2 vault, address token, uint256 amount) internal view returns (uint256) {
        (, address oracle,,) = vault.policy().config(vault.configId(token));
        try IV2Oracle(oracle).value(token, amount) returns (uint256 result) {
            return result;
        } catch {
            return 0;
        }
    }
}
