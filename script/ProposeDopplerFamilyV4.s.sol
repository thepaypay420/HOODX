// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";

interface IHookProposalV4 {
    function DELAY() external view returns (uint256);
    function owner() external view returns (address);
    function isApprovedHook(address hook) external view returns (bool);
    function proposals(address hook) external view returns (bytes32 codeHash, bytes32 evidence, uint256 readyAt);
    function propose(address hook, bytes32 evidence) external;
}

/// @notice Starts the one-time review timer for the verified Doppler initializer.
/// Future assets using the same pinned outer+nested hook stack need no new timer.
contract ProposeDopplerFamilyV4 is Script {
    address constant DEPLOYER = 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19;
    address constant REGISTRY = 0xa46150E972Da054f9b954D7a695476A6258A4705;
    address constant DOPPLER_INITIALIZER = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    bytes32 constant EXPECTED_CODEHASH = 0xc41a91106002f15bf70ae266824317f3f3ac638ac72ca5253bae395fa47ee631;
    bytes32 constant EVIDENCE = keccak256("HOODX_DOPPLER_REHYPE_FAMILY_REVIEW_2026_09_27");

    function run() external {
        require(block.chainid == 4663, "wrong chain");
        IHookProposalV4 registry = IHookProposalV4(REGISTRY);
        require(registry.owner() == DEPLOYER, "registry owner changed");
        require(DOPPLER_INITIALIZER.codehash == EXPECTED_CODEHASH, "hook bytecode changed");
        require(!registry.isApprovedHook(DOPPLER_INITIALIZER), "already active");
        (bytes32 pending,,) = registry.proposals(DOPPLER_INITIALIZER);
        require(pending == bytes32(0), "proposal already exists");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(vm.envOr("HOODX_LIVE_BROADCAST", uint256(0)) == 1, "live switch missing");
            require(
                keccak256(bytes(vm.envOr("HOODX_DEPLOY_STAGE", string(""))))
                    == keccak256("propose-reviewed-doppler-family"),
                "wrong deployment stage"
            );
        }

        vm.startBroadcast(DEPLOYER);
        registry.propose(DOPPLER_INITIALIZER, EVIDENCE);
        vm.stopBroadcast();

        (bytes32 codeHash, bytes32 evidence, uint256 readyAt) = registry.proposals(DOPPLER_INITIALIZER);
        require(codeHash == EXPECTED_CODEHASH && evidence == EVIDENCE, "proposal mismatch");
        require(readyAt == block.timestamp + registry.DELAY(), "cooldown mismatch");
        console2.log("Doppler family readyAt", readyAt);
        console2.logBytes32(EVIDENCE);
    }
}
