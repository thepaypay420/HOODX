// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {PinnedV2Config} from "./PinnedV2Config.sol";
import {HoodxExecutorV2} from "../contracts/v2/HoodxExecutorV2.sol";
import {HoodxTwapV2} from "../contracts/v2/HoodxTwapV2.sol";
import {HoodxSeededPolicyV2, HoodxOfficialFactoryV2} from "../contracts/v2/HoodxBootstrapV2.sol";
import {HoodxIndexV2} from "../contracts/v2/HoodxIndexV2.sol";

function v2BuildFingerprint() pure returns (bytes32) {
    return keccak256(
        abi.encode(
            PinnedV2Config.EVIDENCE,
            keccak256(type(HoodxExecutorV2).creationCode),
            keccak256(type(HoodxTwapV2).creationCode),
            keccak256(type(HoodxSeededPolicyV2).creationCode),
            keccak256(type(HoodxIndexV2).creationCode),
            keccak256(type(HoodxOfficialFactoryV2).creationCode)
        )
    );
}
