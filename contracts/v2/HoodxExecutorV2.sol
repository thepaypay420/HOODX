// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {V2PoolKey, V2Hop, IV2Weth} from "./Types.sol";

interface IRouter211 {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2V2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IV3FactoryV2 {
    function getPool(address, address, uint24) external view returns (address);
}

interface ILiquidityV2 {
    function liquidity() external view returns (uint128);
}

interface IStateV2 {
    function getLiquidity(bytes32) external view returns (uint128);
}

/// @notice Typed exact-input execution. No external target or router calldata is accepted.
contract HoodxExecutorV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable weth;
    address public immutable router;
    address public immutable permit2;
    address public immutable v3Factory;
    address public immutable stateView;
    bytes32 public immutable routerCodeHash;
    mapping(address => bool) public compatibleHook;
    error InvalidRoute();
    error InvalidAmount();
    error Residual();
    error Expired();

    struct V4ExactIn {
        V2PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    constructor(
        address weth_,
        address router_,
        address permit2_,
        address factory_,
        address state_,
        address[] memory hooks
    ) {
        if (
            weth_.code.length == 0 || router_.code.length == 0 || permit2_.code.length == 0 || factory_.code.length == 0
                || state_.code.length == 0
        ) revert InvalidRoute();
        weth = weth_;
        router = router_;
        permit2 = permit2_;
        v3Factory = factory_;
        stateView = state_;
        routerCodeHash = router_.codehash;
        for (uint256 i; i < hooks.length; ++i) {
            if (hooks[i].code.length == 0) revert InvalidRoute();
            compatibleHook[hooks[i]] = true;
        }
    }
    // Canonical V4 TAKE_ALL sends native output directly from PoolManager.
    receive() external payable {}

    function normalized(address t) public view returns (address) {
        return t == address(0) ? weth : t;
    }

    function validateRoute(bytes calldata route, address input, address output) external view {
        _validate(abi.decode(route, (V2Hop[])), input, output);
    }

    function _validate(V2Hop[] memory hops, address input, address output) internal view {
        if (hops.length == 0 || hops.length > 4 || input == output || input == address(0) || output == address(0)) {
            revert InvalidRoute();
        }
        address next = input;
        for (uint256 i; i < hops.length; ++i) {
            V2Hop memory h = hops[i];
            if (normalized(h.tokenIn) != next || normalized(h.tokenOut) == next) revert InvalidRoute();
            if (h.kind == 3) {
                if (h.tokenIn == address(0) || h.tokenOut == address(0) || h.hookData.length != 0) revert InvalidRoute();
                address pool = IV3FactoryV2(v3Factory).getPool(h.tokenIn, h.tokenOut, h.fee);
                if (pool.code.length == 0 || ILiquidityV2(pool).liquidity() == 0) revert InvalidRoute();
            } else if (h.kind == 4) {
                V2PoolKey memory k = h.key;
                if (
                    k.currency0 >= k.currency1 || k.tickSpacing <= 0
                        || (k.hooks != address(0) && !compatibleHook[k.hooks]) || h.hookData.length > 1024
                ) revert InvalidRoute();
                if (!((h.tokenIn == k.currency0 && h.tokenOut == k.currency1)
                            || (h.tokenIn == k.currency1 && h.tokenOut == k.currency0))) revert InvalidRoute();
                if (IStateV2(stateView).getLiquidity(keccak256(abi.encode(k))) == 0) revert InvalidRoute();
            } else {
                revert InvalidRoute();
            }
            next = normalized(h.tokenOut);
            // Cycles complicate residual accounting and have no supported purpose.
            if (next == input) revert InvalidRoute();
            for (uint256 j; j < i; ++j) {
                if (next == normalized(hops[j].tokenOut)) revert InvalidRoute();
            }
        }
        if (next != output || router.codehash != routerCodeHash) revert InvalidRoute();
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
        if (amount == 0 || amount > type(uint128).max || minOut == 0) revert InvalidAmount();
        V2Hop[] memory hops = abi.decode(route, (V2Hop[]));
        _validate(hops, input, output);
        uint256[] memory initial = new uint256[](hops.length + 1);
        initial[0] = IERC20(input).balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        for (uint256 i; i < hops.length; ++i) {
            initial[i + 1] = IERC20(normalized(hops[i].tokenOut)).balanceOf(address(this));
        }
        IERC20(input).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(input).balanceOf(address(this)) - initial[0] != amount) revert InvalidAmount();
        received = amount;
        for (uint256 i; i < hops.length; ++i) {
            received = _hop(hops[i], received, deadline);
        }
        if (received < minOut) revert InvalidAmount();
        uint256 beforeOut = IERC20(output).balanceOf(msg.sender);
        IERC20(output).safeTransfer(msg.sender, received);
        if (IERC20(output).balanceOf(msg.sender) - beforeOut != received) revert InvalidAmount();
        if (IERC20(input).balanceOf(address(this)) != initial[0] || address(this).balance != nativeBefore) {
            revert Residual();
        }
        for (uint256 i; i < hops.length; ++i) {
            if (IERC20(normalized(hops[i].tokenOut)).balanceOf(address(this)) != initial[i + 1]) revert Residual();
        }
    }

