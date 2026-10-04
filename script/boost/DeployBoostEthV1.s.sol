// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {HoodxBoostSignalV1} from "../../contracts/boost/HoodxBoostSignalV1.sol";
import {HoodxBoostVaultV1} from "../../contracts/boost/HoodxBoostVaultV1.sol";

/// @notice Deploys the reviewed HOODX Boosted ETH vault V1 (deployer transactions only).
/// @dev 1. the signal, seeded from deployments/boost-eth-seed.json (regenerate it right before: research/boost/boost_seed.py);
///      2. the vault, owned by the deployer for one transaction;
///      3. bootstrap with `seedEthWei` (shares to the treasury, DEAD_SHARES locked);
///      4. transferOwnership(treasury) - the treasury then calls acceptOwnership() (Ownable2Step).
///      Manifest: deployments/boost-eth-v1-manifest.json (or HOODX_BOOST_MANIFEST). Broadcasting requires status APPROVED
///      and HOODX_REVIEWED_BUILD equal to the manifest's reviewedBuild.
contract DeployBoostEthV1 is Script {
    address internal constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;

    struct Deployed {
        HoodxBoostSignalV1 signal;
        HoodxBoostVaultV1 vault;
        uint256 initialShares;
    }

    function run() external returns (Deployed memory d) {
        require(block.chainid == 4663, "wrong chain");
        string memory m =
            vm.readFile(vm.envOr("HOODX_BOOST_MANIFEST", string("deployments/boost-eth-v1-manifest.json")));
        string memory seed = vm.readFile(vm.parseJsonString(m, ".seedFile"));
        address treasury = vm.parseJsonAddress(m, ".curatorAndFeeRecipient");
        uint256 seedEth = vm.parseUint(vm.parseJsonString(m, ".seedEthWei"));
        require(DEPLOYER.balance >= seedEth + 0.003 ether, "deployer needs seed + gas");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        if (live) {
            require(
                keccak256(bytes(vm.parseJsonString(m, ".status"))) == keccak256("APPROVED"), "manifest not approved"
            );
            require(
                keccak256(bytes(vm.envString("HOODX_REVIEWED_BUILD")))
                    == keccak256(bytes(vm.parseJsonString(m, ".reviewedBuild"))),
                "build is not the reviewed build"
            );
        }

        uint128[8] memory ee;
        uint128[8] memory be;
        string[] memory es = vm.parseJsonStringArray(seed, ".ethEma");
        string[] memory bs = vm.parseJsonStringArray(seed, ".btcEma");
        for (uint256 i; i < 8; ++i) {
            ee[i] = uint128(vm.parseUint(es[i]));
            be[i] = uint128(vm.parseUint(bs[i]));
        }
        uint256 stale = vm.parseJsonUint(m, ".feedMaxStaleSec");

        vm.startBroadcast(DEPLOYER);
        d.signal = new HoodxBoostSignalV1(
            vm.parseJsonAddress(m, ".ethUsdFeed"),
            vm.parseJsonAddress(m, ".btcUsdFeed"),
            stale,
            stale,
            ee,
            be,
            uint8(vm.parseJsonUint(seed, ".ethFlags")),
            uint8(vm.parseJsonUint(seed, ".btcFlags")),
            vm.parseUint(vm.parseJsonString(seed, ".ethVar")),
            vm.parseUint(vm.parseJsonString(seed, ".ethLast")),
            vm.parseUint(vm.parseJsonString(seed, ".btcLast"))
        );
        HoodxBoostVaultV1.Config memory c = HoodxBoostVaultV1.Config({
            morpho: vm.parseJsonAddress(m, ".morpho"),
            marketId: vm.parseJsonBytes32(m, ".marketId"),
            pool: vm.parseJsonAddress(m, ".pool"),
            weth: vm.parseJsonAddress(m, ".weth"),
            usdg: vm.parseJsonAddress(m, ".usdg"),
            cash: vm.parseJsonAddress(m, ".cash"),
            signal: address(d.signal),
            feeRecipient: treasury,
            minDeposit: vm.parseUint(vm.parseJsonString(m, ".minDepositWei")),
            tvlCapUsdg: vm.parseUint(vm.parseJsonString(m, ".tvlCapUsdg")),
            maxSliceUsdg: vm.parseUint(vm.parseJsonString(m, ".maxSliceUsdg")),
            minInterval: uint32(vm.parseJsonUint(m, ".minIntervalSec")),
            maxSlipBps: uint16(vm.parseJsonUint(m, ".maxSlipBps")),
            emergencySlipBps: uint16(vm.parseJsonUint(m, ".emergencySlipBps")),
            maxDivBps: uint16(vm.parseJsonUint(m, ".maxDivBps"))
        });
        d.vault = new HoodxBoostVaultV1(DEPLOYER, c, vm.parseJsonString(m, ".name"), vm.parseJsonString(m, ".symbol"));
        d.vault.bootstrap{value: seedEth}(treasury);
        d.vault.transferOwnership(treasury);
        vm.stopBroadcast();

        d.initialShares = d.vault.balanceOf(treasury);
        console2.log("Signal  ", address(d.signal));
        console2.log("Vault   ", address(d.vault));
        console2.log("Shares to treasury", d.initialShares);
        console2.log("Signal target (1e18 = 1x)", d.signal.target());
        console2.log(
            "Next: the treasury calls acceptOwnership() on the vault; then record deployments/boost-eth-v1-live.json"
        );
    }
}
