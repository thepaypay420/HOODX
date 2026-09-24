// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxPolicyV2} from "../../contracts/v2/HoodxPolicyV2.sol";
import {HoodxSelfHealingControllerV2} from "../../contracts/v2/HoodxSelfHealingControllerV2.sol";
import {IV2Oracle} from "../../contracts/v2/Types.sol";

contract ForkStaticOracleV2 is IV2Oracle {
    address public immutable token;
    uint256 public immutable unit;
    uint256 public immutable unitValue;

    constructor(address token_, uint256 unit_, uint256 unitValue_) {
        token = token_;
        unit = unit_;
        unitValue = unitValue_;
    }

    function value(address asset, uint256 amount) external view returns (uint256) {
        require(asset == token);
        return Math.mulDiv(amount, unitValue, unit);
    }
}

contract SelfHealingLiveForkV2Test is Test {
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant VAULT_696X = 0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292;
    address constant VAULT_FAANGX = 0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0;
    address constant CONTROLLER_696X = 0x32d806935f5118a60bB90137e699B81a0348e643;
    address constant CONTROLLER_FAANGX = 0xB0Db61D7AeE1714A285e52f92a7b971bf28bc783;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        assertEq(block.chainid, 4663);
    }

    function testLive696xControllerHandoffHealingAndFullExit() public {
        bytes32[] memory historical = new bytes32[](1);
        historical[0] = 0x44058f6b19c62182cae9e69abd2d2f0c596227772ce843dcd5339a485f421a84;
        _rehearse(VAULT_696X, CONTROLLER_696X, historical, keccak256("SELF_HEALING_696X_FORK_REHEARSAL"));
    }

    function testLiveFaangxControllerHandoffHealingAndFullExit() public {
        bytes32[] memory historical = new bytes32[](2);
        historical[0] = 0xe48af78086282fcadc47779be434f2efa0c46f849448b564a63c6b69508bdbdd;
        historical[1] = 0x7c6be71dbf7d495e2e09e9857e536718496ec617ab20a76188a36167f2c45dc6;
        _rehearse(VAULT_FAANGX, CONTROLLER_FAANGX, historical, keccak256("SELF_HEALING_FAANGX_FORK_REHEARSAL"));
    }

    function _rehearse(address vaultAddress, address controller, bytes32[] memory historical, bytes32 evidence) private {
        HoodxIndexV2 vault = HoodxIndexV2(payable(vaultAddress));
        HoodxPolicyV2 policy = HoodxPolicyV2(address(vault.policy()));
        HoodxSelfHealingControllerV2 healer = HoodxSelfHealingControllerV2(controller);
        assertEq(vault.owner(), controller);
        assertEq(vault.pendingOwner(), address(0));
        assertEq(healer.curator(), CURATOR);
        assertEq(address(healer.vault()), vaultAddress);
        assertEq(policy.owner(), CURATOR);

        address[] memory tokens = vault.constituents();
        for (uint256 i; i < tokens.length; ++i) assertTrue(healer.recoveryApproved(vault.configId(tokens[i])));
        for (uint256 i; i < historical.length; ++i) assertTrue(healer.recoveryApproved(historical[i]));

        address token = tokens[0];
        bytes32 oldId = vault.configId(token);
        (, address oldOracle, bytes memory buy, bytes memory sell) = policy.config(oldId);
        uint256 unit = 10 ** IERC20Metadata(token).decimals();
        uint256 unitValue = IV2Oracle(oldOracle).value(token, unit);
        ForkStaticOracleV2 replacementOracle = new ForkStaticOracleV2(token, unit, unitValue);
        vm.prank(CURATOR);
        bytes32 replacement = policy.approveConfig(token, address(replacementOracle), buy, sell, evidence);

        vm.prank(CURATOR);
        healer.setRecoveryConfig(replacement, true);
        assertTrue(healer.recoveryApproved(replacement));

        vm.mockCallRevert(oldOracle, abi.encodeCall(IV2Oracle.value, (token, unit)), bytes("failed reference"));
        vm.prank(address(0xBEEF));
        healer.healConfig(replacement);
        assertEq(vault.configId(token), replacement);

        uint256 shares = vault.balanceOf(CURATOR);
        uint256 before = CURATOR.balance;
        vm.prank(CURATOR);
        uint256 received = vault.withdraw(shares, 1, block.timestamp + 300);
        assertGt(received, 0);
        assertEq(CURATOR.balance - before, received);
        assertEq(vault.balanceOf(CURATOR), 0);
    }
}
