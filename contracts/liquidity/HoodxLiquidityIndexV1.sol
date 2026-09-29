// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Protocol-controlled pilot index of fungible LP sleeves plus optional idle WETH.
/// @dev V1 intentionally has no public deposit path. The protocol bootstraps it once, then users may
///      acquire index shares and always unwrap them into independent sleeve shares plus WETH.
contract HoodxLiquidityIndexV1 is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable weth;
    address[] private _sleeves;
    bool public bootstrapped;

    error Invalid();
    error AlreadyBootstrapped();

    event Bootstrapped(address indexed receiver, uint256 shares, uint256 wethReserve);
    event Unwrapped(address indexed owner, address indexed receiver, uint256 shares, uint256 wethAmount);

    constructor(address admin, address weth_, address[] memory sleeves_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Ownable(admin)
    {
        if (admin == address(0) || weth_.code.length == 0 || sleeves_.length == 0 || sleeves_.length > 8) {
            revert Invalid();
        }
        weth = weth_;
        for (uint256 i; i < sleeves_.length; ++i) {
            address sleeve = sleeves_[i];
            if (sleeve.code.length == 0) revert Invalid();
            for (uint256 j; j < i; ++j) {
                if (sleeves_[j] == sleeve) revert Invalid();
            }
            _sleeves.push(sleeve);
        }
    }

    function sleeves() external view returns (address[] memory) {
        return _sleeves;
    }

    /// @notice Finalizes the protocol seed. Every configured sleeve must be funded first.
    /// @dev Idle WETH is optional. A fully deployed pilot can use a reviewed WETH/stable sleeve instead.
    function bootstrap(address receiver, uint256 initialShares) external onlyOwner {
        if (bootstrapped) revert AlreadyBootstrapped();
        if (receiver == address(0) || initialShares == 0) revert Invalid();
        for (uint256 i; i < _sleeves.length; ++i) {
            if (IERC20(_sleeves[i]).balanceOf(address(this)) == 0) revert Invalid();
        }
        bootstrapped = true;
        _mint(receiver, initialShares);
        emit Bootstrapped(receiver, initialShares, IERC20(weth).balanceOf(address(this)));
    }

    /// @notice Burns index shares into WETH and independently redeemable LP-sleeve shares.
    /// @dev No pool, router, oracle, backend, or manager is called. A problem in one pool cannot block
    ///      recovery of the other sleeves. The receiver can redeem each sleeve directly when desired.
    function unwrap(uint256 shares, address receiver) external nonReentrant returns (uint256 wethAmount) {
        uint256 supply = totalSupply();
        if (!bootstrapped || shares == 0 || shares > balanceOf(msg.sender) || receiver == address(0)) revert Invalid();

        wethAmount = Math.mulDiv(IERC20(weth).balanceOf(address(this)), shares, supply);
        _burn(msg.sender, shares);
        if (wethAmount != 0) IERC20(weth).safeTransfer(receiver, wethAmount);
        for (uint256 i; i < _sleeves.length; ++i) {
            IERC20 sleeve = IERC20(_sleeves[i]);
            uint256 amount = Math.mulDiv(sleeve.balanceOf(address(this)), shares, supply);
            if (amount != 0) sleeve.safeTransfer(receiver, amount);
        }
        emit Unwrapped(msg.sender, receiver, shares, wethAmount);
    }

    function rescueUnexpectedToken(address token, address receiver, uint256 amount) external onlyOwner {
        if (token == weth || receiver == address(0)) revert Invalid();
        for (uint256 i; i < _sleeves.length; ++i) {
            if (token == _sleeves[i]) revert Invalid();
        }
        IERC20(token).safeTransfer(receiver, amount);
    }
}
