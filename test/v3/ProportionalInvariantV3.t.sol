// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ProportionalV3Fixture} from "./ProportionalV3.t.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {TestTokenV2} from "../v2/VaultV2.t.sol";

contract ProportionalHandlerV3 is Test {
    HoodxProportionalV3 public immutable vault;

    constructor(HoodxProportionalV3 v) {
        vault = v;
    }
    receive() external payable {}

    function join(uint96 raw) external {
        uint256 shares = bound(uint256(raw), 1e15, 1 ether);
        (uint256 cash, uint256[] memory amounts) = vault.requiredContributions(shares);
        uint256 spent = cash + amounts[0] + amounts[1];
        uint256 gross = (spent * 10000 + 9949) / 9950;
        uint256 value = gross < 0.02 ether ? 0.02 ether : gross;
        vault.depositExactShares{value: value}(shares, amounts, amounts, vault.planNonce(), block.timestamp + 300);
    }

    function exit(uint96 raw, bool inKind) external {
        uint256 owned = vault.balanceOf(address(this));
        if (owned == 0) return;
        uint256 shares = bound(uint256(raw), 1, owned);
        if (inKind) {
            vault.emergencyRedeemInKind(shares, address(this));
        } else {
            // Avoid a deliberately zero-value sub-wei redemption in the liveness handler.
            if (shares < 1e12) return;
            uint256[] memory floors = new uint256[](2);
            floors[0] = 1;
            floors[1] = 1;
            vault.withdraw(shares, 1, floors, vault.planNonce(), block.timestamp + 300);
        }
    }
}

contract ProportionalInvariantV3Test is ProportionalV3Fixture {
    uint256 initialSupply;
    uint256 initialA;
    uint256 initialB;
    uint256 initialW;

    function setUp() public override {
        super.setUp();
        seed();
        initialSupply = vault.totalSupply();
        initialA = vault.freeBalance(address(a));
        initialB = vault.freeBalance(address(b));
        initialW = vault.freeBalance(address(w));
        ProportionalHandlerV3 handler = new ProportionalHandlerV3(vault);
        vm.deal(address(handler), 10000 ether);
        vm.deal(address(w), 10000 ether);
        targetContract(address(handler));
    }

    function invariantInitialHolderNeverLosesTokenBacking() public view {
        assertGe(vault.freeBalance(address(a)) * initialSupply, initialA * vault.totalSupply());
        assertGe(vault.freeBalance(address(b)) * initialSupply, initialB * vault.totalSupply());
        assertGe(vault.freeBalance(address(w)) * initialSupply, initialW * vault.totalSupply());
    }

    function invariantClaimsRemainBackedAndAllowancesClosed() public view {
        assertGe(w.balanceOf(address(vault)), vault.reserved(address(w)));
        assertGe(a.balanceOf(address(vault)), vault.reserved(address(a)));
        assertGe(b.balanceOf(address(vault)), vault.reserved(address(b)));
        assertEq(w.allowance(address(vault), address(ex)), 0);
        assertEq(a.allowance(address(vault), address(ex)), 0);
        assertEq(b.allowance(address(vault), address(ex)), 0);
    }
}
