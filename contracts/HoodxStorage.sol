// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniV3Pool, IStateView, IPosm, PoolKey} from "./UniTwap.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

interface IPoolManager {
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

/// @dev Shared clone storage. HoodxIndex and HoodxSwap must keep this layout identical.
contract HoodxStorage {
    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant MAX_FEE_BPS = 100;
    uint32 public constant TWAP_SECS = 60;
    uint16 public constant MAX_SLIP_BPS = 300;
    uint16 public constant ORACLE_CARDINALITY = 16;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    uint8 public constant decimals = 18;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant WETH_USDG_V3 = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    uint256 public constant VIRTUAL_ASSETS = 1e12;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    string public name;
    string public symbol;
    address public factory;
    address public owner;
    address public pendingOwner;
    address public creator;
    address public creatorRecipient;
    address public protocol;
    address public weth;
    address public swapRouter;
    address public v4Manager;
    address public v4StateView;
    address public v4Posm;
    address[] public tokens;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint16) public targetBps;
    mapping(address => uint256) public costBasis;
    mapping(address => bool) public listed;
    mapping(address => address) public poolOf;
    mapping(address => bytes32) public poolIdOf;
    mapping(address => bool) public isV4;
    mapping(address => PoolKey) public v4Key;
    mapping(address => uint256) public lastPxWad;
    mapping(address => address) public quoteOf;
    mapping(address => bool) public allowedQuote;
    mapping(address => address) public quoteBridgeV3;

    uint256 public totalSupply;
    uint16 public protocolFeeBps;
    uint16 public creatorFeeBps;
    uint16 public redeemFeeBps;
    uint16 public cashTargetBps;
    uint256 public minDeposit;
    uint256 public minFirstDeposit;
    uint256 public minSleeveWeth;
    uint256 public genesisEthPerShare;
    bool public paused;
    string public imageURI;
    uint256 internal locked;
    bool internal implLock;

    error NotOwner();
    error NotCreator();
    error BadOwner();
    error Zero();
    error BadLen();
    error TooSmall();
    error DustSleeve();
    error NeedBuffer();
    error Paused();
    error TransferFailed();
    error Listed();
    error CashFloor();
    error MaxFee();
    error SwapFailed();
    error Unpriced();
    error AlreadyInit();
    error BadPair();
    error Slippage();
    error BadPool();
    error HookedPool();
    error NotManager();
    error OnlySelf();
    error Started();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed user, uint256 ethIn, uint256 shares, uint256 protocolFee, uint256 creatorFee, uint256 sharePrice);
    event Withdraw(address indexed user, uint256 shares, uint256 ethOut, uint256 fee, uint256 sharePrice);
    event Deployed(uint256 wethSpent, uint256 names);
    event Liquidated(uint256 shares, uint256 names);
    event Targets(address[] tokens, uint16[] bps);
    event Rebalanced(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 minOut);
    event Restored(address indexed token, uint256 amountIn, uint256 minOut);
    event CreatorFee(uint16 bps);
    event CreatorRecipient(address indexed who);
    event TokenAdded(address indexed token, bytes32 poolRef, bool v4);
    event TokenRebound(address indexed token, bytes32 poolRef, bool v4);
    event TokenRemoved(address indexed token);
    event TokenStranded(address indexed token, uint256 balance);
    event Floors(uint256 minDeposit, uint256 minFirst, uint256 minSleeve, uint16 cashBps);
    event Genesis(uint256 ethPerShare);
    event PausedSet(bool paused);
    event OwnerSet(address indexed owner);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferCanceled(address indexed owner, address indexed pending);
    event QuoteBridgeSet(address indexed quote, address indexed v3Bridge);
    event ImageURISet(string uri);

    struct InitParams {
        address creator;
        address protocol;
        address weth;
        address router;
        address v4Manager;
        address v4StateView;
        address v4Posm;
        string name;
        string symbol;
        uint16 protocolFeeBps;
        uint16 creatorFeeBps;
        uint256 minFirstDeposit;
        address recipient;
        string imageURI;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 0) revert SwapFailed();
        locked = 1;
        _;
        locked = 0;
    }
}
