import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json'));const w='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
if(d.assets.length!==20||d.assets.some(a=>a.error))throw Error('Complete discovery required');
const addr=a=>'address(bytes20(hex"'+a.slice(2)+'"))';
const cases=d.assets.flatMap(a=>{const refs=a.references.filter(r=>r.quote.toLowerCase()===w&&r.history1800&&BigInt(r.liquidity)>0n&&BigInt(r.harmonicLiquidity)>0n).sort((a,b)=>BigInt(a.liquidity)>BigInt(b.liquidity)?-1:1);if(!refs.length)return [];return [{...a,ref:refs[0]}];});
let s=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Generated discovery rehearsal; does not approve valuation depth or live configuration.
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {V2Hop,IV2Executor,IV2Weth} from "../../contracts/v2/Types.sol";
contract WatchlistRoutesForkTest is Test {
 using SafeERC20 for IERC20;
 address constant W=${addr(w)};
 address constant EX=${addr('0xa3e8761ce43d1a6afc5229d2aa83dcc5e2bbdd62')};
 address constant F=${addr('0x1f7d7550b1b028f7571e69a784071f0205fd2efa')};
 function setUp() public {if(!vm.envOr("HOODX_FORK_TEST",false)){vm.skip(true);return;}vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"),${d.block});assertEq(block.chainid,4663);vm.deal(address(this),1 ether);IV2Weth(W).deposit{value:1 ether}();}
 function run(address token,address pool,uint24 fee,uint128 depth,uint256 amount) internal {
 HoodxTwapV2 oracle=new HoodxTwapV2(F,token,W,pool,address(0),1800,depth,0);
 uint256 unit=10**18;uint256 price=oracle.value(token,unit);assertGt(price,0);
 V2Hop[] memory hops=new V2Hop[](1);hops[0].kind=3;hops[0].tokenIn=W;hops[0].tokenOut=token;hops[0].fee=fee;
 uint256 initialW=IERC20(W).balanceOf(EX);uint256 initialT=IERC20(token).balanceOf(EX);
 IERC20(W).forceApprove(EX,amount);
 uint256 got=IV2Executor(EX).execute(W,token,amount,amount*unit/price*9700/10000,abi.encode(hops),block.timestamp+300);
 assertGt(got,0);hops[0].tokenIn=token;hops[0].tokenOut=W;IERC20(token).forceApprove(EX,got);
 uint256 back=IV2Executor(EX).execute(token,W,got,oracle.value(token,got)*9700/10000,abi.encode(hops),block.timestamp+300);
 assertGt(back,0);assertEq(IERC20(token).balanceOf(address(this)),0);assertEq(IERC20(W).balanceOf(EX),initialW);assertEq(IERC20(token).balanceOf(EX),initialT);
 }
`;
for(const a of cases){const r=a.ref;const depth=(BigInt(r.liquidity)<BigInt(r.harmonicLiquidity)?BigInt(r.liquidity):BigInt(r.harmonicLiquidity))/2n;if(!depth)continue;for(const [label,amount] of [['Small','0.0001'],['Medium','0.001'],['Large','0.005']])s+=` function test${a.symbol.replace(/\W/g,'')}${label}() public {run(${addr(a.token)},${addr(r.pool)},${r.fee},${depth},${amount} ether);}\n`;}
s+=`
 function runSHROOMAlternative(uint256 amount) internal {
 address token=address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29"));
 address quote=address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
 HoodxTwapV2 oracle=new HoodxTwapV2(F,token,W,address(bytes20(hex"c641a0dc848e7aadd7c69d800bae2fea9b258610")),address(0),1800,${(() => {const r=cases.find(a=>a.symbol==="SHROOM").ref;return (BigInt(r.liquidity)<BigInt(r.harmonicLiquidity)?BigInt(r.liquidity):BigInt(r.harmonicLiquidity))/2n;})()},0);
 V2Hop[] memory b=new V2Hop[](2);b[0].kind=3;b[0].tokenIn=W;b[0].tokenOut=quote;b[0].fee=100;
 b[1].kind=4;b[1].tokenIn=quote;b[1].tokenOut=token;b[1].key.currency0=quote;b[1].key.currency1=token;b[1].key.fee=9000;b[1].key.tickSpacing=90;
 uint256 initialQ=IERC20(quote).balanceOf(EX);uint256 initialW=IERC20(W).balanceOf(EX);uint256 initialT=IERC20(token).balanceOf(EX);
 IERC20(W).forceApprove(EX,amount);uint256 got=IV2Executor(EX).execute(W,token,amount,amount*1 ether/oracle.value(token,1 ether)*9700/10000,abi.encode(b),block.timestamp+300);
 V2Hop[] memory sell=new V2Hop[](2);sell[0]=b[1];sell[0].tokenIn=token;sell[0].tokenOut=quote;sell[1]=b[0];sell[1].tokenIn=quote;sell[1].tokenOut=W;
 IERC20(token).forceApprove(EX,got);uint256 back=IV2Executor(EX).execute(token,W,got,oracle.value(token,got)*9700/10000,abi.encode(sell),block.timestamp+300);
 assertGt(back,0);assertEq(IERC20(token).balanceOf(address(this)),0);assertEq(IERC20(quote).balanceOf(EX),initialQ);assertEq(IERC20(W).balanceOf(EX),initialW);assertEq(IERC20(token).balanceOf(EX),initialT);
 }
 function testSHROOMAlternativeSmall() public {runSHROOMAlternative(0.0001 ether);}
 function testSHROOMAlternativeMedium() public {runSHROOMAlternative(0.001 ether);}
 function testSHROOMAlternativeLarge() public {runSHROOMAlternative(0.005 ether);}
`;s+='}\n';fs.writeFileSync('test/v2/WatchlistRoutesFork.t.sol',s);console.log('Generated protected sequential buy/sell cases for '+cases.length+' assets at block '+d.block);
