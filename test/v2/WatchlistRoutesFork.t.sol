// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Generated discovery rehearsal; does not approve valuation depth or live configuration.
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {V2Hop,IV2Executor,IV2Weth} from "../../contracts/v2/Types.sol";
contract WatchlistRoutesForkTest is Test {
 using SafeERC20 for IERC20;
 address constant W=address(bytes20(hex"0bd7d308f8e1639fab988df18a8011f41eacad73"));
 address constant EX=address(bytes20(hex"a3e8761ce43d1a6afc5229d2aa83dcc5e2bbdd62"));
 address constant F=address(bytes20(hex"1f7d7550b1b028f7571e69a784071f0205fd2efa"));
 function setUp() public {if(!vm.envOr("HOODX_FORK_TEST",false)){vm.skip(true);return;}vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"),68574692);assertEq(block.chainid,4663);vm.deal(address(this),1 ether);IV2Weth(W).deposit{value:1 ether}();}
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
 function testPONSSmall() public {run(address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571")),address(bytes20(hex"Ed50bDeeA8aDC232f159486192a4157281D722ff")),3000,253148563115285537935534,0.0001 ether);}
 function testPONSMedium() public {run(address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571")),address(bytes20(hex"Ed50bDeeA8aDC232f159486192a4157281D722ff")),3000,253148563115285537935534,0.001 ether);}
 function testPONSLarge() public {run(address(bytes20(hex"39dbed3a2bd333467115de45665cc57f813c4571")),address(bytes20(hex"Ed50bDeeA8aDC232f159486192a4157281D722ff")),3000,253148563115285537935534,0.005 ether);}
 function testAISmall() public {run(address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),address(bytes20(hex"c4a21f9d6485FC5893DD4A491B320a83DAF4Da1D")),10000,131096565576109112076752,0.0001 ether);}
 function testAIMedium() public {run(address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),address(bytes20(hex"c4a21f9d6485FC5893DD4A491B320a83DAF4Da1D")),10000,131096565576109112076752,0.001 ether);}
 function testAILarge() public {run(address(bytes20(hex"2e8c31162b855a2ffa90f6f8634643ad6f111e18")),address(bytes20(hex"c4a21f9d6485FC5893DD4A491B320a83DAF4Da1D")),10000,131096565576109112076752,0.005 ether);}
 function testCASHCATSmall() public {run(address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),address(bytes20(hex"d42A491087a15E5afd51FEb3606066Cc152d2b09")),3000,116041477830191960481463,0.0001 ether);}
 function testCASHCATMedium() public {run(address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),address(bytes20(hex"d42A491087a15E5afd51FEb3606066Cc152d2b09")),3000,116041477830191960481463,0.001 ether);}
 function testCASHCATLarge() public {run(address(bytes20(hex"020bfc650a365f8bb26819deaabf3e21291018b4")),address(bytes20(hex"d42A491087a15E5afd51FEb3606066Cc152d2b09")),3000,116041477830191960481463,0.005 ether);}
 function testIndexSmall() public {run(address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870")),address(bytes20(hex"D29893fFac8b29eC4Db2cfE0CDB3FE1377c028Ff")),10000,89997873140346087874970,0.0001 ether);}
 function testIndexMedium() public {run(address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870")),address(bytes20(hex"D29893fFac8b29eC4Db2cfE0CDB3FE1377c028Ff")),10000,89997873140346087874970,0.001 ether);}
 function testIndexLarge() public {run(address(bytes20(hex"56910d4409f3a0c78c64dd8d0545ff0705389870")),address(bytes20(hex"D29893fFac8b29eC4Db2cfE0CDB3FE1377c028Ff")),10000,89997873140346087874970,0.005 ether);}
 function testMEMESmall() public {run(address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),address(bytes20(hex"97BCdd384fC144899545dEB749b6DAF2AA52a2C5")),10000,30215463543376618452963,0.0001 ether);}
 function testMEMEMedium() public {run(address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),address(bytes20(hex"97BCdd384fC144899545dEB749b6DAF2AA52a2C5")),10000,30215463543376618452963,0.001 ether);}
 function testMEMELarge() public {run(address(bytes20(hex"385f4f8ae47651ce5f58f5265395a669f8281e18")),address(bytes20(hex"97BCdd384fC144899545dEB749b6DAF2AA52a2C5")),10000,30215463543376618452963,0.005 ether);}
 function testSTONKBROKERSmall() public {run(address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),address(bytes20(hex"9cd74d5980A4BF60408B9bA2B0F6a3d368EBf594")),10000,25076394195098161521902,0.0001 ether);}
 function testSTONKBROKERMedium() public {run(address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),address(bytes20(hex"9cd74d5980A4BF60408B9bA2B0F6a3d368EBf594")),10000,25076394195098161521902,0.001 ether);}
 function testSTONKBROKERLarge() public {run(address(bytes20(hex"e934e36a439c94017b64a3fece66af12099abf50")),address(bytes20(hex"9cd74d5980A4BF60408B9bA2B0F6a3d368EBf594")),10000,25076394195098161521902,0.005 ether);}
 function testHOOKRSmall() public {run(address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),address(bytes20(hex"42b19e5e3F28C4148C518444546f102F6ba87aB1")),10000,11501432661902929670775,0.0001 ether);}
 function testHOOKRMedium() public {run(address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),address(bytes20(hex"42b19e5e3F28C4148C518444546f102F6ba87aB1")),10000,11501432661902929670775,0.001 ether);}
 function testHOOKRLarge() public {run(address(bytes20(hex"18e674231a58c239dc7daedcffe15ec3a24cff5c")),address(bytes20(hex"42b19e5e3F28C4148C518444546f102F6ba87aB1")),10000,11501432661902929670775,0.005 ether);}
 function testDELTASmall() public {run(address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),address(bytes20(hex"D64FbdA67E1015dF43Fa5e49F02cA844729E5F94")),10000,101373463884191126476255,0.0001 ether);}
 function testDELTAMedium() public {run(address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),address(bytes20(hex"D64FbdA67E1015dF43Fa5e49F02cA844729E5F94")),10000,101373463884191126476255,0.001 ether);}
 function testDELTALarge() public {run(address(bytes20(hex"e8ffd7e24187f72afb08d75b1bb13088a989a791")),address(bytes20(hex"D64FbdA67E1015dF43Fa5e49F02cA844729E5F94")),10000,101373463884191126476255,0.005 ether);}
 function testSHROOMSmall() public {run(address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),address(bytes20(hex"C641a0DC848E7aadd7c69d800BAE2FEA9b258610")),10000,13276290020137025393775,0.0001 ether);}
 function testSHROOMMedium() public {run(address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),address(bytes20(hex"C641a0DC848E7aadd7c69d800BAE2FEA9b258610")),10000,13276290020137025393775,0.001 ether);}
 function testSHROOMLarge() public {run(address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29")),address(bytes20(hex"C641a0DC848E7aadd7c69d800BAE2FEA9b258610")),10000,13276290020137025393775,0.005 ether);}
 function testBOWSmall() public {run(address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),address(bytes20(hex"DaF8038E8Eab4A56bD1C0485D414241622384FEF")),10000,8145957189800637705034,0.0001 ether);}
 function testBOWMedium() public {run(address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),address(bytes20(hex"DaF8038E8Eab4A56bD1C0485D414241622384FEF")),10000,8145957189800637705034,0.001 ether);}
 function testBOWLarge() public {run(address(bytes20(hex"451b42a15100c340ca12f7c66de06fac5ea2d751")),address(bytes20(hex"DaF8038E8Eab4A56bD1C0485D414241622384FEF")),10000,8145957189800637705034,0.005 ether);}
 function testUPSmall() public {run(address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1")),address(bytes20(hex"4EF94cD1Ab45eBbB50F9E73Cd6e45C5027caa3F7")),10000,2108735684809589793726,0.0001 ether);}
 function testUPMedium() public {run(address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1")),address(bytes20(hex"4EF94cD1Ab45eBbB50F9E73Cd6e45C5027caa3F7")),10000,2108735684809589793726,0.001 ether);}
 function testUPLarge() public {run(address(bytes20(hex"57c0e45cb534413d1c20a4240955d6bb250bb4f1")),address(bytes20(hex"4EF94cD1Ab45eBbB50F9E73Cd6e45C5027caa3F7")),10000,2108735684809589793726,0.005 ether);}
 function testQUOTRONSmall() public {run(address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),address(bytes20(hex"df63749e93D443Ed548186a351ae6B37d8914Ac3")),3000,163579489062792213,0.0001 ether);}
 function testQUOTRONMedium() public {run(address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),address(bytes20(hex"df63749e93D443Ed548186a351ae6B37d8914Ac3")),3000,163579489062792213,0.001 ether);}
 function testQUOTRONLarge() public {run(address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),address(bytes20(hex"df63749e93D443Ed548186a351ae6B37d8914Ac3")),3000,163579489062792213,0.005 ether);}
 function testwebsiteSmall() public {run(address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506")),address(bytes20(hex"6D489e07d7Fe2b4Bc5749f75d56337888B68a34a")),10000,31079884164729611041566,0.0001 ether);}
 function testwebsiteMedium() public {run(address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506")),address(bytes20(hex"6D489e07d7Fe2b4Bc5749f75d56337888B68a34a")),10000,31079884164729611041566,0.001 ether);}
 function testwebsiteLarge() public {run(address(bytes20(hex"0762c1708f0d23f86b29d6b857121ff7df357506")),address(bytes20(hex"6D489e07d7Fe2b4Bc5749f75d56337888B68a34a")),10000,31079884164729611041566,0.005 ether);}
 function testQUOTIENTSmall() public {run(address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f")),address(bytes20(hex"10F49351Db85BFfC0C0d837771A6e4DA2dd2Daa1")),100,167706750549845545437706,0.0001 ether);}
 function testQUOTIENTMedium() public {run(address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f")),address(bytes20(hex"10F49351Db85BFfC0C0d837771A6e4DA2dd2Daa1")),100,167706750549845545437706,0.001 ether);}
 function testQUOTIENTLarge() public {run(address(bytes20(hex"013940c3daa5e2bb12df1ea94afe47ce84c0db4f")),address(bytes20(hex"10F49351Db85BFfC0C0d837771A6e4DA2dd2Daa1")),100,167706750549845545437706,0.005 ether);}

 function runSHROOMAlternative(uint256 amount) internal {
 address token=address(bytes20(hex"ab093def657f15df31b33922a95e047add645b29"));
 address quote=address(bytes20(hex"5fc5360d0400a0fd4f2af552add042d716f1d168"));
 HoodxTwapV2 oracle=new HoodxTwapV2(F,token,W,address(bytes20(hex"c641a0dc848e7aadd7c69d800bae2fea9b258610")),address(0),1800,13276290020137025393775,0);
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
}
