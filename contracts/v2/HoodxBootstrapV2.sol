// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {HoodxPolicyV2} from "./HoodxPolicyV2.sol";
import {HoodxFactoryV2} from "./HoodxFactoryV2.sol";
import {HoodxIndexV2} from "./HoodxIndexV2.sol";

/// @notice Constructor-only seeding avoids any temporary deployer administrator.
contract HoodxSeededPolicyV2 is HoodxPolicyV2 {
    struct Seed {
        address token;
        address oracle;
        bytes buy;
        bytes sell;
        bytes32 evidence;
    }

    constructor(address admin, address executor_, Seed[] memory seeds) HoodxPolicyV2(admin, executor_) {
        for (uint256 i; i < seeds.length; ++i) {
            Seed memory s = seeds[i];
            _approveConfig(s.token, s.oracle, s.buy, s.sell, s.evidence);
        }
    }
}

/// @notice Official vaults are created atomically with long-term roles already assigned.
contract HoodxOfficialFactoryV2 is HoodxFactoryV2 {
    struct Basket {
        HoodxIndexV2.Init params;
        bytes32[] configs;
        uint16[] weights;
    }

    constructor(address admin, address treasury_, address implementation_, Basket memory meme, Basket memory faang)
        HoodxFactoryV2(admin, treasury_, implementation_)
    {
        _officialRoles(meme.params, admin, treasury_);
        _officialRoles(faang.params, admin, treasury_);
        _create("696x", meme.params, meme.configs, meme.weights);
        _create("faangx", faang.params, faang.configs, faang.weights);
    }

    function _officialRoles(HoodxIndexV2.Init memory p, address admin, address treasury_) private pure {
        if (p.curator != admin || p.creator != admin || p.recipient != admin || p.treasury != treasury_) revert Invalid();
    }
}
