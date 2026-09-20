// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {VerifiedCanaryV2} from "../../script/VerifiedCanaryV2.sol";

contract CanaryIdentityForkV2Test is Test {
    address constant FACTORY = 0x531B632463050E55db60F0025085ffBB2326fF64;

    function check(address factory) external view {
        VerifiedCanaryV2.verify(factory);
    }

    function setUp() public {
        if (!vm.envOr("HOODX_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
    }

    function testReviewedLiveIdentity() public view {
        VerifiedCanaryV2.verify(FACTORY);
    }

    function testRejectsOtherFactory() public {
        vm.expectRevert("unreviewed canary factory");
        this.check(address(1));
    }

    function testRejectsModifiedRuntime() public {
        vm.etch(address(bytes20(hex"6f06b2e4b34319a8b170e94213306e8d3c7d31b0")), hex"00");
        vm.expectRevert("canary runtime mismatch");
        this.check(FACTORY);
    }
}
