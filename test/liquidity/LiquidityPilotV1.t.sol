// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxLiquiditySleeveV1} from "../../contracts/liquidity/HoodxLiquiditySleeveV1.sol";
import {HoodxLiquidityIndexV1} from "../../contracts/liquidity/HoodxLiquidityIndexV1.sol";
import {HoodxLiquidityControllerV1} from "../../contracts/liquidity/HoodxLiquidityControllerV1.sol";
import {INonfungiblePositionManagerLike} from "../../contracts/liquidity/UniswapV3Types.sol";

contract MockToken is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFactory {
    address public pool;

    function setPool(address value) external {
        pool = value;
    }

    function getPool(address, address, uint24) external view returns (address) {
        return pool;
    }
}

contract MockPool {
    address public factory;
    address public token0;
    address public token1;
    uint24 public fee = 500;
    int24 public tickSpacing = 10;
    int24 public tick;
    int24 public twapTick;
    uint8 public feeProtocol;

    constructor(address factory_, address token0_, address token1_) {
        factory = factory_;
        (token0, token1) = token0_ < token1_ ? (token0_, token1_) : (token1_, token0_);
    }

    function setTicks(int24 spot, int24 twap) external {
        tick = spot;
        twapTick = twap;
    }

    function setFeeProtocol(uint8 value) external {
        feeProtocol = value;
    }

    function liquidity() external pure returns (uint128) {
        return 1;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (1, tick, 0, 1, 1, feeProtocol, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory cumulatives, uint160[] memory secondsPerLiquidity)
    {
        cumulatives = new int56[](2);
        secondsPerLiquidity = new uint160[](2);
        cumulatives[0] = 0;
        cumulatives[1] = int56(twapTick) * int56(uint56(secondsAgos[0]));
    }
}

contract MockPositionManager {
    struct Position {
        address owner;
        address token0;
        address token1;
        uint128 liquidity;
        uint256 owed0;
        uint256 owed1;
    }
    uint256 public nextId = 1;
    mapping(uint256 => Position) public positions;

    function ownerOf(uint256 id) external view returns (address) {
        return positions[id].owner;
    }

    function addFees(uint256 id, uint256 amount0, uint256 amount1) external {
        Position storage pos = positions[id];
        ERC20(pos.token0).transferFrom(msg.sender, address(this), amount0);
        ERC20(pos.token1).transferFrom(msg.sender, address(this), amount1);
        pos.owed0 += amount0;
        pos.owed1 += amount1;
    }

    function mint(INonfungiblePositionManagerLike.MintParams calldata p)
        external
        returns (uint256 id, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired;
        liquidity = uint128(amount0 < amount1 ? amount0 : amount1);
        require(liquidity != 0);
        ERC20(p.token0).transferFrom(msg.sender, address(this), amount0);
        ERC20(p.token1).transferFrom(msg.sender, address(this), amount1);
        id = nextId++;
        positions[id] = Position(p.recipient, p.token0, p.token1, liquidity, 0, 0);
    }

    function increaseLiquidity(INonfungiblePositionManagerLike.IncreaseLiquidityParams calldata p)
        external
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[p.tokenId];
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired;
        liquidity = uint128(amount0 < amount1 ? amount0 : amount1);
        ERC20(pos.token0).transferFrom(msg.sender, address(this), amount0);
        ERC20(pos.token1).transferFrom(msg.sender, address(this), amount1);
        pos.liquidity += liquidity;
    }

    function decreaseLiquidity(INonfungiblePositionManagerLike.DecreaseLiquidityParams calldata p)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[p.tokenId];
        require(msg.sender == pos.owner && p.liquidity <= pos.liquidity);
        pos.liquidity -= p.liquidity;
        amount0 = p.liquidity;
        amount1 = p.liquidity;
        pos.owed0 += amount0;
        pos.owed1 += amount1;
    }

    function collect(INonfungiblePositionManagerLike.CollectParams calldata p)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[p.tokenId];
        require(msg.sender == pos.owner);
        amount0 = pos.owed0;
        amount1 = pos.owed1;
        pos.owed0 = 0;
        pos.owed1 = 0;
        ERC20(pos.token0).transfer(p.recipient, amount0);
        ERC20(pos.token1).transfer(p.recipient, amount1);
    }

    function burn(uint256 id) external {
        Position storage pos = positions[id];
        require(msg.sender == pos.owner && pos.liquidity == 0 && pos.owed0 == 0 && pos.owed1 == 0);
        delete positions[id];
    }
}