    function _hop(V2Hop memory h, uint256 amount, uint256 deadline) private returns (uint256 got) {
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
        address input = normalized(h.tokenIn);
        address output = normalized(h.tokenOut);
        uint256 beforeIn = IERC20(input).balanceOf(address(this));
        uint256 beforeOut = IERC20(output).balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        uint256 routerIn = h.tokenIn == address(0) ? router.balance : IERC20(h.tokenIn).balanceOf(router);
        uint256 routerOut = h.tokenOut == address(0) ? router.balance : IERC20(h.tokenOut).balanceOf(router);
        uint256 value;
        // Some canonical tokens hard-code infinite ERC20 allowance to Permit2.
        // Its separate router allowance remains exact and is always revoked.
        bool fixedPermitAllowance =
            h.tokenIn != address(0) && IERC20(input).allowance(address(this), permit2) == type(uint256).max;
        if (h.tokenIn == address(0)) {
            IV2Weth(weth).withdraw(amount);
            value = amount;
        } else {
            if (!fixedPermitAllowance) IERC20(input).forceApprove(permit2, amount);
            IPermit2V2(permit2).approve(input, router, uint160(amount), uint48(block.timestamp));
        }
        bytes[] memory inputs = new bytes[](1);
        bytes memory command;
        if (h.kind == 3) {
            uint256[] memory prices = new uint256[](1);
            prices[0] = h.minHopPriceX36;
            inputs[0] =
                abi.encode(
                address(this), amount, uint256(1), abi.encodePacked(h.tokenIn, h.fee, h.tokenOut), true, prices
            );
            command = hex"00";
        } else {
            bytes[] memory params = new bytes[](3);
            params[0] =
                abi.encode(
                V4ExactIn(h.key, h.tokenIn == h.key.currency0, uint128(amount), 1, h.minHopPriceX36, h.hookData)
            );
            params[1] = abi.encode(h.tokenIn, amount);
            params[2] = abi.encode(h.tokenOut, uint256(1));
            inputs[0] = abi.encode(hex"060c0f", params); // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
            command = hex"10";
        }
        IRouter211(router).execute{value: value}(command, inputs, deadline);
        if (h.tokenIn != address(0)) {
            IPermit2V2(permit2).approve(input, router, 0, 0);
            if (!fixedPermitAllowance) IERC20(input).forceApprove(permit2, 0);
        }
        if (h.tokenOut == address(0)) IV2Weth(weth).deposit{value: address(this).balance - nativeBefore}();
        if (beforeIn - IERC20(input).balanceOf(address(this)) != amount) revert Residual();
        got = IERC20(output).balanceOf(address(this)) - beforeOut;
        if (got == 0 || address(this).balance != nativeBefore) revert Residual();
        if ((h.tokenIn == address(0) ? router.balance : IERC20(h.tokenIn).balanceOf(router)) != routerIn) revert Residual();
        if ((h.tokenOut == address(0) ? router.balance : IERC20(h.tokenOut).balanceOf(router)) != routerOut) revert Residual();
    }
}
