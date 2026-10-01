// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {HoodxLiquiditySleeveV4} from "../contracts/liquidity/v4/HoodxLiquiditySleeveV4.sol";
import {HoodxStockLpControllerV1} from "../contracts/liquidity/v4/HoodxStockLpControllerV1.sol";
import {HoodxStockLpVaultV1} from "../contracts/liquidity/v4/HoodxStockLpVaultV1.sol";
import {IPriceReference, IV4StateView, PoolKey} from "../contracts/liquidity/v4/V4Types.sol";
import {HoodxTwapV2} from "../contracts/v2/HoodxTwapV2.sol";

/// @notice Deploys the reviewed HOODX Stock LP vault (deployer transactions only).
/// @dev Creates one HoodxTwapV2 reference, one sleeve per manifest entry, the vault and the controller;
///      wires the vault into every sleeve, hands all ownership to the controller and activates it.
///      It holds no funds and seeds nothing: seeding and bootstrap are separate treasury-signed steps.
///      Manifest: deployments/stock-lp-vault-manifest.json (or HOODX_STOCK_LP_MANIFEST).
contract DeployStockLpVaultV1 is Script {
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address internal constant TREASURY = 0x134D468B0bcaeA6DF127916f951F7938c06A37C6; // curator + fee recipient
    address internal constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    uint24 internal constant ETH_POOL_FEE = 100;
    int24 internal constant ETH_POOL_SPACING = 1;

    struct Entry {
        string symbol;
        address token;
        PoolKey lp;
        PoolKey swap;
        address v3Pool;
        int24 halfWidth;
    }

    struct Deployed {
        address[] sleeves;
        address[] refs;
        HoodxStockLpVaultV1 vault;
        HoodxStockLpControllerV1 controller;
    }

    function run() external returns (Deployed memory d) {
        require(block.chainid == 4663, "wrong chain");
        string memory json = vm.readFile(vm.envOr("HOODX_STOCK_LP_MANIFEST", string("deployments/stock-lp-vault-manifest.json")));
        Entry[] memory e = _entries(json);
        uint16 perfBps = uint16(vm.parseJsonUint(json, ".perfFeeBps"));
        uint256 minDeposit = vm.parseJsonUint(json, ".minDepositUsdg");
        uint256 cap = vm.parseJsonUint(json, ".tvlCapUsdg");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(
                keccak256(bytes(vm.parseJsonString(json, ".status"))) == keccak256("APPROVED"), "manifest not approved"
            );
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string("")))) == keccak256("stock-lp-vault-v1"),
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
        HoodxStockLpControllerV1.Policy[] memory pol = new HoodxStockLpControllerV1.Policy[](n);

        vm.startBroadcast(DEPLOYER);
        for (uint256 i; i < n; ++i) {
            d.refs[i] = address(new HoodxTwapV2(V3_FACTORY, e[i].token, USDG, e[i].v3Pool, address(0), 1800, 1, 0));
            (, int24 tick, uint24 protocolFee,) = IV4StateView(STATE_VIEW).getSlot0(keccak256(abi.encode(e[i].lp)));
            int24 c = _floor(tick, e[i].lp.tickSpacing);
            d.sleeves[i] = address(
                new HoodxLiquiditySleeveV4(
                    DEPLOYER, PM, STATE_VIEW, e[i].lp, protocolFee, c - e[i].halfWidth, c + e[i].halfWidth, TREASURY,
                    perfBps, string.concat("HOODX Stock LP ", e[i].symbol), string.concat("hx", e[i].symbol)
                )
            );
            swapKeys[i] = e[i].swap;
            pol[i] = HoodxStockLpControllerV1.Policy({
                halfWidth: e[i].halfWidth,
                makerWidth: 2 * e[i].halfWidth,
                maxDivergenceBps: 150,
                breachDelay: 24 hours,
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
            HoodxLiquiditySleeveV4(d.sleeves[i]).setVault(address(d.vault));
        }
        d.controller = new HoodxStockLpControllerV1(address(d.vault), TREASURY, DEPLOYER, TREASURY, d.sleeves, pol);
        d.vault.transferOwnership(address(d.controller));
        for (uint256 i; i < n; ++i) {
            HoodxLiquiditySleeveV4(d.sleeves[i]).transferOwnership(address(d.controller));
        }
        d.controller.activate();
        vm.stopBroadcast();

        _verify(d, n, perfBps);
    }

    function _verify(Deployed memory d, uint256 n, uint16 perfBps) internal view {
        require(d.controller.activated(), "controller not active");
        require(d.vault.owner() == address(d.controller), "vault owner");
        require(!d.vault.bootstrapped() && d.vault.totalSupply() == 0, "unexpected bootstrap");
        require(d.controller.curator() == TREASURY, "curator");
        for (uint256 i; i < n; ++i) {
            HoodxLiquiditySleeveV4 s = HoodxLiquiditySleeveV4(d.sleeves[i]);
            require(s.owner() == address(d.controller), "sleeve owner");
            require(s.vault() == address(d.vault), "sleeve vault");
            require(s.feeRecipient() == TREASURY && s.feeBps() == perfBps, "fee terms");
            uint256 div = d.controller.divergenceBps(i);
            require(div <= 150, "reference disagrees with pool: seeding would fail");
            console2.log("Sleeve", d.sleeves[i]);
            console2.log("  TWAP reference", d.refs[i]);
            console2.log("  pool vs reference (bps)", div);
        }
        console2.log("Vault", address(d.vault));
        console2.log("Controller", address(d.controller));
    }

    function _entries(string memory json) internal pure returns (Entry[] memory e) {
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
        }
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
                keccak256(type(HoodxLiquiditySleeveV4).creationCode),
                keccak256(type(HoodxStockLpVaultV1).creationCode),
                keccak256(type(HoodxStockLpControllerV1).creationCode),
                keccak256(type(HoodxTwapV2).creationCode)
            )
        );
    }
}
