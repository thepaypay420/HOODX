/** Read-only pinned-block diagnostics. Historical candidates are NOT oracle approvals. */
import fs from 'node:fs';
import {createPublicClient,http,parseAbi} from 'viem';
const W='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const ABI=parseAbi([
 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)',
 'function observations(uint256) view returns(uint32,int56,uint160,bool)',
 'function token0() view returns(address)','function token1() view returns(address)',
 'function liquidity() view returns(uint128)',
 'function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)',
 'function getReserves() view returns(uint112,uint112,uint32)',
 'function price0CumulativeLast() view returns(uint256)','function price1CumulativeLast() view returns(uint256)'
]);
async function main(){
 const endpoint=process.env.ROBINHOOD_RPC_URL;if(!endpoint)throw Error('config');
 const c=createPublicClient({transport:http(endpoint,{retryCount:1,timeout:20000})});
 if(await c.getChainId()!==4663)throw Error('chain');
 const latest=await c.getBlock();const block=latest.number;
 const d=JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json'));
 const report={chainId:4663,block:String(block),timestamp:String(latest.timestamp),releaseApproved:false,v3:[],v2:[],limitations:['V2 endpoint observations do not prove historical liquidity depth.','Spot comparisons diagnose disagreement; spot is not a minting oracle.','Observation freshness can reflect liquidity operations, not necessarily trading.']};
 const read=async(address,functionName,args=[],at=block)=>{await new Promise(r=>setTimeout(r,100));return c.readContract({address,abi:ABI,functionName,args,blockNumber:at});};
 const rate=(sqrt,base,t0)=>{const square=sqrt*sqrt;return base.toLowerCase()===t0.toLowerCase()?square*10n**18n/(1n<<192n):(1n<<192n)*10n**18n/square;};
 for(const symbol of ['PRISM','ZEAL','QUOTRON']){
  const asset=d.assets.find(a=>a.symbol===symbol);
  for(const ref of asset.references.filter(r=>r.quote.toLowerCase()===W&&BigInt(r.liquidity)>0n))try{
   const [slot,t0,liquidity]=await Promise.all([read(ref.pool,'slot0'),read(ref.pool,'token0'),read(ref.pool,'liquidity')]);
   const observation=await read(ref.pool,'observations',[BigInt(slot[2])]);
   report.v3.push({symbol,token:asset.token,pool:ref.pool,liquidity:String(liquidity),cardinality:slot[3],cardinalityNext:slot[4],observationAgeSeconds:String(latest.timestamp-BigInt(observation[0])),ethPerRawTokenX18:String(rate(slot[0],asset.token,t0))});
  }catch{report.v3.push({symbol,pool:ref.pool,error:'Read incomplete'});}
 }
 const q=d.assets.find(a=>a.symbol==='QUOTRON');const qp=q.pools.find(p=>p.version==='v4'&&p.key?.hooks.toLowerCase()==='0x62e200cc8e4d95cf622f40dd70f407c883ecb0cc');
 const qslot=await read('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b','getSlot0',[qp.id]);
 report.quotronV4={pool:qp.id,ethPerRawTokenX18:String(rate(qslot[0],q.token,qp.key.currency0)),feeFlag:qp.key.fee};
 const target=latest.timestamp-1800n;let low=block>50000n?block-50000n:0n,high=block;
 if((await c.getBlock({blockNumber:low})).timestamp>target)throw Error('History search range insufficient');
 while(high-low>1n){const mid=(low+high)/2n;if((await c.getBlock({blockNumber:mid})).timestamp<=target)low=mid;else high=mid;}
 const start=await c.getBlock({blockNumber:low});
 const snapshot=async(pair,token,at,time)=>{
  const [r,t0,p0,p1]=await Promise.all([read(pair,'getReserves',[],at),read(pair,'token0',[],at),read(pair,'price0CumulativeLast',[],at),read(pair,'price1CumulativeLast',[],at)]);
  if(r[0]===0n||r[1]===0n)throw Error('Empty reserves');
  const elapsed=(time-BigInt(r[2])+(1n<<32n))%(1n<<32n);
  const forward=t0.toLowerCase()===token.toLowerCase();const rin=forward?r[0]:r[1],rout=forward?r[1]:r[0];
  const cumulative=((forward?p0:p1)+((rout<<112n)/rin)*elapsed)%(1n<<256n);
  return {cumulative,rin,rout,lastReserveAge:elapsed};
 };
 for(const symbol of ['PRISM','NET']){
  const asset=d.assets.find(a=>a.symbol===symbol);const pool=asset.pools.filter(p=>p.version==='v2').sort((a,b)=>(b.displayLiquidityUsd||0)-(a.displayLiquidityUsd||0))[0];
  try{
   const before=await snapshot(pool.id,asset.token,low,start.timestamp);const after=await snapshot(pool.id,asset.token,block,latest.timestamp);
   const elapsed=latest.timestamp-start.timestamp;const delta=(after.cumulative-before.cumulative+(1n<<256n))%(1n<<256n);
   report.v2.push({symbol,token:asset.token,pair:pool.id,quote:pool.quote,startBlock:String(low),windowSeconds:String(elapsed),quotePerRawTokenX18:String(delta*10n**18n/elapsed/(1n<<112n)),spotQuotePerRawTokenX18:String(after.rout*10n**18n/after.rin),startTokenReserve:String(before.rin),endTokenReserve:String(after.rin),startQuoteReserve:String(before.rout),endQuoteReserve:String(after.rout),lastReserveAgeSeconds:String(after.lastReserveAge)});
  }catch{report.v2.push({symbol,pair:pool.id,error:'Historical read incomplete'});}
 }
 fs.writeFileSync('deployments/successor-price-source-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Price audit incomplete; endpoint details suppressed.');process.exitCode=1;});
