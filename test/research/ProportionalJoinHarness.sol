// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IV2Executor, IV2Weth} from "../../contracts/v2/Types.sol";

/// @dev RESEARCH ONLY. No production bootstrap, fees, curator operations or claims.
/// Fixed basket experiment: requested shares are minted only after every existing
/// token balance has grown proportionally. Does not use spot quotes as a NAV oracle.
contract ProportionalJoinHarness is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable weth;
    IV2Executor public immutable executor;
    address[] public assets;
    error InvalidJoin();
    error ShortContribution(address token);

    constructor(address executor_, address[] memory assets_) ERC20("Research basket", "TEST") {
        executor = IV2Executor(executor_);
        weth = executor.weth();
        require(assets_.length >= 2 && assets_.length <= 24);
        for (uint256 i; i < assets_.length; ++i) {
            require(assets_[i] != weth && assets_[i].code.length != 0);
            for (uint256 j; j < i; ++j) {
                require(assets_[i] != assets_[j]);
            }
        }
        assets = assets_;
    }

    receive() external payable {
        require(msg.sender == weth);
    }

    /// @dev Test fixture only, intentionally not a production bootstrap API.
    function seedShares(address holder, uint256 amount) external {
        require(totalSupply() == 0 && amount > 0);
        for (uint256 i; i < assets.length; ++i) {
            require(IERC20(assets[i]).balanceOf(address(this)) > 0);
        }
        _mint(holder, amount);
    }

    function required(uint256 balance, uint256 shares, uint256 supply) public pure returns (uint256) {
        if (supply == 0 || shares == 0) revert InvalidJoin();
        return Math.mulDiv(balance, shares, supply, Math.Rounding.Ceil);
    }

    function depositETH(uint256 shares, uint256[] calldata budgets, bytes[] calldata routes, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 refund)
    {
        uint256 supply = totalSupply();
        if (
            supply == 0 || shares == 0 || msg.value == 0 || deadline < block.timestamp
                || budgets.length != assets.length || routes.length != assets.length
        ) revert InvalidJoin();
        uint256 cashBefore = IERC20(weth).balanceOf(address(this));
        uint256 cashNeeded = required(cashBefore, shares, supply);
        uint256 spend;
        uint256[] memory beforeBalances = new uint256[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            beforeBalances[i] = IERC20(assets[i]).balanceOf(address(this));
            // Empty sleeves require a separately designed rebalance/bootstrap action.
            if (beforeBalances[i] == 0 || budgets[i] == 0) revert InvalidJoin();
            spend += budgets[i];
        }
        if (spend > msg.value || cashNeeded > msg.value - spend) revert InvalidJoin();
        IV2Weth(weth).deposit{value: msg.value}();
        for (uint256 i; i < assets.length; ++i) {
            uint256 floor = required(beforeBalances[i], shares, supply);
            IERC20(weth).forceApprove(address(executor), budgets[i]);
            executor.execute(weth, assets[i], budgets[i], floor, routes[i], deadline);
            IERC20(weth).forceApprove(address(executor), 0);
        }
        // Check final actual balances, not executor return values or quoted amounts.
        // A later route must not be allowed to consume an earlier contribution.
        for (uint256 i; i < assets.length; ++i) {
            if (
                IERC20(assets[i]).balanceOf(address(this))
                    < beforeBalances[i] + required(beforeBalances[i], shares, supply)
            ) revert ShortContribution(assets[i]);
        }
        uint256 cashAfter = IERC20(weth).balanceOf(address(this));
        if (cashAfter < cashBefore + cashNeeded) revert ShortContribution(weth);
        refund = cashAfter - cashBefore - cashNeeded;
        _mint(msg.sender, shares);
        if (refund != 0) {
            IV2Weth(weth).withdraw(refund);
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok);
        }
    }

    function withdrawETH(
        uint256 shares,
        uint256 minEth,
        uint256[] calldata floors,
        bytes[] calldata routes,
        uint256 deadline
    ) external nonReentrant returns (uint256 proceeds) {
        if (
            shares == 0 || shares > balanceOf(msg.sender) || minEth == 0 || deadline < block.timestamp
                || floors.length != assets.length || routes.length != assets.length
        ) revert InvalidJoin();
        uint256 supply = totalSupply();
        uint256 cashBefore = IERC20(weth).balanceOf(address(this));
        uint256 cashPart = Math.mulDiv(cashBefore, shares, supply);
        uint256[] memory beforeBalances = new uint256[](assets.length);
        uint256[] memory portions = new uint256[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            beforeBalances[i] = IERC20(assets[i]).balanceOf(address(this));
            portions[i] = Math.mulDiv(beforeBalances[i], shares, supply);
        }
        for (uint256 i; i < assets.length; ++i) {
            if (portions[i] == 0) continue;
            if (floors[i] == 0) revert InvalidJoin();
            IERC20(assets[i]).forceApprove(address(executor), portions[i]);
            executor.execute(assets[i], weth, portions[i], floors[i], routes[i], deadline);
            IERC20(assets[i]).forceApprove(address(executor), 0);
        }
        for (uint256 i; i < assets.length; ++i) {
            if (IERC20(assets[i]).balanceOf(address(this)) != beforeBalances[i] - portions[i]) {
                revert ShortContribution(assets[i]);
            }
        }
        uint256 cashAfter = IERC20(weth).balanceOf(address(this));
        if (cashAfter < cashBefore) revert ShortContribution(weth);
        proceeds = cashAfter - cashBefore + cashPart;
        if (proceeds < minEth) revert InvalidJoin();
        _burn(msg.sender, shares);
        IV2Weth(weth).withdraw(proceeds);
        (bool ok,) = msg.sender.call{value: proceeds}("");
        require(ok);
    }
}
