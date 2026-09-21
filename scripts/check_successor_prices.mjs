/** Read-only, bounded recheck of missing historical references. Never approves a price source. */
import fs from 'node:fs';
import {createPublicClient,http,parseAbi} from 'viem';
async function main(){
 const endpoint=process.env.ROBINHOOD_RPC_URL;if(!endpoint)throw Error('configuration');
 const client=createPublicClient({transport:http(endpoint,{retryCount:1,timeout:20000})});
 const chainId=await client.getChainId();if(chainId!==4663)throw Error('chain');
 const block=await client.getBlockNumber();
 const d=JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json'));
 const names=['PRISM','NET','ZEAL','Aria','HARMONIC','PROMETHEUS'];
 const abi=parseAbi(['function getPool(address,address,uint24) view returns(address)','function liquidity() view returns(uint128)','function observe(uint32[]) view returns(int56[],uint160[])']);
 const read=async(address,functionName,args=[])=>{await new Promise(r=>setTimeout(r,150));return client.readContract({address,abi,functionName,args,blockNumber:block});};
 const factory='0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
 const report={chainId,block:String(block),checkedAt:new Date().toISOString(),releaseApproved:false,limitations:['History candidates still require economic depth and price-agreement validation.','This checks known quote currencies and canonical V3 fee tiers, not every possible market.'],assets:[]};
 for(const symbol of names){
  const asset=d.assets.find(a=>a.symbol===symbol);const row={symbol,token:asset.token,references:[],errors:0};
  const quotes=[...new Set(['0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x5fc5360d0400a0fd4f2af552add042d716f1d168',...asset.references.map(r=>r.quote.toLowerCase())])];
  for(const quote of quotes)for(const fee of [100,500,3000,10000])try{
   const pool=await read(factory,'getPool',[asset.token,quote,fee]);if(/^0x0{40}$/i.test(pool))continue;
   const liquidity=await read(pool,'liquidity');let history=false,harmonic=0n;
   try{const [,acc]=await read(pool,'observe',[[1800,0]]);const delta=(acc[1]-acc[0]+(1n<<160n))%(1n<<160n);if(delta){harmonic=(1800n<<128n)/delta;history=true;}}catch{}
   row.references.push({pool,quote,fee,liquidity:String(liquidity),history1800:history,harmonicLiquidity:String(harmonic)});
  }catch{row.errors++;}
  row.historyCandidate=row.references.some(r=>r.history1800&&BigInt(r.liquidity)>0n&&BigInt(r.harmonicLiquidity)>0n);
  report.assets.push(row);console.log(JSON.stringify({symbol,historyCandidate:row.historyCandidate,readErrors:row.errors}));
 }
 fs.writeFileSync('deployments/successor-pricing-status.json',JSON.stringify(report,null,2)+'\n');
 if(report.assets.some(r=>r.errors))process.exitCode=1;
}
main().catch(()=>{console.error('Price recheck incomplete; connection details suppressed. No approval produced.');process.exitCode=1;});
