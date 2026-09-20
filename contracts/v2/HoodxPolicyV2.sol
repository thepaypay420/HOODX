// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IV2Executor, IV2Oracle, IV2Policy} from "./Types.sol";

/// @notice Append-only compatibility attestations. Approval is a disclosed governance trust boundary.
contract HoodxPolicyV2 is Ownable2Step, IV2Policy {
    address public immutable executor;

    struct Config {
        address token;
        address oracle;
        bytes buy;
        bytes sell;
    }
    mapping(bytes32 => Config) private entries;
    event ConfigApproved(bytes32 indexed id, address indexed token, address oracle, bytes32 evidence);
    error InvalidConfig();

    constructor(address admin, address executor_) Ownable(admin) {
        if (executor_.code.length == 0) revert InvalidConfig();
        executor = executor_;
    }

    function approveConfig(address token, address oracle, bytes calldata buy, bytes calldata sell, bytes32 evidence)
        external
        onlyOwner
        returns (bytes32 id)
    {
        return _approveConfig(token, oracle, buy, sell, evidence);
    }

    function _approveConfig(address token, address oracle, bytes memory buy, bytes memory sell, bytes32 evidence)
        internal
        returns (bytes32 id)
    {
        if (token.code.length == 0 || oracle.code.length == 0 || evidence == 0) revert InvalidConfig();
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals > 18) revert InvalidConfig();
        address cash = IV2Executor(executor).weth();
        IV2Executor(executor).validateRoute(buy, cash, token);
        IV2Executor(executor).validateRoute(sell, token, cash);
        if (IV2Oracle(oracle).value(token, 10 ** decimals) == 0) revert InvalidConfig();
        id = keccak256(abi.encode(token, oracle, buy, sell, evidence));
        if (entries[id].token != address(0)) revert InvalidConfig();
        entries[id] = Config(token, oracle, buy, sell);
        emit ConfigApproved(id, token, oracle, evidence);
    }

    function config(bytes32 id)
        external
        view
        returns (address token, address oracle, bytes memory buy, bytes memory sell)
    {
        Config storage c = entries[id];
        if (c.token == address(0)) revert InvalidConfig();
        return (c.token, c.oracle, c.buy, c.sell);
    }
}
