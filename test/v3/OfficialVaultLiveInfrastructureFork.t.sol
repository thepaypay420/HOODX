// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxAtomicFactoryV3} from "../../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxProportionalPolicyV3} from "../../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {HoodxRebalanceControllerV3} from "../../contracts/v3/HoodxRebalanceControllerV3.sol";
import {HoodxRouteAdminV3} from "../../contracts/v3/HoodxRouteAdminV3.sol";
import {OfficialVaultCatalogV3} from "../../script/OfficialVaultCatalogV3.sol";
import {console2} from "forge-std/console2.sol";

contract OfficialVaultLiveInfrastructureForkTest is Test {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant ADMIN = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant IMPLEMENTATION = 0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7;

    HoodxProportionalPolicyV3 policy;
    HoodxAtomicFactoryV3 factory;
    bytes32[] ids;

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) { vm.skip(true); return; }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"), vm.envUint("HOODX_FORK_BLOCK"));
        policy = HoodxProportionalPolicyV3(POLICY);
        assertEq(policy.owner(), DEPLOYER, "unexpected policy owner");
        vm.deal(ADMIN, 10 ether);
    }

    function testLiveAdmissionCreationAndCanaryLifecycle() public {
        vm.pauseGasMetering();
        vm.prank(DEPLOYER);
        HoodxRouteAdminV3 routeAdmin = new HoodxRouteAdminV3(ADMIN, POLICY);
        vm.prank(DEPLOYER);
        policy.transferOwnership(address(routeAdmin));
        vm.prank(ADMIN);
        routeAdmin.acceptPolicyOwnership();
        assertEq(policy.owner(), address(routeAdmin));

        ids = new bytes32[](OfficialVaultCatalogV3.count());
        for (uint256 batch; batch < 3; ++batch) { console2.log("approve batch", batch); _approveBatch(routeAdmin, batch); }
        console2.log("deploy atomic factory");
        vm.prank(DEPLOYER);
        factory = new HoodxAtomicFactoryV3(ADMIN, ADMIN, IMPLEMENTATION, ids);
        assertEq(factory.owner(), ADMIN, "factory owner mismatch");
        vm.resumeGasMetering();

        (address[] memory vaults, address[] memory controllers) = _createAll();
        for (uint256 i; i < vaults.length; ++i) {
            console2.log("create vault", i);
            address vault = vaults[i];
            address controller = controllers[i];
            assertEq(HoodxProportionalV3(payable(vault)).owner(), controller, "controller not owner");
            assertEq(HoodxRebalanceControllerV3(controller).curator(), ADMIN, "curator mismatch");
            assertEq(HoodxProportionalV3(payable(vault)).totalSupply(), 0, "new vault not empty");
            if (i == 0) { console2.log("canary lifecycle"); _bootstrapAndExit(HoodxProportionalV3(payable(vault))); }
        }
    }

    function _createAll() private returns (address[] memory vaults, address[] memory controllers) {
        uint256 length = OfficialVaultCatalogV3.vaultCount();
        string[] memory slugs = new string[](length);
        HoodxIndexV2.Init[] memory params = new HoodxIndexV2.Init[](length);
        bytes32[][] memory configs = new bytes32[][](length);
        uint16[][] memory weights = new uint16[][](length);
        for (uint256 index; index < length; ++index) {
            (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory targetWeights) = OfficialVaultCatalogV3.vault(index);
            slugs[index] = slug;
            weights[index] = targetWeights;
            configs[index] = new bytes32[](indexes.length);
            for (uint256 i; i < indexes.length; ++i) configs[index][i] = ids[indexes[i]];
            params[index] = HoodxIndexV2.Init(ADMIN, ADMIN, ADMIN, ADMIN, slug, symbol, 40, 10, cashBps, 0.02 ether, "");
        }
        vm.prank(ADMIN);
        return factory.createAtomicBatch(slugs, params, configs, weights);
    }

    function _approveBatch(HoodxRouteAdminV3 routeAdmin, uint256 batch) private {
        uint256 start = batch * 20;
        uint256 end = start + 20;
        if (end > OfficialVaultCatalogV3.count()) end = OfficialVaultCatalogV3.count();
        address[] memory tokens = new address[](end - start);
        bytes[] memory buys = new bytes[](end - start);
        bytes[] memory sells = new bytes[](end - start);
        for (uint256 i = start; i < end; ++i) {
            (tokens[i - start], buys[i - start], sells[i - start]) = OfficialVaultCatalogV3.routeFor(i);
            ids[i] = keccak256(abi.encode(tokens[i - start], tokens[i - start].codehash, buys[i - start], sells[i - start], OfficialVaultCatalogV3.evidence()));
        }
        vm.prank(ADMIN);
        bytes32[] memory approved = routeAdmin.approveRoutes(tokens, buys, sells, OfficialVaultCatalogV3.evidence());
        for (uint256 i; i < approved.length; ++i) assertEq(approved[i], ids[start + i], "route id mismatch");
    }

    function _create(uint256 index) private returns (address vaultAddress, address controllerAddress) {
        (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory weights) = OfficialVaultCatalogV3.vault(index);
        bytes32[] memory configs = new bytes32[](indexes.length);
        for (uint256 i; i < indexes.length; ++i) configs[i] = ids[indexes[i]];
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init(ADMIN, ADMIN, ADMIN, ADMIN, slug, symbol, 40, 10, cashBps, 0.02 ether, "");
        vm.prank(ADMIN);
        return factory.createAtomic(slug, init, configs, weights);
    }

    function _payload(bytes memory reason, bytes4 selector) private pure returns (bytes memory data) {
        require(reason.length >= 4 && bytes4(reason) == selector, "wrong quote response");
        data = new bytes(reason.length - 4);
        for (uint256 i; i < data.length; ++i) data[i] = reason[i + 4];
    }

    function _bootstrapAndExit(HoodxProportionalV3 vault) private {
        (, , , , uint16[] memory weights) = OfficialVaultCatalogV3.vault(0);
        uint256 gross = 0.02 ether;
        uint256 net = gross * 9950 / 10000;
        uint256[] memory budgets = new uint256[](weights.length);
        for (uint256 i; i < weights.length; ++i) budgets[i] = net * weights[i] / 10000;
        (bool ok, bytes memory reason) = address(vault).call{value: gross}(abi.encodeCall(vault.quoteBuys, (budgets)));
        assertFalse(ok);
        uint256[] memory floors = abi.decode(_payload(reason, HoodxProportionalV3.BuyQuote.selector), (uint256[]));
        for (uint256 i; i < floors.length; ++i) floors[i] = floors[i] * 97 / 100;
        uint256 nonce = vault.planNonce();
        vm.prank(ADMIN);
        vault.bootstrap{value: gross}(floors, nonce, block.timestamp + 300);
        uint256 shares = vault.balanceOf(ADMIN);
        vm.prank(ADMIN);
        (ok, reason) = address(vault).call(abi.encodeCall(vault.quoteWithdrawal, (shares)));
        assertFalse(ok);
        (uint256 cash, uint256[] memory sellFloors) = abi.decode(_payload(reason, HoodxProportionalV3.WithdrawalQuote.selector), (uint256, uint256[]));
        uint256 minimum = cash;
        for (uint256 i; i < sellFloors.length; ++i) { sellFloors[i] = sellFloors[i] * 97 / 100; minimum += sellFloors[i]; }
        nonce = vault.planNonce();
        vm.prank(ADMIN);
        vault.withdraw(shares, minimum, sellFloors, nonce, block.timestamp + 300);
        assertEq(vault.totalSupply(), 0, "canary shares remain");
    }
}
