// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {HoodxProportionalV3} from "../../contracts/v3/HoodxProportionalV3.sol";
import {HoodxProportionalPolicyV3} from "../../contracts/v3/HoodxProportionalPolicyV3.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxProportionalFactoryV3} from "../../contracts/v3/HoodxProportionalFactoryV3.sol";
import {HoodxIndexV2} from "../../contracts/v2/HoodxIndexV2.sol";
import {ProportionalWatchlistV3} from "../../script/ProportionalWatchlistV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// Full watchlist execution/accounting integration. Fork only, no live approval.
contract ProportionalBasketForkTest is SuccessorWatchlistForkTest {
    receive() external payable {}

    function routeFor(uint256 i) internal pure returns (address token, bytes memory buy, bytes memory sell) {
        return ProportionalWatchlistV3.routeFor(i);
    }

    function payload(bytes memory reason, bytes4 selector) internal pure returns (bytes memory data) {
        require(reason.length >= 4 && bytes4(reason) == selector, "wrong quote response");
        data = new bytes(reason.length - 4);
        for (uint256 i; i < data.length; ++i) {
            data[i] = reason[i + 4];
        }
    }

    function buyOutputs(HoodxProportionalV3 vault, uint256[] memory budgets)
        internal
        returns (uint256[] memory outputs)
    {
        uint256 funding;
        for (uint256 i; i < budgets.length; ++i) {
            funding += budgets[i];
        }
        (bool ok, bytes memory reason) = address(vault).call{value: funding}(abi.encodeCall(vault.quoteBuys, (budgets)));
        assertFalse(ok);
        outputs = abi.decode(payload(reason, HoodxProportionalV3.BuyQuote.selector), (uint256[]));
    }

    function vaultFloors(HoodxProportionalV3 vault, address holder, uint256 shares)
        internal
        returns (uint256[] memory floors)
    {
        vm.prank(holder);
        (bool ok, bytes memory reason) = address(vault).call(abi.encodeCall(vault.quoteWithdrawal, (shares)));
        assertFalse(ok);
        (uint256 cash, uint256[] memory outputs) =
            abi.decode(payload(reason, HoodxProportionalV3.WithdrawalQuote.selector), (uint256, uint256[]));
        assertEq(cash, vault.freeBalance(W) * shares / vault.totalSupply());
        floors = new uint256[](outputs.length);
        for (uint256 i; i < outputs.length; ++i) {
            floors[i] = outputs[i] * 9700 / 10000;
            assertGt(floors[i], 0);
        }
    }

    function testProportionalFullWatchlistLifecycle() public {
        address qh = address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
        HoodxHookRegistryV3 registry = new HoodxHookRegistryV3(address(this));
        uint256 now_ = vm.getBlockTimestamp();
        vm.warp(now_ - 2 days);
        registry.propose(qh, bytes32(uint256(1)));
        vm.warp(now_);
        registry.activate(qh);
        HoodxRoutingV3 router = new HoodxRoutingV3(
            address(ex),
            address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")),
            address(registry),
            address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),
            qh
        );
        HoodxProportionalPolicyV3 policy = new HoodxProportionalPolicyV3(address(this), address(router));
        HoodxFeeModelV3 fees =
            new HoodxFeeModelV3(address(router), qh, address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044")));
        bytes32[] memory ids = new bytes32[](20);
        uint16[] memory weights = new uint16[](20);
        uint256[] memory floors = new uint256[](20);
        bytes[] memory sells = new bytes[](20);
        address[] memory tokens = new address[](20);
        uint256 gross = vm.envOr("HOODX_CANARY_TEST_SEED", uint256(0.08 ether));
        uint256 net = gross * 9950 / 10000;
        uint256 seedBudget = net * 375 / 10000;
        for (uint256 i; i < 20; ++i) {
            bytes memory buy;
            (tokens[i], buy, sells[i]) = routeFor(i);
            ids[i] = policy.approveRoute(tokens[i], buy, sells[i], ProportionalWatchlistV3.evidence());
            weights[i] = 375;
        }
        HoodxProportionalV3 impl = new HoodxProportionalV3(address(policy), address(fees));
        HoodxProportionalV3 vault = HoodxProportionalV3(payable(Clones.clone(address(impl))));
        vault.initialize(
            HoodxProportionalV3.Init(
                address(this),
                address(this),
                address(0x888),
                address(0x777),
                "Watchlist",
                "LIST",
                40,
                10,
                2500,
                0.02 ether,
                ""
            ),
            ids,
            weights
        );
        vm.deal(address(this), 100 ether);
        uint256[] memory seedBudgets = new uint256[](20);
        for (uint256 i; i < 20; ++i) {
            seedBudgets[i] = seedBudget;
        }
        floors = buyOutputs(vault, seedBudgets);
        for (uint256 i; i < 20; ++i) {
            floors[i] = floors[i] * 9700 / 10000;
            assertGt(floors[i], 0);
        }
        vault.bootstrap{value: gross}(floors, vault.planNonce(), block.timestamp + 300);
        uint256 initialShares = vault.totalSupply();
        uint256[] memory initial = new uint256[](20);
        for (uint256 i; i < 20; ++i) {
            initial[i] = vault.freeBalance(tokens[i]);
            assertGt(initial[i], 0);
        }
        uint256 cashBefore = vault.freeBalance(W);
        uint256 joinBudget = Math.max(0.02 ether, gross * 5 / 8);
        (uint256 shares, uint256[] memory budgets, uint256[] memory needed) = solveJoin(vault, tokens, joinBudget);
        address newcomer = address(0xBEEF);
        vm.deal(newcomer, 100 ether);
        uint256 nonce = vault.planNonce();
        vm.prank(newcomer);
        vault.depositExactShares{value: joinBudget}(shares, budgets, needed, nonce, block.timestamp + 300);
        for (uint256 i; i < 20; ++i) {
            assertGe(vault.freeBalance(tokens[i]) * initialShares, initial[i] * vault.totalSupply());
        }
        assertGe(vault.freeBalance(W) * initialShares, cashBefore * vault.totalSupply());
        // Partial ETH redemption first, then the rest in kind while paused.
        uint256 partialShares = shares / 2;
        floors = vaultFloors(vault, newcomer, partialShares);
        uint256 minimumEth = vault.freeBalance(W) * partialShares / vault.totalSupply();
        for (uint256 i; i < floors.length; ++i) {
            minimumEth += floors[i];
        }
        nonce = vault.planNonce();
        vm.prank(newcomer);
        vault.withdraw(partialShares, minimumEth, floors, nonce, block.timestamp + 300);
        vault.setPaused(true);
        vm.prank(newcomer);
        vault.emergencyRedeemInKind(shares - partialShares, newcomer);
        for (uint256 i; i < 20; ++i) {
            assertGe(vault.freeBalance(tokens[i]), initial[i]);
            assertEq(vault.claimable(newcomer, tokens[i]), 0);
        }
        floors = vaultFloors(vault, address(this), initialShares);
        minimumEth = vault.freeBalance(W);
        for (uint256 i; i < floors.length; ++i) {
            minimumEth += floors[i];
        }
        vault.withdraw(initialShares, minimumEth, floors, vault.planNonce(), block.timestamp + 300);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.freeBalance(W), 0);
        for (uint256 i; i < 20; ++i) {
            assertEq(vault.freeBalance(tokens[i]), 0);
            assertEq(IERC20(tokens[i]).balanceOf(address(router)), 0);
        }
    }

    // Same bounded quantity-based solver as the frontend, exercised against actual pool execution.
    function solveJoin(HoodxProportionalV3 vault, address[] memory tokens, uint256 maxEth)
        internal
        returns (uint256 shares, uint256[] memory budgets, uint256[] memory floors)
    {
        uint256 net = maxEth * 9950 / 10000;
        uint256 cash = vault.freeBalance(W);
        uint256 supply = vault.totalSupply();
        uint256[] memory balances = new uint256[](tokens.length);
        budgets = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            balances[i] = vault.freeBalance(tokens[i]);
            budgets[i] = net * 3 / 4 / tokens.length;
        }
        uint256[] memory outputs;
        for (uint256 iteration; iteration < 4; ++iteration) {
            outputs = buyOutputs(vault, budgets);
            if (iteration == 3) break;
            uint256[] memory costs = new uint256[](tokens.length);
            uint256 total = cash;
            for (uint256 i; i < tokens.length; ++i) {
                assertGt(outputs[i], 0);
                costs[i] = Math.mulDiv(balances[i], budgets[i], outputs[i], Math.Rounding.Ceil);
                total += costs[i];
            }
            for (uint256 i; i < tokens.length; ++i) {
                budgets[i] = Math.mulDiv(net, costs[i], total);
            }
        }
        uint256 spent;
        for (uint256 i; i < tokens.length; ++i) {
            spent += budgets[i];
        }
        shares = Math.mulDiv(net - spent, supply, cash);
        floors = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            floors[i] = outputs[i] * 9700 / 10000;
            shares = Math.min(shares, Math.mulDiv(floors[i], supply, balances[i]));
        }
        assertGe(shares, vault.MIN_SHARES());
    }
}

