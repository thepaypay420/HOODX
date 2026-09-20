// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {VaultV2Test} from "./VaultV2.t.sol";
import {HoodxOfficialFactoryV2} from "../../contracts/v2/HoodxBootstrapV2.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";

contract BootstrapV2Test is VaultV2Test {
    function testOfficialConstructorSetsPermanentRolesAndEmptyVaults() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = policy.add(address(a));
        ids[1] = policy.add(address(b));
        uint16[] memory weights = new uint16[](2);
        weights[0] = 3750;
        weights[1] = 3750;
        HoodxIndexV2.Init memory p = params();
        p.creator = curator;
        p.recipient = curator;
        HoodxOfficialFactoryV2.Basket memory basket = HoodxOfficialFactoryV2.Basket(p, ids, weights);
        HoodxOfficialFactoryV2 official = new HoodxOfficialFactoryV2(curator, treasury, address(impl), basket, basket);
        assertEq(official.owner(), curator);
        HoodxIndexV2 first = HoodxIndexV2(payable(official.bySlug("696x")));
        HoodxIndexV2 second = HoodxIndexV2(payable(official.bySlug("faangx")));
        assertEq(first.owner(), curator);
        assertEq(first.creator(), curator);
        assertEq(first.creatorRecipient(), curator);
        assertEq(first.totalSupply(), 0);
        assertEq(first.totalAssets(), 0);
        assertEq(second.totalAssets(), 0);
        vm.expectRevert();
        official.transferOwnership(address(this));
        vm.expectRevert();
        first.setPaused(true);
        vm.expectRevert();
        first.setCreatorEconomics(address(this), 10);
    }

    function testOfficialConstructorRejectsDeployerAsCreator() public {
        HoodxOfficialFactoryV2.Basket memory basket;
        basket.params = params();
        basket.params.creator = address(this);
        vm.expectRevert();
        new HoodxOfficialFactoryV2(curator, treasury, address(impl), basket, basket);
    }

    function testGenesisSharePricePreserved() public {
        uint256 net = 0.999 ether;
        assertEq(vault.previewDeposit(1 ether), net * 25);
        assertEq(deposit(alice, 1 ether), net * 25);
    }
}
