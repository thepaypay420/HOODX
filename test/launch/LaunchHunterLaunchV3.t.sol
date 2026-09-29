// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HoodxLaunchHunterLaunchV3} from "../../contracts/launch/HoodxLaunchHunterLaunchV3.sol";
import {HoodxLaunchHunterV3} from "../../contracts/launch/HoodxLaunchHunterV3.sol";
import {HunterToken, HunterWeth} from "./LaunchHunterV1.t.sol";

contract LaunchExecutorIdentityMockV3 {
    function weth() external pure returns (address) {
        return 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    }

    function hookRegistry() external pure returns (address) {
        return 0xa46150E972Da054f9b954D7a695476A6258A4705;
    }
}

contract LaunchRegistryMockV3 {
    function isApprovedHook(address) external pure returns (bool) {
        return true;
    }
}

contract LaunchBaseIndexMockV3 is ERC20 {
    address public constant weth = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public owner;
    bool public bootstrapped;
    address[] private _sleeves;

    constructor(address curator, address controller, address[] memory sleeves_, bool ready)
        ERC20("HOODX Fee Machine", "FEEX")
    {
        owner = controller;
        bootstrapped = ready;
        _sleeves = sleeves_;
        _mint(curator, 160 ether);
    }

    function sleeves() external view returns (address[] memory) {
        return _sleeves;
    }
}

contract LaunchHunterLaunchV3Test is Test {
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant EXECUTOR = 0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant CONTROLLER = address(0xC011EC7);

    HunterToken[4] sleeveTokens;
    address[] sleeves;

    function setUp() public {
        vm.chainId(4663);
        vm.etch(EXECUTOR, address(new LaunchExecutorIdentityMockV3()).code);
        vm.etch(REGISTRY, address(new LaunchRegistryMockV3()).code);
        vm.etch(WETH, address(new HunterWeth()).code);
        vm.etch(CONTROLLER, hex"00");
        for (uint256 i; i < 4; ++i) {
            sleeveTokens[i] = new HunterToken(string.concat("LP", vm.toString(i)));
            sleeves.push(address(sleeveTokens[i]));
        }
    }

    function _base(bool ready) internal returns (LaunchBaseIndexMockV3 base) {
        base = new LaunchBaseIndexMockV3(CURATOR, CONTROLLER, sleeves, ready);
        for (uint256 i; i < 4; ++i) {
            sleeveTokens[i].mint(address(base), 1 ether);
        }
    }

    function _launch(LaunchBaseIndexMockV3 base) internal returns (HoodxLaunchHunterLaunchV3 launch) {
        launch = new HoodxLaunchHunterLaunchV3(
            address(base), EXECUTOR.codehash, address(base).codehash, 160 ether, 20 ether, 100 ether, 200 ether
        );
    }

    function testLauncherPinsBackedBaseAndAuthority() public {
        LaunchBaseIndexMockV3 base = _base(true);
        HoodxLaunchHunterLaunchV3 launch = _launch(base);
        assertEq(launch.baseIndex(), address(base));
        assertEq(launch.policy().owner(), CURATOR);
        assertEq(launch.vault().curator(), CURATOR);
        assertEq(launch.vault().baseSleeves()[0], address(base));
        assertEq(launch.vault().baseSeedAmounts()[0], 160 ether);
    }

    function testLauncherRejectsUnbootstrappedBase() public {
        LaunchBaseIndexMockV3 base = _base(false);
        vm.expectRevert();
        _launch(base);
    }

    function testBootstrapAtomicallyPullsAllBaseBacking() public {
        LaunchBaseIndexMockV3 base = _base(true);
        HoodxLaunchHunterLaunchV3 launch = _launch(base);
        vm.deal(CURATOR, 20 ether);
        vm.startPrank(CURATOR);
        base.approve(address(launch.vault()), 160 ether);
        launch.vault().bootstrap{value: 20 ether}(CURATOR);
        vm.stopPrank();
        assertEq(base.balanceOf(address(launch.vault())), 160 ether);
        assertEq(base.balanceOf(CURATOR), 0);
        assertEq(launch.vault().balanceOf(CURATOR), 200 ether);
        assertEq(ERC20(WETH).balanceOf(address(launch.vault())), 20 ether);
    }

    function test_RevertWhen_BaseBackingIsShort_LeavesNoPartialBackingOrShares() public {
        LaunchBaseIndexMockV3 base = _base(true);
        HoodxLaunchHunterLaunchV3 launch = _launch(base);
        vm.deal(CURATOR, 20 ether);
        vm.startPrank(CURATOR);
        base.transfer(address(0xBEEF), 1 ether);
        base.approve(address(launch.vault()), 160 ether);
        vm.stopPrank();
        assertEq(base.balanceOf(CURATOR), 159 ether);
        HoodxLaunchHunterV3 vault = launch.vault();
        vm.expectRevert();
        vm.prank(CURATOR);
        vault.bootstrap{value: 20 ether}(CURATOR);
        assertFalse(vault.bootstrapped());
        assertEq(vault.totalSupply(), 0);
        assertEq(base.balanceOf(address(vault)), 0);
        assertEq(base.balanceOf(CURATOR), 159 ether);
    }

    function testUnsolicitedWethCannotExpandImmutableRiskBudget() public {
        LaunchBaseIndexMockV3 base = _base(true);
        HoodxLaunchHunterLaunchV3 launch = _launch(base);
        vm.deal(CURATOR, 20 ether);
        vm.startPrank(CURATOR);
        base.approve(address(launch.vault()), 160 ether);
        launch.vault().bootstrap{value: 20 ether}(CURATOR);
        vm.stopPrank();
        HunterWeth(WETH).mint(address(launch.vault()), 1_000 ether);
        assertEq(launch.vault().riskReferenceAmount(), 100 ether);
        assertEq(launch.vault().MAX_TOTAL_RISK_BPS(), 2000);
    }
}
