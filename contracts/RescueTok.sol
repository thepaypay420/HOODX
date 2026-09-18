// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev One-off V3 extract token. Not a product. Curator-owned liquidity
///      so a bricked vault can buy WETH→token and the LP can pull ETH out.
contract RescueTok {
    string public name = "RSC";
    string public symbol = "RSC";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public pool;
    int24 public tickLower;
    int24 public tickUpper;
    uint128 public liq;

    error NotOwner();
    error NotPool();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        uint256 amt = 1_000_000_000 * 1e18;
        totalSupply = amt;
        balanceOf[address(this)] = amt;
        emit Transfer(address(0), address(this), amt);
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) public returns (bool) {
        if (balanceOf[msg.sender] < value) revert NotOwner();
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < value) revert NotOwner();
            allowance[from][msg.sender] = a - value;
        }
        if (balanceOf[from] < value) revert NotOwner();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }

    function setPool(address pool_, int24 lo, int24 hi) external onlyOwner {
        pool = pool_;
        tickLower = lo;
        tickUpper = hi;
    }

    function mintLp(uint128 L) external onlyOwner {
        liq += L;
        IUniV3Pool(pool).mint(address(this), tickLower, tickUpper, L, "");
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        if (msg.sender != pool) revert NotPool();
        address t0 = IUniV3Pool(pool).token0();
        address t1 = IUniV3Pool(pool).token1();
        if (amount0 > 0) _pay(t0, amount0);
        if (amount1 > 0) _pay(t1, amount1);
    }

    function exitLp() external onlyOwner {
        uint128 L = liq;
        if (L > 0) {
            liq = 0;
            IUniV3Pool(pool).burn(tickLower, tickUpper, L);
            IUniV3Pool(pool).collect(owner, tickLower, tickUpper, type(uint128).max, type(uint128).max);
        }
        uint256 t = balanceOf[address(this)];
        if (t > 0) transfer(owner, t);
        address weth = IUniV3Pool(pool).token0() == address(this)
            ? IUniV3Pool(pool).token1()
            : IUniV3Pool(pool).token0();
        uint256 w = IERC20(weth).balanceOf(address(this));
        if (w > 0) IERC20(weth).transfer(owner, w);
        uint256 eth = address(this).balance;
        if (eth > 0) {
            (bool ok, ) = owner.call{value: eth}("");
            if (!ok) revert NotOwner();
        }
    }

    function _pay(address token, uint256 amt) internal {
        if (token == address(this)) {
            balanceOf[address(this)] -= amt;
            balanceOf[msg.sender] += amt;
            emit Transfer(address(this), msg.sender, amt);
        } else if (!IERC20(token).transfer(msg.sender, amt)) {
            revert NotOwner();
        }
    }

    receive() external payable {}
}

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IUniV3Pool {
    function mint(address, int24, int24, uint128, bytes calldata) external returns (uint256, uint256);
    function burn(int24, int24, uint128) external returns (uint256, uint256);
    function collect(address, int24, int24, uint128, uint128) external returns (uint256, uint256);
    function token0() external view returns (address);
    function token1() external view returns (address);
}
