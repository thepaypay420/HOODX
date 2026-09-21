import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json'));
const a=x=>'address(bytes20(hex"'+x.slice(2).toLowerCase()+'"))';
let s=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HoodxExecutorV3} from "../../contracts/v3/HoodxExecutorV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {V2Hop,V2PoolKey,IV2Weth} from "../../contracts/v2/Types.sol";
interface F3 {function getPool(address,address,uint24) external view returns(address);}
interface P3 {function liquidity() external view returns(uint128);}
interface P2 {function getReserves() external view returns(uint112,uint112,uint32);function token0() external view returns(address);}
interface F2 {function getPair(address,address)external view returns(address);}
interface Q3 {struct Params {address tokenIn;address tokenOut;uint256 amountIn;uint24 fee;uint160 sqrtPriceLimitX96;}function quoteExactInputSingle(Params calldata)external returns(uint256,uint160,uint32,uint256);}
interface Q4 {struct Params {V2PoolKey poolKey;bool zeroForOne;uint128 exactAmount;bytes hookData;}function quoteExactInputSingle(Params calldata)external returns(uint256,uint256);}
/// Execution capability only: quoter-derived floors are NOT independent NAV valuation approval.
contract SuccessorWatchlistForkTest is Test {
 using SafeERC20 for IERC20;
 address constant W=${a('0x0bd7d308f8e1639fab988df18a8011f41eacad73')};
 address constant VF=${a('0x1f7d7550b1b028f7571e69a784071f0205fd2efa')};
 address constant PF=${a('0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f')};
 HoodxExecutorV3 ex;
 function setUp()public {if(!vm.envOr("HOODX_FORK_TEST",false)){vm.skip(true);return;}
 vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"),vm.envUint("HOODX_FORK_BLOCK"));assertEq(block.chainid,4663);
 HoodxHookRegistryV3 registry=new HoodxHookRegistryV3(address(this));uint256 now_=vm.getBlockTimestamp();vm.warp(now_-2 days);
 registry.propose(${a('0xe5e702641ea86f4ae6cc3cdaed2b886f976be044')},bytes32(uint256(1)));registry.propose(${a('0x62e200cc8e4d95cf622f40dd70f407c883ecb0cc')},bytes32(uint256(2)));
 vm.warp(now_);registry.activate(${a('0xe5e702641ea86f4ae6cc3cdaed2b886f976be044')});registry.activate(${a('0x62e200cc8e4d95cf622f40dd70f407c883ecb0cc')});
 ex=new HoodxExecutorV3(W,${a('0x8876789976decbfcbbbe364623c63652db8c0904')},${a('0x000000000022d473030f116ddee9f6b43ac78ba3')},VF,${a('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b')},PF,address(registry));vm.deal(address(this),1 ether);IV2Weth(W).deposit{value:1 ether}();}
 function bridge(address q)internal view returns(V2Hop memory h){uint24[4] memory fees=[uint24(100),500,3000,10000];uint128 best;uint24 chosen;for(uint i;i<4;i++){address p=F3(VF).getPool(W,q,fees[i]);if(p!=address(0)){uint128 l=P3(p).liquidity();if(l>best){best=l;chosen=fees[i];}}}require(best>0,"no liquid bridge");h.kind=3;h.tokenIn=W;h.tokenOut=q;h.fee=chosen;}
 function quote(V2Hop memory h,uint256 amount)internal returns(uint256 out){
 if(h.kind==2){address p=F2(PF).getPair(h.tokenIn,h.tokenOut);(uint112 r0,uint112 r1,)=P2(p).getReserves();(uint256 rin,uint256 rout)=P2(p).token0()==h.tokenIn?(uint256(r0),uint256(r1)):(uint256(r1),uint256(r0));return amount*997*rout/(rin*1000+amount*997);}
 if(h.kind==3){(out,,,)=Q3(${a('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')}).quoteExactInputSingle(Q3.Params(h.tokenIn,h.tokenOut,amount,h.fee,0));}
 else{(out,)=Q4(${a('0x8dc178efb8111bb0973dd9d722ebeff267c98f94')}).quoteExactInputSingle(Q4.Params(h.key,h.tokenIn==h.key.currency0,uint128(amount),h.hookData));}}
 function run(V2Hop memory assetHop)internal {address token=assetHop.tokenOut;bool needsBridge=assetHop.tokenIn!=W&&assetHop.tokenIn!=address(0);V2Hop[] memory b=new V2Hop[](needsBridge?2:1);b[b.length-1]=assetHop;if(needsBridge)b[0]=bridge(assetHop.tokenIn);
 uint256 amount=.001 ether;uint256 expected=amount;for(uint i;i<b.length;i++)expected=quote(b[i],expected);require(expected>0,"zero buy quote");IERC20(W).forceApprove(address(ex),amount);
 uint256 got=ex.execute(W,token,amount,expected*9700/10000,abi.encode(b),block.timestamp+300);V2Hop[] memory sell=new V2Hop[](b.length);for(uint i;i<b.length;i++){sell[i]=b[b.length-1-i];(sell[i].tokenIn,sell[i].tokenOut)=(sell[i].tokenOut,sell[i].tokenIn);}
 expected=got;for(uint i;i<sell.length;i++)expected=quote(sell[i],expected);require(expected>0,"zero sell quote");IERC20(token).forceApprove(address(ex),got);
 uint256 back=ex.execute(token,W,got,expected*9700/10000,abi.encode(sell),block.timestamp+300);emit log_named_uint("ETH returned wei",back);assertEq(IERC20(token).balanceOf(address(this)),0);assertEq(IERC20(token).balanceOf(address(ex)),0);assertEq(IERC20(W).balanceOf(address(ex)),0);assertEq(address(ex).balance,0);if(needsBridge)assertEq(IERC20(assetHop.tokenIn).balanceOf(address(ex)),0);}
`;
for(const t of d.assets){let body;const ps=t.pools.filter(p=>p.version==='v4'&&p.identityMatches&&BigInt(p.activeLiquidity)>0n).sort((a,b)=>(b.displayLiquidityUsd||0)-(a.displayLiquidityUsd||0));if(['PONS','Index','UP','website'].includes(t.symbol)){const refs=t.references.filter(r=>r.quote.toLowerCase()==='0x0bd7d308f8e1639fab988df18a8011f41eacad73'&&r.history1800&&BigInt(r.liquidity)>0n).sort((a,b)=>BigInt(a.liquidity)>BigInt(b.liquidity)?-1:1);body=`h.kind=3;h.tokenIn=W;h.fee=${refs[0].fee};`;}
else if(ps.length){if(['PRISM','NET'].includes(t.symbol)){const eligible=ps.filter(p=>p.key.hooks.toLowerCase()==='0x0000000000000000000000000000000000000000'&&p.key.fee<=15000&&(p.quote.toLowerCase()==='0x0000000000000000000000000000000000000000'||p.quote.toLowerCase()==='0x0bd7d308f8e1639fab988df18a8011f41eacad73'));if(!eligible.length)throw Error('No low-fee route');ps.splice(0,ps.length,...eligible);}const k=ps[0].key;const q=k.currency0.toLowerCase()===t.token.toLowerCase()?k.currency1:k.currency0;body=`h.kind=4;h.tokenIn=${a(q)};h.key=V2PoolKey(${a(k.currency0)},${a(k.currency1)},${k.fee},${k.tickSpacing},${a(k.hooks)});`;}
else{const r=t.references.find(r=>r.quote.toLowerCase()==='0x0bd7d308f8e1639fab988df18a8011f41eacad73'&&BigInt(r.liquidity)>0n);body=`h.kind=3;h.tokenIn=W;h.fee=${r.fee};`;}
s+=`function test${t.symbol.replace(/\W/g,'')}()public{V2Hop memory h;h.tokenOut=${a(t.token)};${body}run(h);}\n`;}
s+='}\n';fs.mkdirSync('test/v3',{recursive:true});fs.writeFileSync('test/v3/SuccessorWatchlistFork.t.sol',s);


