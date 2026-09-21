/** Prepare reviewable public calldata only. This script never signs or sends. */
import fs from 'node:fs';
import {createPublicClient,http,parseAbi,encodeFunctionData,formatEther} from 'viem';
async function main(){
 const rpc=process.env.ROBINHOOD_RPC_URL;if(!rpc)throw Error('config');
 const c=createPublicClient({transport:http(rpc,{retryCount:1,timeout:30000})});
 if(await c.getChainId()!==4663)throw Error('chain');
 const capacity=Number(process.argv[2]||128);if(!Number.isInteger(capacity)||capacity<2||capacity>2048)throw Error('capacity');
 const account='0x134D468B0bcaeA6DF127916f951F7938c06A37C6';
 const abi=parseAbi(['function getPool(address,address,uint24) view returns(address)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function increaseObservationCardinalityNext(uint16)']);
 const d=JSON.parse(fs.readFileSync('deployments/successor-price-source-audit.json'));
 const block=await c.getBlockNumber(),gasPrice=await c.getGasPrice(),balance=await c.getBalance({address:account,blockNumber:block});
 const report={chainId:4663,block:String(block),account,capacity,gasPriceWei:String(gasPrice),balanceWei:String(balance),transactions:[],broadcast:false,requiresLiveRefresh:true,warning:'Increasing capacity does not create history. Wait for genuine observations and validate age, depth, price agreement and route behavior before use.'};
 let budget=0n;
 for(const symbol of ['PRISM','ZEAL']){
  const p=d.v3.find(r=>r.symbol===symbol&&!r.error);if(!p)throw Error('missing');
  const actual=await c.readContract({address:'0x1f7d7550b1b028f7571e69a784071f0205fd2efa',abi,functionName:'getPool',args:[p.token,'0x0bd7d308f8e1639fab988df18a8011f41eacad73',10000],blockNumber:block});
  if(actual.toLowerCase()!==p.pool.toLowerCase())throw Error('identity');
  const slot=await c.readContract({address:p.pool,abi,functionName:'slot0',blockNumber:block});
  if(slot[4]>=capacity)continue;
  const data=encodeFunctionData({abi,functionName:'increaseObservationCardinalityNext',args:[capacity]});
  const gas=await c.estimateGas({account,to:p.pool,data,value:0n,stateOverride:[{address:account,balance:10n**24n}]});
  const gasLimit=(gas*120n+99n)/100n,maxFeePerGas=gasPrice*2n;
  budget+=gasLimit*maxFeePerGas;
  report.transactions.push({symbol,to:p.pool,data,value:'0',currentCapacity:slot[3],currentCapacityNext:slot[4],estimatedGas:String(gas),proposedGasLimit:String(gasLimit),proposedMaxFeePerGas:String(maxFeePerGas),estimatedCostEth:formatEther(gas*gasPrice),budgetEth:formatEther(gasLimit*maxFeePerGas)});
 }
 report.totalBudgetEth=formatEther(budget);report.balanceSufficientAtCheck=balance>=budget;
 fs.writeFileSync('deployments/prepared-price-history.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error('Preparation incomplete:',e.name,String(e.shortMessage||'').replace(/https?:\/\/\S+/g,'<redacted>'));process.exitCode=1;});
