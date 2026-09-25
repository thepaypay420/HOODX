// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";

contract HookFixtureV3 { uint256 public immutable marker; constructor(uint256 value) { marker=value; } }

contract HookRegistryGriefingV3Test is Test {
    HoodxHookRegistryV3 registry;
    address attacker=address(0xbad);
    HookFixtureV3 hook;
    bytes32 evidence=keccak256("independent-review");

    function setUp() public {
        registry=new HoodxHookRegistryV3(address(this));
        hook=new HookFixtureV3(1);
    }

    function testOnlyOwnerCanScheduleResetCancelOrRevoke() public {
        vm.startPrank(attacker);
        vm.expectRevert(); registry.propose(address(hook),evidence);
        vm.expectRevert(); registry.revoke(address(hook));
        vm.stopPrank();
        registry.propose(address(hook),evidence);
        (bytes32 codeHash,,uint256 readyAt)=registry.proposals(address(hook));
        vm.warp(block.timestamp+1 days);
        vm.prank(attacker); vm.expectRevert(); registry.propose(address(hook),evidence);
        (bytes32 unchanged,,uint256 stillReady)=registry.proposals(address(hook));
        assertEq(unchanged,codeHash); assertEq(stillReady,readyAt);
    }

    function testBeforeAtAndAfterCooldownAndRepeatedActivation() public {
        registry.propose(address(hook),evidence);
        (bytes32 codeHash,,uint256 readyAt)=registry.proposals(address(hook));
        vm.warp(readyAt-1); vm.expectRevert(HoodxHookRegistryV3.InvalidHook.selector); registry.activate(address(hook));
        vm.warp(readyAt); vm.prank(attacker); registry.activate(address(hook));
        assertEq(registry.approvedCodeHash(address(hook)),codeHash);
        vm.expectRevert(HoodxHookRegistryV3.InvalidHook.selector); registry.activate(address(hook));
        registry.revoke(address(hook));
        assertFalse(registry.isApprovedHook(address(hook)));

        registry.propose(address(hook),evidence);
        (,,readyAt)=registry.proposals(address(hook));
        vm.warp(readyAt+30 days); registry.activate(address(hook));
        assertTrue(registry.isApprovedHook(address(hook)));
    }

    function testOwnerRescheduleExtendsButAttackerCannotAndExactHookIsPinned() public {
        registry.propose(address(hook),evidence);
        (,,uint256 firstReady)=registry.proposals(address(hook));
        vm.warp(block.timestamp+1 days);
        registry.propose(address(hook),keccak256("new-review"));
        (bytes32 pinned,,uint256 extended)=registry.proposals(address(hook));
        assertGt(extended,firstReady);
        HookFixtureV3 replacement=new HookFixtureV3(2);
        vm.warp(extended);
        vm.expectRevert(HoodxHookRegistryV3.InvalidHook.selector); registry.activate(address(replacement));
        registry.activate(address(hook));
        assertEq(registry.approvedCodeHash(address(hook)),pinned);
    }

    function testChangedCodeAndFailedActivationPreservePendingProposal() public {
        registry.propose(address(hook),evidence);
        (bytes32 pinned,bytes32 savedEvidence,uint256 readyAt)=registry.proposals(address(hook));
        vm.etch(address(hook),hex"00");
        vm.warp(readyAt);
        vm.expectRevert(HoodxHookRegistryV3.InvalidHook.selector); registry.activate(address(hook));
        (bytes32 afterHash,bytes32 afterEvidence,uint256 afterReady)=registry.proposals(address(hook));
        assertEq(afterHash,pinned); assertEq(afterEvidence,savedEvidence); assertEq(afterReady,readyAt);
        assertEq(registry.approvedCodeHash(address(hook)),bytes32(0));
    }

    function testOwnerCancellationClearsPendingAndApprovedState() public {
        registry.propose(address(hook),evidence);
        registry.revoke(address(hook));
        (bytes32 codeHash,bytes32 savedEvidence,uint256 readyAt)=registry.proposals(address(hook));
        assertEq(codeHash,bytes32(0)); assertEq(savedEvidence,bytes32(0)); assertEq(readyAt,0);
        vm.warp(block.timestamp+3 days);
        vm.expectRevert(HoodxHookRegistryV3.InvalidHook.selector); registry.activate(address(hook));
    }
}