contract LiquidityPilotV1Test is Test {
    address internal curator = makeAddr("curator");
    address internal user = makeAddr("user");
    MockToken internal weth;
    MockToken internal usd;
    MockFactory internal factory;
    MockPool internal pool;
    MockPositionManager internal manager;
    HoodxLiquiditySleeveV1 internal sleeve;
    HoodxLiquidityIndexV1 internal index;
    HoodxLiquidityControllerV1 internal controller;

    function setUp() public {
        weth = new MockToken("WETH");
        usd = new MockToken("USDG");
        factory = new MockFactory();
        pool = new MockPool(address(factory), address(weth), address(usd));
        factory.setPool(address(pool));
        manager = new MockPositionManager();
        sleeve = new HoodxLiquiditySleeveV1(
            curator, address(manager), address(factory), address(pool), 0, -100, 100, "HOODX LP WETH-USDG", "hxLP-WU"
        );
        address[] memory sleeves_ = new address[](1);
        sleeves_[0] = address(sleeve);
        index = new HoodxLiquidityIndexV1(curator, address(weth), sleeves_, "HOODX Liquidity Prime", "HLPX");

        HoodxLiquidityControllerV1.Policy[] memory policies = new HoodxLiquidityControllerV1.Policy[](1);
        policies[0] = HoodxLiquidityControllerV1.Policy({
            halfWidth: 100,
            edgeBuffer: 20,
            maxTwapDeviation: 20,
            maxCenterMove: 200,
            twapSeconds: 5 minutes,
            breachDelay: 15 minutes,
            cooldown: 1 hours,
            blockTokenDownside: false
        });
        controller = new HoodxLiquidityControllerV1(address(index), curator, curator, curator, sleeves_, policies);
        vm.startPrank(curator);
        sleeve.transferOwnership(address(controller));
        index.transferOwnership(address(controller));
        controller.activate();
        vm.stopPrank();
    }

    function testPilotBootstrapUnwrapAndRecoveryWhileManagementPaused() public {
        weth.mint(curator, 150 ether);
        usd.mint(curator, 100 ether);
        vm.startPrank(curator);
        weth.approve(address(sleeve), 100 ether);
        usd.approve(address(sleeve), 100 ether);
        controller.seedSleeve(0, 100 ether, 100 ether, 100 ether, 100 ether, block.timestamp + 5 minutes);
        weth.transfer(address(index), 50 ether);
        controller.bootstrap(curator, 100 ether);
        vm.expectRevert(HoodxLiquidityControllerV1.Invalid.selector);
        controller.seedSleeve(0, 1, 1, 0, 0, block.timestamp + 5 minutes);
        index.transfer(user, 25 ether);
        controller.setManagementPaused(true);
        vm.stopPrank();

        vm.startPrank(user);
        index.unwrap(25 ether, user);
        uint256 sleeveShares = sleeve.balanceOf(user);
        assertEq(weth.balanceOf(user), 12.5 ether);
        assertEq(sleeveShares, 25 ether);
        sleeve.redeem(sleeveShares, user, 25 ether, 25 ether, block.timestamp + 5 minutes);
        vm.stopPrank();

        assertEq(weth.balanceOf(user), 37.5 ether);
        assertEq(usd.balanceOf(user), 25 ether);
        assertEq(sleeve.totalSupply(), 75 ether);
    }

    function testProgrammaticRebandRequiresDwellCooldownAndTwapAgreement() public {
        weth.mint(curator, 100 ether);
        usd.mint(curator, 100 ether);
        vm.startPrank(curator);
        weth.approve(address(sleeve), 100 ether);
        usd.approve(address(sleeve), 100 ether);
        controller.seedSleeve(0, 100 ether, 100 ether, 0, 0, block.timestamp + 5 minutes);
        vm.stopPrank();

        pool.setTicks(90, 90);
        vm.warp(1 hours + 1);
        assertFalse(controller.signal(0));
        vm.expectRevert(HoodxLiquidityControllerV1.NotReady.selector);
        vm.prank(curator);
        controller.executeReband(0, 0, 0, 1, block.timestamp + 5 minutes);

        vm.warp(block.timestamp + 15 minutes);
        assertTrue(controller.signal(0));
        vm.prank(curator);
        (int24 lower, int24 upper) = controller.executeReband(0, 0, 0, 1, 4_801);
        assertEq(lower, -10);
        assertEq(upper, 190);
        assertEq(sleeve.tickLower(), -10);
        assertEq(sleeve.tickUpper(), 190);
    }

    function testTwapDivergenceBlocksSignal() public {
        pool.setTicks(90, 0);
        vm.expectRevert(HoodxLiquidityControllerV1.Divergence.selector);
        controller.signal(0);
    }

    function testMissedObservationResetsDwellInsteadOfAssumingContinuity() public {
        pool.setTicks(90, 90);
        vm.warp(1 hours + 1);
        assertFalse(controller.signal(0));
        uint256 first = controller.breachSince(0);
        vm.warp(first + controller.MAX_OBSERVATION_GAP() + 1);
        assertFalse(controller.signal(0));
        assertGt(controller.breachSince(0), first);
        assertEq(controller.breachSince(0), controller.lastEdgeObservation(0));
    }

    function testSpotOnlyMoveCannotClearTwapDwell() public {
        pool.setTicks(90, 90);
        vm.warp(1 hours + 1);
        assertFalse(controller.signal(0));
        uint256 first = controller.breachSince(0);

        // Spot briefly returns inside the band while the five-minute TWAP remains at the edge.
        vm.warp(block.timestamp + 15 minutes);
        pool.setTicks(79, 90);
        assertTrue(controller.signal(0));
        assertEq(controller.breachSince(0), first);
    }

    function testCompoundReinvestsFeesWithoutMintingNewShares() public {
        weth.mint(curator, 110 ether);
        usd.mint(curator, 110 ether);
        vm.startPrank(curator);
        weth.approve(address(sleeve), 100 ether);
        usd.approve(address(sleeve), 100 ether);
        controller.seedSleeve(0, 100 ether, 100 ether, 0, 0, block.timestamp + 5 minutes);
        uint256 supply = sleeve.totalSupply();
        weth.approve(address(manager), 10 ether);
        usd.approve(address(manager), 10 ether);
        manager.addFees(sleeve.tokenId(), 10 ether, 10 ether);
        (uint128 added,,) = controller.compound(0, 10 ether, 10 ether, uint128(10 ether), block.timestamp + 5 minutes);
        vm.stopPrank();

        assertEq(added, 10 ether);
        assertEq(sleeve.positionLiquidity(), 110 ether);
        assertEq(sleeve.totalSupply(), supply);
    }

    function testFeeProtocolChangeBlocksManagementButNotRecovery() public {
        weth.mint(curator, 110 ether);
        usd.mint(curator, 110 ether);
        vm.startPrank(curator);
        weth.approve(address(sleeve), 100 ether);
        usd.approve(address(sleeve), 100 ether);
        controller.seedSleeve(0, 100 ether, 100 ether, 0, 0, block.timestamp + 5 minutes);
        weth.approve(address(manager), 10 ether);
        usd.approve(address(manager), 10 ether);
        manager.addFees(sleeve.tokenId(), 10 ether, 10 ether);
        pool.setFeeProtocol(1);
        vm.expectRevert(HoodxLiquiditySleeveV1.Invalid.selector);
        controller.compound(0, 0, 0, 1, block.timestamp + 5 minutes);
        uint256 shares = sleeve.balanceOf(address(index));
        vm.stopPrank();

        vm.prank(address(index));
        sleeve.transfer(user, shares);
        vm.prank(user);
        sleeve.redeem(shares, user, 0, 0, block.timestamp + 5 minutes);
        assertEq(sleeve.totalSupply(), 0);
        assertGt(weth.balanceOf(user) + usd.balanceOf(user), 0);
    }

    function testExpectedAssetDonationsAccrueProRataAndUnexpectedAssetsRemainRecoverable() public {
        weth.mint(curator, 120 ether);
        usd.mint(curator, 110 ether);
        MockToken unexpected = new MockToken("ODD");
        unexpected.mint(address(index), 3 ether);
        unexpected.mint(address(sleeve), 4 ether);
        vm.startPrank(curator);
        weth.approve(address(sleeve), 100 ether);
        usd.approve(address(sleeve), 100 ether);
        controller.seedSleeve(0, 100 ether, 100 ether, 0, 0, block.timestamp + 5 minutes);
        controller.bootstrap(curator, 100 ether);
        weth.transfer(address(index), 10 ether);
        weth.transfer(address(sleeve), 10 ether);
        usd.transfer(address(sleeve), 10 ether);
        controller.rescueIndexToken(address(unexpected), user, 3 ether);
        controller.rescueSleeveToken(0, address(unexpected), user, 4 ether);
        index.transfer(user, 50 ether);
        vm.stopPrank();

        vm.startPrank(user);
        index.unwrap(50 ether, user);
        sleeve.redeem(sleeve.balanceOf(user), user, 0, 0, block.timestamp + 5 minutes);
        vm.stopPrank();

        assertEq(unexpected.balanceOf(user), 7 ether);
        assertEq(weth.balanceOf(user), 60 ether);
        assertEq(usd.balanceOf(user), 55 ether);
    }

    function testDownsideRebandIsBlockedAfterCooldown() public {
        HoodxLiquiditySleeveV1 guarded = new HoodxLiquiditySleeveV1(
            curator, address(manager), address(factory), address(pool), 0, -100, 100, "Guarded", "G"
        );
        address[] memory guardedSleeves = new address[](1);
        guardedSleeves[0] = address(guarded);
        HoodxLiquidityIndexV1 guardedIndex =
            new HoodxLiquidityIndexV1(curator, address(weth), guardedSleeves, "Guarded index", "GI");
        HoodxLiquidityControllerV1.Policy[] memory guardedPolicies = new HoodxLiquidityControllerV1.Policy[](1);
        guardedPolicies[0] = HoodxLiquidityControllerV1.Policy(100, 20, 20, 200, 5 minutes, 15 minutes, 1 hours, true);
        HoodxLiquidityControllerV1 guardedController = new HoodxLiquidityControllerV1(
            address(guardedIndex), curator, curator, curator, guardedSleeves, guardedPolicies
        );
        vm.startPrank(curator);
        guarded.transferOwnership(address(guardedController));
        guardedIndex.transferOwnership(address(guardedController));
        guardedController.activate();
        weth.mint(curator, 100 ether);
        usd.mint(curator, 100 ether);
        weth.approve(address(guarded), 100 ether);
        usd.approve(address(guarded), 100 ether);
        guardedController.seedSleeve(0, 100 ether, 100 ether, 0, 0, block.timestamp + 5 minutes);
        vm.stopPrank();

        int24 downsideTick = guarded.token0() == address(weth) ? int24(90) : int24(-90);
        pool.setTicks(downsideTick, downsideTick);
        vm.warp(block.timestamp + 1 hours + 1);
        assertFalse(guardedController.signal(0));
        vm.warp(block.timestamp + 15 minutes);
        assertTrue(guardedController.signal(0));
        vm.expectRevert(HoodxLiquidityControllerV1.Divergence.selector);
        vm.prank(curator);
        guardedController.executeReband(0, 0, 0, 1, block.timestamp + 5 minutes);
    }

    function testFuzzProRataUnwrapAndSleeveRecovery(uint96 rawShares) public {
        uint256 shares = bound(uint256(rawShares), 1, 100 ether);
        weth.mint(curator, 150 ether);
        usd.mint(curator, 100 ether);
        vm.startPrank(curator);
        weth.approve(address(sleeve), 100 ether);
        usd.approve(address(sleeve), 100 ether);
        controller.seedSleeve(0, 100 ether, 100 ether, 0, 0, block.timestamp + 5 minutes);
        weth.transfer(address(index), 50 ether);
        controller.bootstrap(curator, 100 ether);
        index.transfer(user, shares);
        vm.stopPrank();

        vm.startPrank(user);
        index.unwrap(shares, user);
        uint256 sleeveShares = sleeve.balanceOf(user);
        sleeve.redeem(sleeveShares, user, 0, 0, block.timestamp + 5 minutes);
        vm.stopPrank();

        uint256 reserveShare = (50 ether * shares) / 100 ether;
        uint256 pairShare = shares;
        assertEq(
            IERC20(sleeve.token0()).balanceOf(user), pairShare + (sleeve.token0() == address(weth) ? reserveShare : 0)
        );
        assertEq(
            IERC20(sleeve.token1()).balanceOf(user), pairShare + (sleeve.token1() == address(weth) ? reserveShare : 0)
        );
    }
}
