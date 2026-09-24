// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IV2Executor, IV2Weth, V2Hop} from "../v2/Types.sol";
import {IHookRegistryV3} from "./HoodxExecutorV3.sol";
import {IPairFactoryV3, IPairV3} from "./HoodxExecutorV3.sol";

interface IPoolExecutorIdentityV3 {
    function v2Factory() external view returns (address);
}

interface IQuotronRouterV3 {
    function quotron() external view returns (address);
    function weth() external view returns (address);
    function hook() external view returns (address);
    function buyExactEth(uint256 minimum, address recipient, uint256 deadline) external payable returns (uint256);
    function sellExactQuotronForEth(uint256 amount, uint256 minimum, address recipient, uint256 deadline)
        external
        returns (uint256);
}

interface IQuotronHookV3 {
    function canonicalRouter() external view returns (address);
    function isTransferRestricted(address account) external view returns (bool);
}

/// @notice Immutable dispatcher: canonical pool routes plus one reviewed QUOTRON router.
/// Kind 5 is a single WETH/QUOTRON hop, with no caller-selected target or calldata.
/// Runtime hashes do not cover proxy implementations or mutable token/hook policies.
contract HoodxRoutingV3 is IV2Executor, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable weth;
    IV2Executor public immutable pools;
    IQuotronRouterV3 public immutable quotronRouter;
    IHookRegistryV3 public immutable registry;
    address public immutable quotron;
    address public immutable hook;
    bytes32 public immutable poolsHash;
    bytes32 public immutable routerHash;
    error InvalidRoute();
    error InvalidSettlement();
    error Expired();

    constructor(address pools_, address router_, address registry_, address expectedToken, address expectedHook) {
        if (pools_.code.length == 0 || router_.code.length == 0 || registry_.code.length == 0) revert InvalidRoute();
        pools = IV2Executor(pools_);
        quotronRouter = IQuotronRouterV3(router_);
        registry = IHookRegistryV3(registry_);
        weth = IV2Executor(pools_).weth();
        if (
            weth.code.length == 0 || expectedToken.code.length == 0 || expectedHook.code.length == 0
                || IQuotronRouterV3(router_).weth() != weth || IQuotronRouterV3(router_).quotron() != expectedToken
                || IQuotronRouterV3(router_).hook() != expectedHook
                || IQuotronHookV3(expectedHook).canonicalRouter() != router_
        ) revert InvalidRoute();
        quotron = expectedToken;
        hook = expectedHook;
        poolsHash = pools_.codehash;
        routerHash = router_.codehash;
    }

    receive() external payable {
        if (msg.sender != weth && msg.sender != address(quotronRouter)) revert InvalidSettlement();
    }

    function validateRoute(bytes calldata route, address input, address output) external view {
        _validate(route, input, output);
    }

    function _validate(bytes calldata route, address input, address output) private view returns (bool special) {
        if (address(pools).codehash != poolsHash) revert InvalidRoute();
        V2Hop[] memory hops = abi.decode(route, (V2Hop[]));
        if (hops.length == 0) revert InvalidRoute();
        special = hops[0].kind == 5;
        if (hops[0].kind == 6) {
            V2Hop memory h = hops[0];
            if (
                hops.length != 1 || h.tokenIn != input || h.tokenOut != output || input == output || input == address(0)
                    || output == address(0) || (input != weth && output != weth) || h.fee != 3000
                    || h.hookData.length != 32
            ) revert InvalidRoute();
            uint256 tax = abi.decode(h.hookData, (uint256));
            if (tax > 2000) revert InvalidRoute();
            address factory = IPoolExecutorIdentityV3(address(pools)).v2Factory();
            address pair = IPairFactoryV3(factory).getPair(input, output);
            if (pair.code.length == 0 || IPairV3(pair).factory() != factory) revert InvalidRoute();
            address t0 = IPairV3(pair).token0();
            address t1 = IPairV3(pair).token1();
            if (!((t0 == input && t1 == output) || (t1 == input && t0 == output))) revert InvalidRoute();
            return false;
        }
        if (!special) {
            pools.validateRoute(route, input, output);
            return false;
        }
        V2Hop memory h = hops[0];
        if (
            hops.length != 1 || h.tokenIn != input || h.tokenOut != output
                || !((input == weth && output == quotron) || (input == quotron && output == weth)) || h.fee != 0
                || h.hookData.length != 0 || h.key.currency0 != address(0) || h.key.currency1 != address(0)
                || h.key.fee != 0 || h.key.tickSpacing != 0 || h.key.hooks != address(0)
                || address(quotronRouter).codehash != routerHash || !registry.isApprovedHook(hook)
                || IQuotronHookV3(hook).canonicalRouter() != address(quotronRouter)
        ) revert InvalidRoute();
    }

    function execute(
        address input,
        address output,
        uint256 amount,
        uint256 minOut,
        bytes calldata route,
        uint256 deadline
    ) external nonReentrant returns (uint256 received) {
        if (deadline < block.timestamp) revert Expired();
        if (amount == 0 || amount > type(uint128).max || minOut == 0) revert InvalidSettlement();
        bool special = _validate(route, input, output);
        V2Hop[] memory decoded = abi.decode(route, (V2Hop[]));
        if (decoded[0].kind == 6) return _taxedPair(decoded[0], amount, minOut);
        uint256 initialIn = IERC20(input).balanceOf(address(this));
        uint256 initialOut = IERC20(output).balanceOf(address(this));
        uint256 initialNative = address(this).balance;
        IERC20(input).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(input).balanceOf(address(this)) != initialIn + amount) revert InvalidSettlement();
        if (!special) {
            IERC20(input).forceApprove(address(pools), amount);
            pools.execute(input, output, amount, minOut, route, deadline);
            IERC20(input).forceApprove(address(pools), 0);
        } else {
            V2Hop[] memory hops = abi.decode(route, (V2Hop[]));
            minOut = Math.max(minOut, Math.mulDiv(amount, hops[0].minHopPriceX36, 1e36));
            // Fail closed when the hook would prevent custody transfers. Never wait with user funds in the dispatcher.
            if (IQuotronHookV3(hook).isTransferRestricted(address(this))) revert InvalidSettlement();
            if (input == weth) {
                IV2Weth(weth).withdraw(amount);
                quotronRouter.buyExactEth{value: amount}(minOut, address(this), deadline);
                if (IQuotronHookV3(hook).isTransferRestricted(address(this))) revert InvalidSettlement();
            } else {
                IERC20(input).forceApprove(address(quotronRouter), amount);
                quotronRouter.sellExactQuotronForEth(amount, minOut, address(this), deadline);
                IERC20(input).forceApprove(address(quotronRouter), 0);
                IV2Weth(weth).deposit{value: address(this).balance - initialNative}();
            }
        }
        received = IERC20(output).balanceOf(address(this)) - initialOut;
        if (
            received < minOut || IERC20(input).balanceOf(address(this)) != initialIn
                || address(this).balance != initialNative
        ) revert InvalidSettlement();
        uint256 recipientBefore = IERC20(output).balanceOf(msg.sender);
        IERC20(output).safeTransfer(msg.sender, received);
        if (
            IERC20(output).balanceOf(msg.sender) != recipientBefore + received
                || IERC20(output).balanceOf(address(this)) != initialOut
        ) revert InvalidSettlement();
    }

    /// Direct vault-to-pair and pair-to-vault transfers avoid additional taxed custody hops.
    /// The encoded tax limit belongs to the immutable policy route; caller minimum is always net received.
    function _taxedPair(V2Hop memory h, uint256 amount, uint256 minOut) private returns (uint256 got) {
        address factory = IPoolExecutorIdentityV3(address(pools)).v2Factory();
        address pair = IPairFactoryV3(factory).getPair(h.tokenIn, h.tokenOut);
        (uint112 r0, uint112 r1,) = IPairV3(pair).getReserves();
        bool forward = IPairV3(pair).token0() == h.tokenIn;
        (uint256 rin, uint256 rout) = forward ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 pairInBefore = IERC20(h.tokenIn).balanceOf(pair);
        uint256 pairOutBefore = IERC20(h.tokenOut).balanceOf(pair);
        // Unsolicited transfers are valid V2 pair balances. Exclude them from this
        // trade's paid amount instead of allowing dust donations to disable a route.
        // A negative rebase below the stored reserves remains unsafe and is rejected.
        if (rin == 0 || rout == 0 || pairInBefore < rin || pairOutBefore < rout) revert InvalidSettlement();
        uint256 beforeIn = IERC20(h.tokenIn).balanceOf(msg.sender);
        uint256 beforeOut = IERC20(h.tokenOut).balanceOf(msg.sender);
        uint256 tax = abi.decode(h.hookData, (uint256));
        IERC20(h.tokenIn).safeTransferFrom(msg.sender, pair, amount);
        uint256 paid = IERC20(h.tokenIn).balanceOf(pair) - pairInBefore;
        if (
            beforeIn - IERC20(h.tokenIn).balanceOf(msg.sender) != amount || paid > amount || paid == 0
                || paid < Math.mulDiv(amount, 10000 - tax, 10000, Math.Rounding.Ceil)
        ) revert InvalidSettlement();
        uint256 adjusted = paid * 997;
        uint256 gross = Math.mulDiv(adjusted, rout, rin * 1000 + adjusted);
        if (gross == 0) revert InvalidSettlement();
        IPairV3(pair).swap(forward ? 0 : gross, forward ? gross : 0, msg.sender, "");
        got = IERC20(h.tokenOut).balanceOf(msg.sender) - beforeOut;
        if (
            got > gross || got < Math.mulDiv(gross, 10000 - tax, 10000, Math.Rounding.Ceil) || got < minOut
                || got < Math.mulDiv(amount, h.minHopPriceX36, 1e36)
                || IERC20(h.tokenIn).balanceOf(msg.sender) != beforeIn - amount
        ) revert InvalidSettlement();
    }
}
