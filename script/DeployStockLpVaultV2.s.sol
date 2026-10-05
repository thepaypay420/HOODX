// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {HoodxStockLpSleeveV2} from "../contracts/liquidity/v4/HoodxStockLpSleeveV2.sol";
import {HoodxStockLpControllerV2} from "../contracts/liquidity/v4/HoodxStockLpControllerV2.sol";
import {HoodxStockLpVaultV1} from "../contracts/liquidity/v4/HoodxStockLpVaultV1.sol";
import {HoodxStockLpSeederV1, ISeedController} from "../contracts/liquidity/v4/HoodxStockLpSeederV1.sol";
import {IPriceReference, IV4StateView, PoolKey} from "../contracts/liquidity/v4/V4Types.sol";
import {HoodxTwapV2} from "../contracts/v2/HoodxTwapV2.sol";

interface IV3ObservedPool {
    function slot0()
        external
        view
        returns (uint160, int24, uint16 observationIndex, uint16 observationCardinality, uint16, uint8, bool);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
}

/// @notice Deploys the reviewed HOODX Stock LP vault V2 "autopilot" (deployer transactions only).
/// @dev Creates one HoodxTwapV2 reference, one sleeve per manifest entry, the vault and the controller;
///      wires the vault into every sleeve, hands all ownership to the controller and activates it.
///      Then a one-shot seeder (the controller's immutable bootstrap authority) turns `seedEthWei` into the
///      seed positions and mints the initial shares to the treasury, refunding leftovers in the same call.
///      Manifest: deployments/stock-lp-vault-manifest.json (or HOODX_STOCK_LP_MANIFEST).
contract DeployStockLpVaultV2 is Script {
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address internal constant TREASURY = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6; // curator + fee recipient
    address internal constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    uint24 internal constant ETH_POOL_FEE = 100;
    uint16 internal constant MIN_OBSERVATIONS = 300;
    int24 internal constant ETH_POOL_SPACING = 1;

    struct Entry {
        string symbol;
        address token;
        PoolKey lp;
        PoolKey swap;
        address v3Pool;
        int24 halfWidth;
        int24 makerWidth;
    }

    struct Deployed {
        address[] sleeves;
        address[] refs;
        HoodxStockLpVaultV1 vault;
        HoodxStockLpControllerV2 controller;
        HoodxStockLpSeederV1 seeder;
        uint256 initialShares;
    }

    function run() external returns (Deployed memory d) {
        require(block.chainid == 4663, "wrong chain");
        string memory json = vm.readFile(vm.envOr("HOODX_STOCK_LP_MANIFEST", string("deployments/stock-lp-vault-v2-manifest.json")));
        Entry[] memory e = _entries(json);
        uint16 perfBps = uint16(vm.parseJsonUint(json, ".perfFeeBps"));
        uint256 minDeposit = vm.parseJsonUint(json, ".minDepositUsdg");
        uint256 cap = vm.parseJsonUint(json, ".tvlCapUsdg");
        uint256 seedEth = vm.parseJsonUint(json, ".seedEthWei");
        // Optional (STKX v3): how long a sleeve stays out of range before the autopilot re-places it. The controller
        // itself bounds this to 15 minutes .. 3 days. Absent: the original 24 h.
        uint32 breachDelay = uint32(_uintOr(json, ".breachDelaySeconds", 24 hours));
        require(DEPLOYER.balance >= seedEth + 0.004 ether, "deployer needs seed + gas");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(
                keccak256(bytes(vm.parseJsonString(json, ".status"))) == keccak256("APPROVED"), "manifest not approved"
            );
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("stock-lp-vault-v2"),
                "wrong deployment stage"
            );
            require(vm.envBytes32("HOODX_REVIEWED_BUILD") == buildFingerprint(), "reviewed build mismatch");
            require(vm.getNonce(DEPLOYER) == vm.envUint("HOODX_STOCK_LP_DEPLOYER_NONCE"), "deployer nonce changed");
        }
        console2.log("Reviewed build fingerprint");
        console2.logBytes32(buildFingerprint());

        uint256 n = e.length;
        d.sleeves = new address[](n);
        d.refs = new address[](n);
        PoolKey[] memory swapKeys = new PoolKey[](n);
        HoodxStockLpControllerV2.Policy[] memory pol = new HoodxStockLpControllerV2.Policy[](n);

        // Every TWAP reference must keep enough observations to serve a 30-minute TWAP after any trade.
        for (uint256 i; i < n; ++i) {
            (,,, uint16 card,,,) = IV3ObservedPool(e[i].v3Pool).slot0();
            require(card >= MIN_OBSERVATIONS, string.concat("reference pool keeps too few observations: ", e[i].symbol));
            uint32[] memory ago = new uint32[](2);
            ago[0] = 1800;
            IV3ObservedPool(e[i].v3Pool).observe(ago);
        }
        vm.startBroadcast(DEPLOYER);
        d.seeder = new HoodxStockLpSeederV1(PM, USDG, DEPLOYER, ETH_POOL_FEE, ETH_POOL_SPACING);
        for (uint256 i; i < n; ++i) {
            d.refs[i] = address(new HoodxTwapV2(V3_FACTORY, e[i].token, USDG, e[i].v3Pool, address(0), 1800, 1, 0));
            (, int24 tick, uint24 protocolFee,) = IV4StateView(STATE_VIEW).getSlot0(keccak256(abi.encode(e[i].lp)));
            int24 c = _floor(tick, e[i].lp.tickSpacing);
            d.sleeves[i] = address(
                new HoodxStockLpSleeveV2(
                    DEPLOYER, PM, STATE_VIEW, e[i].lp, protocolFee, c - e[i].halfWidth, c + e[i].halfWidth, TREASURY,
                    perfBps, string.concat("HOODX Stock LP ", e[i].symbol), string.concat("hx", e[i].symbol)
                )
            );
            swapKeys[i] = e[i].swap;
            pol[i] = HoodxStockLpControllerV2.Policy({
                halfWidth: e[i].halfWidth,
                makerWidth: e[i].makerWidth,
                maxDivergenceBps: 150,
                breachDelay: breachDelay,
                cooldown: 1 hours,
                priceRef: IPriceReference(d.refs[i]),
                tokenDecimals: IERC20Metadata(e[i].token).decimals(),
                quoteDecimals: 6
            });
        }
        d.vault = new HoodxStockLpVaultV1(
            DEPLOYER, PM, USDG, ETH_POOL_FEE, ETH_POOL_SPACING, d.sleeves, swapKeys, minDeposit, cap,
            uint16(vm.parseJsonUint(json, ".bufferBps")), vm.parseJsonString(json, ".strategy"), "HOODX Stock LP", "STKX"
        );
        for (uint256 i; i < n; ++i) {
            HoodxStockLpSleeveV2(d.sleeves[i]).setVault(address(d.vault));
        }
        d.controller =
            new HoodxStockLpControllerV2(address(d.vault), TREASURY, DEPLOYER, address(d.seeder), d.sleeves, pol);
        d.vault.transferOwnership(address(d.controller));
        for (uint256 i; i < n; ++i) {
            HoodxStockLpSleeveV2(d.sleeves[i]).transferOwnership(address(d.controller));
        }
        d.controller.activate();
        d.initialShares = d.seeder.seed{value: seedEth}(ISeedController(address(d.controller)), TREASURY, 500);
        vm.stopBroadcast();

        _verify(d, n, perfBps);
    }

    function _verify(Deployed memory d, uint256 n, uint16 perfBps) internal view {
        require(d.controller.activated(), "controller not active");
        require(d.vault.owner() == address(d.controller), "vault owner");
        require(d.vault.bootstrapped(), "not bootstrapped");
        require(d.vault.balanceOf(TREASURY) == d.initialShares && d.initialShares > 0, "seed shares");
        require(address(d.seeder).balance == 0, "seeder kept ETH");
        require(d.controller.curator() == TREASURY, "curator");
        for (uint256 i; i < n; ++i) {
            HoodxStockLpSleeveV2 s = HoodxStockLpSleeveV2(d.sleeves[i]);
            require(s.owner() == address(d.controller), "sleeve owner");
            require(s.vault() == address(d.vault), "sleeve vault");
            require(s.feeRecipient() == TREASURY && s.feeBps() == perfBps, "fee terms");
            require(s.balanceOf(address(d.vault)) > 0 && s.positionLiquidity() > 0, "sleeve not seeded");
            uint256 div = d.controller.divergenceBps(i);
            require(div <= 150, "reference disagrees with pool: seeding would fail");
            console2.log("Sleeve", d.sleeves[i]);
            console2.log("  TWAP reference", d.refs[i]);
            console2.log("  pool vs reference (bps)", div);
        }
        console2.log("Vault", address(d.vault));
        console2.log("Controller", address(d.controller));
        console2.log("Seeder (spent)", address(d.seeder));
        console2.log("Initial shares to treasury", d.initialShares);
    }

    function _entries(string memory json) internal view returns (Entry[] memory e) {
        uint256 n = vm.parseJsonUint(json, ".count");
        require(n >= 1 && n <= 8, "basket size");
        e = new Entry[](n);
        for (uint256 i; i < n; ++i) {
            string memory p = string.concat(".sleeves[", vm.toString(i), "]");
            e[i].symbol = vm.parseJsonString(json, string.concat(p, ".symbol"));
            e[i].token = vm.parseJsonAddress(json, string.concat(p, ".token"));
            e[i].lp = _key(json, e[i].token, string.concat(p, ".lp"));
            e[i].swap = _key(json, e[i].token, string.concat(p, ".swap"));
            e[i].v3Pool = vm.parseJsonAddress(json, string.concat(p, ".v3Pool"));
            e[i].halfWidth = int24(vm.parseJsonInt(json, string.concat(p, ".halfWidthTicks")));
            require(e[i].halfWidth % e[i].lp.tickSpacing == 0, "half width not on spacing");
            // Optional per sleeve: width of the one-sided range after a re-placement. Absent: twice the half width.
            e[i].makerWidth = int24(int256(_uintOr(json, string.concat(p, ".makerWidthTicks"), uint256(int256(2 * e[i].halfWidth)))));
            require(e[i].makerWidth > 0 && e[i].makerWidth % e[i].lp.tickSpacing == 0, "maker width not on spacing");
        }
    }

    function _uintOr(string memory json, string memory key, uint256 fallbackValue) internal view returns (uint256) {
        return vm.keyExistsJson(json, key) ? vm.parseJsonUint(json, key) : fallbackValue;
    }

    function _key(string memory json, address token, string memory p) internal pure returns (PoolKey memory) {
        (address c0, address c1) = token < USDG ? (token, USDG) : (USDG, token);
        return PoolKey(
            c0,
            c1,
            uint24(vm.parseJsonUint(json, string.concat(p, ".fee"))),
            int24(vm.parseJsonInt(json, string.concat(p, ".tickSpacing"))),
            address(0)
        );
    }

    function _floor(int24 tick, int24 spacing) internal pure returns (int24 c) {
        c = tick / spacing * spacing;
        if (tick < 0 && tick % spacing != 0) c -= spacing;
    }

    function buildFingerprint() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(HoodxStockLpSleeveV2).creationCode),
                keccak256(type(HoodxStockLpVaultV1).creationCode),
                keccak256(type(HoodxStockLpControllerV2).creationCode),
                keccak256(type(HoodxTwapV2).creationCode),
                keccak256(type(HoodxStockLpSeederV1).creationCode)
            )
        );
    }
}
