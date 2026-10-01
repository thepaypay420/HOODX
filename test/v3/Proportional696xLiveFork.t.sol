// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ProportionalBasketForkTest} from "./ProportionalBasketFork.t.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {HoodxRouteAdminV3} from "../../contracts/v3/HoodxRouteAdminV3.sol";
import {HoodxProportionalFactoryV3} from "../../contracts/v3/HoodxProportionalFactoryV3.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {HoodxAtomicFactoryV3} from "../../contracts/v3/HoodxAtomicFactoryV3.sol";
import {HoodxRebalanceControllerV3} from "../../contracts/v3/HoodxRebalanceControllerV3.sol";

interface IV2Vault696 {
    function constituents() external view returns (address[] memory);
    function configId(address) external view returns (bytes32);
    function targetBps(address) external view returns (uint16);
    function policy() external view returns (address);
    function creator() external view returns (address);
    function creatorRecipient() external view returns (address);
    function creatorFeeBps() external view returns (uint16);
}

interface IV2PolicyRead696 {
    function config(bytes32) external view returns (address, address, bytes memory, bytes memory);
}

/// Rehearses moving $696X onto the DEPLOYED proportional (oracle-free) infrastructure. Fork only: nothing is sent.
/// Uses the exact live route admin, policy, factory and implementation, and the V2 vault's current routes.
contract Proportional696xLiveForkTest is ProportionalBasketForkTest {
    address constant V2_696X = 0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292;
    address constant CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant ROUTE_ADMIN = 0x49bAe4Eb7b7a7567f67A600Ca8752027e9d12Fa3;
    address constant FACTORY = 0xb0a89074d2f88207698aC99f39061463eeabeC8a;
    address constant ATOMIC_FACTORY = 0x29349C79863B58E7ab470865F7C6Df0b31dC7C17;
    bytes32 constant EVIDENCE = keccak256("HOODX 696X proportional migration rehearsal 2026-10-01");

    function _basket()
        internal
        view
        returns (address[] memory tokens, bytes[] memory buys, bytes[] memory sells, uint16[] memory weights)
    {
        IV2Vault696 v2 = IV2Vault696(V2_696X);
        IV2PolicyRead696 pol = IV2PolicyRead696(v2.policy());
        address[] memory all = v2.constituents();
        uint256 n;
        uint256 sum;
        for (uint256 i; i < all.length; ++i) {
            if (v2.targetBps(all[i]) != 0) {
                ++n;
                sum += v2.targetBps(all[i]);
            }
        }
        tokens = new address[](n);
        buys = new bytes[](n);
        sells = new bytes[](n);
        weights = new uint16[](n);
        uint256 k;
        uint256 assigned;
        for (uint256 i; i < all.length; ++i) {
            uint16 target = v2.targetBps(all[i]);
            if (target == 0) continue;
            tokens[k] = all[i];
            (,, buys[k], sells[k]) = pol.config(v2.configId(all[i]));
            // keep today's relative weights, rescaled so holdings + 25% cash = 100%
            weights[k] = uint16(uint256(target) * 7500 / sum);
            assigned += weights[k];
            ++k;
        }
        weights[0] += uint16(7500 - assigned);
    }

    function test696xMigrationRehearsal() public {
        (address[] memory tokens, bytes[] memory buys, bytes[] memory sells, uint16[] memory weights) = _basket();
        assertEq(tokens.length, 8);

        // 1. curator approves the eight routes on the live proportional policy (one transaction)
        vm.prank(CURATOR);
        bytes32[] memory ids = HoodxRouteAdminV3(ROUTE_ADMIN).approveRoutes(tokens, buys, sells, EVIDENCE);

        // 2. factory owner creates the reserved "696x" proportional vault
        HoodxProportionalFactoryV3 factory = HoodxProportionalFactoryV3(FACTORY);
        IV2Vault696 v2 = IV2Vault696(V2_696X);
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init(
            CURATOR, v2.creator(), v2.creatorRecipient(), factory.treasury(), "696X", "696X", v2.creatorFeeBps(), 10, 2500, 0.02 ether, ""
        );
        vm.prank(factory.owner());
        HoodxProportionalV3 vault = HoodxProportionalV3(payable(factory.create("696x", init, ids, weights)));
        assertEq(vault.owner(), CURATOR);
        assertEq(vault.constituents().length, 8);
        for (uint256 i; i < tokens.length; ++i) {
            console2.log(IERC20Metadata(tokens[i]).symbol(), "target bps", weights[i]);
        }

        _lifecycle(vault, tokens, weights, address(0));
    }

    /// Seed, join/exit at several sizes, in-kind exit while paused, then empty the vault.
    /// `controller` is the vault owner when created through the atomic factory (zero = curator owns it directly).
    function _lifecycle(HoodxProportionalV3 vault, address[] memory tokens, uint16[] memory weights, address controller) private {
        uint256 nonce;
        vm.deal(address(this), 100 ether); // quotes are funded eth_call-style probes that always revert
        // 3. curator seeds it
        uint256 seed = 0.05 ether;
        uint256[] memory budgets = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            budgets[i] = seed * 9950 / 10000 * weights[i] / 10000;
        }
        _probeEach(vault, tokens, budgets);
        uint256[] memory floors = buyOutputs(vault, budgets);
        for (uint256 i; i < floors.length; ++i) {
            floors[i] = floors[i] * 9700 / 10000;
            assertGt(floors[i], 0);
        }
        vm.deal(CURATOR, 10 ether);
        nonce = vault.planNonce();
        vm.prank(CURATOR);
        vault.bootstrap{value: seed}(floors, nonce, block.timestamp + 300);
        uint256 seedShares = vault.balanceOf(CURATOR);
        assertGt(seedShares, 0);
        console2.log("seeded (wei)", seed, "shares", seedShares);

        // 4. users join with ETH and exit to ETH at several sizes: every holding trades, no price oracle involved
        uint256[4] memory sizes = [uint256(0.02 ether), 0.1 ether, 0.5 ether, 2 ether];
        for (uint256 s; s < sizes.length; ++s) {
            _roundTrip(vault, tokens, sizes[s], address(uint160(0xA11CE000 + s)));
        }

        // 5. in-kind exit: pause, redeem, receive every token directly
        address holder = address(0xB0B);
        vm.deal(holder, 1 ether);
        (uint256 shares, uint256[] memory b2, uint256[] memory f2) = solveJoin(vault, tokens, 0.05 ether);
        nonce = vault.planNonce();
        vm.prank(holder);
        vault.depositExactShares{value: 0.05 ether}(shares, b2, f2, nonce, block.timestamp + 300);
        _pause(vault, controller, true);
        vm.prank(holder);
        vault.emergencyRedeemInKind(shares, holder);
        for (uint256 i; i < tokens.length; ++i) {
            assertGt(IERC20(tokens[i]).balanceOf(holder), 0);
            assertEq(vault.claimable(holder, tokens[i]), 0);
        }
        assertEq(vault.balanceOf(holder), 0);
        _pause(vault, controller, false);

        // 6. curator exits the seed: vault empties completely
        floors = vaultFloors(vault, CURATOR, seedShares);
        uint256 minEth = vault.freeBalance(W);
        for (uint256 i; i < floors.length; ++i) {
            minEth += floors[i];
        }
        nonce = vault.planNonce();
        vm.prank(CURATOR);
        vault.withdraw(seedShares, minEth, floors, nonce, block.timestamp + 300);
        assertEq(vault.totalSupply(), 0);
        for (uint256 i; i < tokens.length; ++i) {
            assertEq(vault.freeBalance(tokens[i]), 0);
        }
    }

    /// Diagnostic: quote each holding's buy on its own, so a failing route is named instead of masked.
    function _probeEach(HoodxProportionalV3 vault, address[] memory tokens, uint256[] memory budgets) private {
        for (uint256 i; i < tokens.length; ++i) {
            uint256[] memory one = new uint256[](tokens.length);
            one[i] = budgets[i];
            (bool ok, bytes memory reason) = address(vault).call{value: budgets[i]}(abi.encodeCall(vault.quoteBuys, (one)));
            ok;
            bool quoted = reason.length >= 4 && bytes4(reason) == HoodxProportionalV3.BuyQuote.selector;
            console2.log(IERC20Metadata(tokens[i]).symbol(), quoted ? "buy quote OK, budget wei" : "BUY QUOTE FAILED, budget wei", budgets[i]);
        }
    }

    function _pause(HoodxProportionalV3 vault, address controller, bool value) private {
        vm.prank(CURATOR);
        if (controller == address(0)) vault.setPaused(value);
        else HoodxRebalanceControllerV3(controller).setPaused(value);
    }

    /// The path we intend to use: everything signed by the curator through the atomic factory the HUD resolves.
    function test696xAtomicMigrationRehearsal() public {
        (address[] memory tokens, bytes[] memory buys, bytes[] memory sells, uint16[] memory weights) = _basket();
        HoodxAtomicFactoryV3 atomic = HoodxAtomicFactoryV3(ATOMIC_FACTORY);
        assertEq(atomic.owner(), CURATOR);
        vm.startPrank(CURATOR);
        bytes32[] memory ids = HoodxRouteAdminV3(ROUTE_ADMIN).approveRoutes(tokens, buys, sells, EVIDENCE);   // tx 1
        atomic.registerConfigs(ids);                                                                          // tx 2
        HoodxIndexV2.Init memory init =
            HoodxIndexV2.Init(CURATOR, CURATOR, CURATOR, atomic.treasury(), "696X", "696X", 40, 10, 2500, 0.02 ether, "");
        (address v, address controller) = atomic.createAtomic("696x", init, ids, weights);                    // tx 3
        vm.stopPrank();
        HoodxProportionalV3 vault = HoodxProportionalV3(payable(v));
        assertEq(atomic.bySlug("696x"), v);
        assertEq(vault.owner(), controller);
        assertEq(vault.creator(), CURATOR);
        assertEq(vault.creatorFeeBps(), 40);
        _lifecycle(vault, tokens, weights, controller);                                                       // tx 4 = seed
    }

    function _roundTrip(HoodxProportionalV3 vault, address[] memory tokens, uint256 amount, address user) private {
        vm.deal(user, amount);
        (uint256 shares, uint256[] memory budgets, uint256[] memory floors) = solveJoin(vault, tokens, amount);
        uint256 nonce = vault.planNonce();
        vm.prank(user);
        vault.depositExactShares{value: amount}(shares, budgets, floors, nonce, block.timestamp + 300);
        uint256 spent = amount - user.balance;
        assertEq(vault.balanceOf(user), shares);
        // Surplus: tokens bought beyond what the minted shares needed are paid to the depositor, not lost.
        uint256 surplusWei;
        for (uint256 i; i < tokens.length; ++i) {
            uint256 got = IERC20(tokens[i]).balanceOf(user) + vault.claimable(user, tokens[i]);
            surplusWei += budgets[i] * got / (floors[i] * 10000 / 9700);
        }

        uint256[] memory out = vaultFloors(vault, user, shares);
        uint256 minEth = vault.freeBalance(W) * shares / vault.totalSupply();
        for (uint256 i; i < out.length; ++i) {
            minEth += out[i];
        }
        nonce = vault.planNonce();
        uint256 before = user.balance;
        vm.prank(user);
        vault.withdraw(shares, minEth, out, nonce, block.timestamp + 300);
        uint256 back = user.balance - before;
        assertEq(vault.balanceOf(user), 0);
        console2.log("join (wei)", amount, "ETH spent", spent);
        console2.log("   exit returned", back, "round-trip cost bps", (spent - back) * 10000 / spent);
        console2.log("   surplus tokens kept by user (wei of ETH spent on them)", surplusWei, "cost bps net of surplus", (spent - back - surplusWei) * 10000 / spent);
    }
}