/// Exercises the exact live infrastructure on a disposable fork. No live transaction is sent.
contract ProportionalLiveInfrastructureForkTest is ProportionalBasketForkTest {
    address constant LIVE_DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant LIVE_CURATOR = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6;
    address constant LIVE_REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant LIVE_ROUTING = 0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE;
    address constant LIVE_POLICY = 0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21;
    address constant LIVE_FACTORY = 0xb0a89074d2f88207698aC99f39061463eeabeC8a;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant QUOTRON_HOOK = 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc;
    uint256 constant READY_AT = 1790322086;

    function testLiveInfrastructureCanaryAndPermissionlessFutureVault() public {
        HoodxHookRegistryV3 registry = HoodxHookRegistryV3(LIVE_REGISTRY);
        vm.warp(READY_AT);
        registry.activate(PONS_HOOK);
        registry.activate(QUOTRON_HOOK);

        HoodxProportionalPolicyV3 policy = HoodxProportionalPolicyV3(LIVE_POLICY);
        bytes32[] memory ids = new bytes32[](20);
        uint16[] memory weights = new uint16[](20);
        address[] memory tokens = new address[](20);
        vm.startPrank(LIVE_DEPLOYER);
        for (uint256 i; i < 20; ++i) {
            bytes memory buy;
            bytes memory sell;
            (tokens[i], buy, sell) = routeFor(i);
            ids[i] = policy.approveRoute(tokens[i], buy, sell, ProportionalWatchlistV3.evidence());
            weights[i] = 375;
        }
        HoodxProportionalFactoryV3 factory = HoodxProportionalFactoryV3(LIVE_FACTORY);
        HoodxIndexV2.Init memory init = HoodxIndexV2.Init(
            LIVE_CURATOR,
            LIVE_DEPLOYER,
            LIVE_CURATOR,
            LIVE_CURATOR,
            "696X Successor Canary",
            "696XC",
            40,
            10,
            2500,
            0.02 ether,
            ""
        );
        HoodxProportionalV3 vault = HoodxProportionalV3(payable(factory.create("696xcanary", init, ids, weights)));
        vm.stopPrank();
        assertEq(vault.owner(), LIVE_CURATOR);
        assertEq(vault.creator(), LIVE_DEPLOYER);
        _exerciseLiveCanary(vault, tokens, 0.02 ether);

        // Any user can create a future vault from the same admitted route IDs.
        address futureCreator = address(0xF077);
        bytes32[] memory futureIds = new bytes32[](2);
        futureIds[0] = ids[0];
        futureIds[1] = ids[1];
        uint16[] memory futureWeights = new uint16[](2);
        futureWeights[0] = 3750;
        futureWeights[1] = 3750;
        init = HoodxIndexV2.Init(
            futureCreator,
            futureCreator,
            futureCreator,
            LIVE_CURATOR,
            "Future User Basket",
            "FUTURE",
            20,
            10,
            2500,
            0.02 ether,
            ""
        );
        vm.prank(futureCreator);
        HoodxProportionalV3 future =
            HoodxProportionalV3(payable(factory.create("futurebasket", init, futureIds, futureWeights)));
        assertEq(future.owner(), futureCreator);
        assertEq(future.creator(), futureCreator);
        assertEq(future.constituents().length, 2);
    }

    function _exerciseLiveCanary(HoodxProportionalV3 vault, address[] memory tokens, uint256 gross) private {
        vm.deal(address(this), 100 ether);
        uint256 seedBudget = (gross * 9950 / 10000) * 375 / 10000;
        uint256[] memory seedBudgets = new uint256[](20);
        for (uint256 i; i < 20; ++i) {
            seedBudgets[i] = seedBudget;
        }
        uint256[] memory floors = buyOutputs(vault, seedBudgets);
        for (uint256 i; i < 20; ++i) {
            floors[i] = floors[i] * 9700 / 10000;
            assertGt(floors[i], 0);
        }
        vm.deal(LIVE_DEPLOYER, 1 ether);
        _bootstrapAs(vault, LIVE_DEPLOYER, gross, floors);
        uint256 initialShares = vault.totalSupply();
        uint256[] memory initial = new uint256[](20);
        for (uint256 i; i < 20; ++i) {
            initial[i] = vault.freeBalance(tokens[i]);
            assertGt(initial[i], 0);
        }
        uint256 cashBefore = vault.freeBalance(W);
        (uint256 shares, uint256[] memory budgets, uint256[] memory needed) = solveJoin(vault, tokens, 0.02 ether);
        address newcomer = address(0xBEEF);
        vm.deal(newcomer, 1 ether);
        _depositAs(vault, newcomer, shares, budgets, needed);
        for (uint256 i; i < 20; ++i) {
            assertGe(vault.freeBalance(tokens[i]) * initialShares, initial[i] * vault.totalSupply());
        }
        assertGe(vault.freeBalance(W) * initialShares, cashBefore * vault.totalSupply());

        uint256 partialShares = shares / 2;
        floors = vaultFloors(vault, newcomer, partialShares);
        uint256 minimumEth = vault.freeBalance(W) * partialShares / vault.totalSupply();
        for (uint256 i; i < floors.length; ++i) {
            minimumEth += floors[i];
        }
        _withdrawAs(vault, newcomer, partialShares, minimumEth, floors);
        vm.prank(LIVE_CURATOR);
        vault.setPaused(true);
        vm.prank(newcomer);
        vault.emergencyRedeemInKind(shares - partialShares, newcomer);
        for (uint256 i; i < 20; ++i) {
            assertGe(vault.freeBalance(tokens[i]), initial[i]);
            assertEq(vault.claimable(newcomer, tokens[i]), 0);
        }
        floors = vaultFloors(vault, LIVE_DEPLOYER, initialShares);
        minimumEth = vault.freeBalance(W);
        for (uint256 i; i < floors.length; ++i) {
            minimumEth += floors[i];
        }
        _withdrawAs(vault, LIVE_DEPLOYER, initialShares, minimumEth, floors);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.freeBalance(W), 0);
        for (uint256 i; i < 20; ++i) {
            assertEq(vault.freeBalance(tokens[i]), 0);
            assertEq(IERC20(tokens[i]).balanceOf(LIVE_ROUTING), 0);
        }
    }

    function _bootstrapAs(HoodxProportionalV3 vault, address signer, uint256 gross, uint256[] memory floors) private {
        uint256 nonce = vault.planNonce();
        vm.prank(signer);
        vault.bootstrap{value: gross}(floors, nonce, block.timestamp + 300);
    }

    function _depositAs(
        HoodxProportionalV3 vault,
        address signer,
        uint256 shares,
        uint256[] memory budgets,
        uint256[] memory floors
    ) private {
        uint256 nonce = vault.planNonce();
        vm.prank(signer);
        vault.depositExactShares{value: 0.02 ether}(shares, budgets, floors, nonce, block.timestamp + 300);
    }

    function _withdrawAs(
        HoodxProportionalV3 vault,
        address signer,
        uint256 shares,
        uint256 minimumEth,
        uint256[] memory floors
    ) private {
        uint256 nonce = vault.planNonce();
        vm.prank(signer);
        vault.withdraw(shares, minimumEth, floors, nonce, block.timestamp + 300);
    }
}
