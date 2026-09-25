// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxProportionalPolicyV3} from "../../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {OfficialVaultCatalogV3} from "../../script/OfficialVaultCatalogV3.sol";
import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";

contract OfficialVaultLifecycleForkTest is SuccessorWatchlistForkTest {
    receive() external payable {}
    HoodxProportionalPolicyV3 catalogPolicy;
    HoodxProportionalV3 implementation;
    bytes32[] ids;

    function _catalogSetUp() internal {
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        HoodxRoutingV3 router = new HoodxRoutingV3(address(ex), address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")), address(registry), address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")), address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc")));
        catalogPolicy = new HoodxProportionalPolicyV3(address(this), address(router));
        HoodxFeeModelV3 fees = new HoodxFeeModelV3(address(router), address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc")), address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044")));
        ids = new bytes32[](OfficialVaultCatalogV3.count());
        for (uint256 i; i < ids.length; ++i) {
            (address token, bytes memory buy, bytes memory sell) = OfficialVaultCatalogV3.routeFor(i);
            ids[i] = catalogPolicy.approveRoute(token, buy, sell, OfficialVaultCatalogV3.evidence());
        }
        implementation = new HoodxProportionalV3(address(catalogPolicy), address(fees));
        vm.deal(address(this), 10 ether);
    }

    function _payload(bytes memory reason, bytes4 selector) internal pure returns (bytes memory data) {
        require(reason.length >= 4 && bytes4(reason) == selector, "wrong quote response");
        data = new bytes(reason.length - 4);
        for (uint256 i; i < data.length; ++i) data[i] = reason[i + 4];
    }

    function _buyFloors(HoodxProportionalV3 vault, uint256[] memory budgets) internal returns (uint256[] memory floors) {
        uint256 funding; for (uint256 i; i < budgets.length; ++i) funding += budgets[i];
        (bool ok, bytes memory reason) = address(vault).call{value: funding}(abi.encodeCall(vault.quoteBuys, (budgets)));
        assertFalse(ok);
        floors = abi.decode(_payload(reason, HoodxProportionalV3.BuyQuote.selector), (uint256[]));
        for (uint256 i; i < floors.length; ++i) { floors[i] = floors[i] * 97 / 100; assertGt(floors[i], 0); }
    }

    function _withdrawFloors(HoodxProportionalV3 vault, uint256 shares) internal returns (uint256 cash, uint256[] memory floors) {
        (bool ok, bytes memory reason) = address(vault).call(abi.encodeCall(vault.quoteWithdrawal, (shares)));
        assertFalse(ok);
        (cash, floors) = abi.decode(_payload(reason, HoodxProportionalV3.WithdrawalQuote.selector), (uint256, uint256[]));
        for (uint256 i; i < floors.length; ++i) { floors[i] = floors[i] * 97 / 100; assertGt(floors[i], 0); }
    }

    function testEveryOfficialVaultBootstrapsAndFullyExits() public {
        _catalogSetUp();
        for (uint256 v; v < OfficialVaultCatalogV3.vaultCount(); ++v) {
            (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory weights) = OfficialVaultCatalogV3.vault(v);
            bytes32[] memory configs = new bytes32[](indexes.length);
            for (uint256 i; i < indexes.length; ++i) configs[i] = ids[indexes[i]];
            HoodxProportionalV3 vault = HoodxProportionalV3(payable(Clones.clone(address(implementation))));
            vault.initialize(HoodxProportionalV3.Init(address(this), address(this), address(this), address(this), slug, symbol, 40, 10, cashBps, 0.02 ether, ""), configs, weights);
            uint256 gross = 0.02 ether;
            uint256 net = gross * 9950 / 10000;
            uint256[] memory budgets = new uint256[](weights.length);
            for (uint256 i; i < weights.length; ++i) budgets[i] = net * weights[i] / 10000;
            uint256[] memory floors = _buyFloors(vault, budgets);
            vault.bootstrap{value: gross}(floors, vault.planNonce(), block.timestamp + 300);
            uint256 shares = vault.balanceOf(address(this));
            assertGt(shares, 0);
            uint256 cash;
            (cash, floors) = _withdrawFloors(vault, shares);
            uint256 minimum = cash; for (uint256 i; i < floors.length; ++i) minimum += floors[i];
            vault.withdraw(shares, minimum, floors, vault.planNonce(), block.timestamp + 300);
            assertEq(vault.totalSupply(), 0, "shares remain");
            assertEq(vault.freeBalance(W), 0, "cash remains");
        }
    }
}
