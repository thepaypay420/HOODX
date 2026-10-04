// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxBoostVaultV1} from "../../contracts/boost/HoodxBoostVaultV1.sol";
import {MarketParams, IMorphoOracle} from "../../contracts/boost/BoostTypes.sol";

contract MockSignal {
    uint256 public target = 1e18;
    bool public isFresh = true;
    uint256 public lastHour = block.timestamp / 1 hours;

    function set(uint256 t, bool f) external {
        target = t;
        isFresh = f;
        if (f) lastHour = block.timestamp / 1 hours;
    }

    function cap() external pure returns (uint256) {
        return 2e18;
    }
}

interface IMorphoSupply {
    function supply(MarketParams memory, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function withdraw(MarketParams memory, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
    function supplyCollateral(MarketParams memory, uint256 assets, address onBehalf, bytes memory data) external;
    function borrow(MarketParams memory, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
    function market(bytes32 id) external view returns (uint128, uint128, uint128, uint128, uint128, uint128);
}

/// @notice Shared fork setup against live Robinhood Chain: Morpho Blue WETH/USDG 77%, Uniswap V3 WETH/USDG 0.01%, steakUSDG,
///         the market's Chainlink oracle. Run: FOUNDRY_PROFILE=boost forge test --match-contract BoostVaultFork
///         (ROBINHOOD_RPC_URL optional; defaults to the public endpoint). Nothing is broadcast.
abstract contract BoostForkBase is Test {
    address constant MORPHO = 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010;
    bytes32 constant MARKET = 0x7c820d6a09502d63be80bb8025ec479d29d7c06e70f8df65a92aaeed23a366e2;
    address constant POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant CASH = 0xBeEff033F34C046626B8D0A041844C5d1A5409dd;
    address constant ORACLE = 0xE994EcC2C3629F3faE3719F39c66681f173784E4;
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;

    HoodxBoostVaultV1 vault;
    MockSignal sig;
    address curator = makeAddr("curator");
    address fees = makeAddr("fees");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");
    address lender = makeAddr("lender");

    function setUp() public {
        vm.createSelectFork(vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com")));
        sig = new MockSignal();
        vault = new HoodxBoostVaultV1(curator, _config(address(sig)), "HOODX Boosted ETH", "BOOSTX");
        // extra lender liquidity so tests are not capped by the market's live free USDG
        deal(USDG, lender, 2_000_000e6);
        vm.startPrank(lender);
        IERC20(USDG).approve(MORPHO, type(uint256).max);
        IMorphoSupply(MORPHO).supply(_mp(), 2_000_000e6, 0, lender, "");
        vm.stopPrank();
        vm.deal(curator, 10 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.prank(curator);
        vault.bootstrap{value: 1 ether}(curator);
    }

    function _config(address s) internal view returns (HoodxBoostVaultV1.Config memory) {
        return HoodxBoostVaultV1.Config({
            morpho: MORPHO, marketId: MARKET, pool: POOL, weth: WETH, usdg: USDG, cash: CASH, signal: s,
            feeRecipient: fees, minDeposit: 0.005 ether, tvlCapUsdg: 1_000_000e6, maxSliceUsdg: 100_000e6,
            minInterval: 55 minutes, maxSlipBps: 50, emergencySlipBps: 300, maxDivBps: 100
        });
    }

    function _mp() internal pure returns (MarketParams memory) {
        return MarketParams(USDG, WETH, ORACLE, IRM, 0.77e18);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = vault.deposit{value: amount}(who, 0, vm.getBlockTimestamp() + 60);
    }

    function _rebalanceTo(uint256 t) internal {
        sig.set(t, true);
        for (uint256 i; i < 6; ++i) {
            (bool ready,,,,) = vault.rebalanceStatus();
            if (!ready) break;
            vm.prank(keeper);
            vault.rebalance();
            vm.warp(vm.getBlockTimestamp() + 1 hours);
        }
    }

    function _lev() internal view returns (uint256) {
        return vault.state().leverage;
    }
}
