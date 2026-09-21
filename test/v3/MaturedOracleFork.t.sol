// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {SuccessorWatchlistForkTest} from "./SuccessorWatchlistFork.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoodxRoutingV3} from "../../contracts/v3/HoodxRoutingV3.sol";
import {HoodxHookRegistryV3} from "../../contracts/v3/HoodxHookRegistryV3.sol";
import {HoodxFeeModelV3} from "../../contracts/v3/HoodxFeeModelV3.sol";
import {HoodxTwapV2} from "../../contracts/v2/HoodxTwapV2.sol";
import {HoodxFreshTwapV3} from "../../contracts/v3/HoodxFreshTwapV3.sol";
import {V2Hop,V2PoolKey} from "../../contracts/v2/Types.sol";
// Candidate validation only. Depth baselines are pinned to pre-maintenance block 68903983,
// not lowered to match today's liquidity. Passing does not replace economic source review.
contract MaturedOracleForkTest is SuccessorWatchlistForkTest {
 function check(bool prism,uint256 amount) internal {
  address token=prism?address(bytes20(hex"20024e485c0b22b42855589700721b28320a7777")):address(bytes20(hex"9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc"));
  address pool=prism?address(bytes20(hex"f1d6b8ecaf2271233bed626fb1962bc0c39cb1f3")):address(bytes20(hex"f1bef60e5cf6c00e7e1308d3710811dad71f4b6c"));
  uint128 depth=prism?347815142061690044664:7668210664725484672756;
  HoodxTwapV2 base=new HoodxTwapV2(VF,token,W,pool,address(0),1800,depth,0);
  HoodxFreshTwapV3 oracle=new HoodxFreshTwapV3(address(base),1800);
  HoodxHookRegistryV3 registry=new HoodxHookRegistryV3(address(this));
  address qh=address(bytes20(hex"62e200cc8e4d95cf622f40dd70f407c883ecb0cc"));
  address ph=address(bytes20(hex"e5e702641ea86f4ae6cc3cdaed2b886f976be044"));
  HoodxRoutingV3 router=new HoodxRoutingV3(address(ex),address(bytes20(hex"42024fcfdb4f3089dd619a0cef0cd24e7b841c18")),address(registry),address(bytes20(hex"5a86828efd322bfb16d93cfed16ee9bc14940d7f")),qh);
  HoodxFeeModelV3 fees=new HoodxFeeModelV3(address(router),qh,ph);
  V2Hop[] memory h=new V2Hop[](1);
  h[0].kind=prism?6:4;h[0].tokenIn=prism?W:address(0);h[0].tokenOut=token;
  if(prism){h[0].fee=3000;h[0].hookData=abi.encode(uint256(300));}
  else h[0].key=V2PoolKey(address(0),token,0,200,ph);
  uint256 fair=amount*1e18/oracle.value(token,1e18);
  uint256 minimum=fair*fees.factor(abi.encode(h))/1e18*9700/10000;
  emit log_named_uint("Independent protected buy minimum",minimum);
  IERC20(W).approve(address(router),amount);
  uint256 snap=vm.snapshotState();
  uint256 executable=router.execute(W,token,amount,1,abi.encode(h),block.timestamp);
  emit log_named_uint("Actual net buy diagnostic",executable);
  assertTrue(vm.revertToState(snap));
  uint256 got=router.execute(W,token,amount,minimum,abi.encode(h),block.timestamp);
  (h[0].tokenIn,h[0].tokenOut)=(h[0].tokenOut,h[0].tokenIn);
  minimum=oracle.value(token,got)*fees.factor(abi.encode(h))/1e18*9700/10000;
  emit log_named_uint("Independent protected sell minimum",minimum);
  IERC20(token).approve(address(router),got);
  uint256 back=router.execute(token,W,got,minimum,abi.encode(h),block.timestamp);
  emit log_named_uint("ETH returned",back);
  assertEq(IERC20(token).balanceOf(address(this)),0);
  assertEq(IERC20(token).balanceOf(address(router)),0);
  assertEq(IERC20(W).balanceOf(address(router)),0);
 }
 function testMaturedPrismSmall() public {check(true,0.0001 ether);}
 function testMaturedPrismMedium() public {check(true,0.001 ether);}
 function testMaturedPrismLarge() public {check(true,0.005 ether);}
 function testMaturedZealSmall() public {check(false,0.0001 ether);}
 function testMaturedZealMedium() public {check(false,0.001 ether);}
 function testMaturedZealLarge() public {check(false,0.005 ether);}
}
