// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IQuotronRouterProbe {
    function quotron() external view returns (address);
    function buyExactEth(uint256 minimum, address recipient, uint256 deadline) external payable returns (uint256);
    function sellExactQuotronForEth(uint256 amount, uint256 minimum, address recipient, uint256 deadline)
        external
        returns (uint256);
}

interface IQuotronFeeProbe {
    function currentFeeBps(address account) external view returns (uint256);
    function isTransferRestricted(address account) external view returns (bool);
}

/// Diagnostic only. Snapshot-derived quotes do not establish independent NAV or release readiness.
contract QuotronRouterForkTest is SuccessorWatchlistForkTest {
    receive() external payable {}

    function testCanonicalRouterRoundTrip() public {
        IQuotronRouterProbe router =
            IQuotronRouterProbe(address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")));
        IQuotronFeeProbe hook = IQuotronFeeProbe(address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc")));
        IERC20 token = IERC20(router.quotron());
        vm.deal(address(this), 1 ether);
        emit log_named_uint("Current hook fee bps", hook.currentFeeBps(address(this)));
        uint256 snapshot = vm.snapshotState();
        // Discovery happens only in a reverted fork snapshot, never a live transaction.
        uint256 quoted = router.buyExactEth{value: 0.001 ether}(1, address(this), block.timestamp + 300);
        assertTrue(vm.revertToState(snapshot));
        uint256 bought =
            router.buyExactEth{value: 0.001 ether}(quoted * 9700 / 10000, address(this), block.timestamp + 300);
        assertEq(token.balanceOf(address(this)), bought);
        assertFalse(hook.isTransferRestricted(address(this)), "buyer transfer locked");
        // Executor-to-vault and vault-to-executor transfers must both work.
        address vault = makeAddr("probeVault");
        assertTrue(token.transfer(vault, bought));
        vm.prank(vault);
        assertTrue(token.transfer(address(this), bought));
        assertTrue(token.approve(address(router), bought));
        snapshot = vm.snapshotState();
        quoted = router.sellExactQuotronForEth(bought, 1, address(this), block.timestamp + 300);
        assertTrue(vm.revertToState(snapshot));
        uint256 returned =
            router.sellExactQuotronForEth(bought, quoted * 9700 / 10000, address(this), block.timestamp + 300);
        emit log_named_uint("ETH returned wei", returned);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(vault), 0);
        assertEq(token.allowance(address(this), address(router)), 0);
    }
}
