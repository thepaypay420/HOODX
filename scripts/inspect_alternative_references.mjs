import fs from 'node:fs';
import {createPublicClient,http,parseAbi,keccak256} from 'viem';
// Candidate discovery only; never authorizes a pool or sends a transaction.
async function main(){
 if(!process.env.ROBINHOOD_RPC_URL)throw Error('Missing configuration');
 const c=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL,{timeout:20000,retryCount:1})});
 if(await c.getChainId()!==4663)throw Error('Wrong chain');
 const block=await c.getBlock();
 const abi=parseAbi(['function factory() view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)','function observe(uint32[]) view returns(int56[],uint160[])','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function observations(uint256) view returns(uint32,int56,uint160,bool)','function getPool(address,address,uint24) view returns(address)']);
 const discovery=JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json'));
 const clAbi=parseAbi(['function tickSpacings() view returns(int24[])','function tickSpacing() view returns(int24)','function getPool(address,address,int24) view returns(address)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,bool)','function isPool(address) view returns(bool)','function poolImplementation() view returns(address)']);
 if(process.argv.includes('--discover')){
  const factory='0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3';
  const spacings=await c.readContract({address:factory,abi:clAbi,functionName:'tickSpacings',blockNumber:block.number});
  if(spacings.length>32)throw Error('Discovery bound exceeded');
  for(const a of discovery.assets.filter(a=>['NET','Aria','HARMONIC','PROMETHEUS','QUOTRON'].includes(a.symbol))){
   const quotes=[...new Set(['0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x5fc5360d0400a0fd4f2af552add042d716f1d168',...a.pools.map(p=>p.quote.toLowerCase()).filter(q=>!/^0x0{40}$/.test(q))])];
   for(const q of quotes)for(const spacing of spacings){
    const pool=await c.readContract({address:factory,abi:clAbi,functionName:'getPool',args:[a.token,q,spacing],blockNumber:block.number});
    if(!/^0x0{40}$/.test(pool)&&!a.pools.some(p=>p.id.toLowerCase()===pool.toLowerCase()))a.pools.push({id:pool,version:'v3'});
   }
  }
 }
 const report={block:block.number,timestamp:block.timestamp,approved:false,pools:[]};
 for(const a of discovery.assets.filter(a=>['NET','Aria','HARMONIC','PROMETHEUS','QUOTRON'].includes(a.symbol)))for(const p of a.pools.filter(p=>p.version==='v3')){
  const row={symbol:a.symbol,token:a.token,pool:p.id};
  const runtime=await c.getBytecode({address:p.id,blockNumber:block.number});
  row.runtimeHash=keccak256(runtime);row.runtimeBytes=(runtime.length-2)/2;
  if(row.runtimeBytes===45)row.cloneRuntime=runtime;
  const read=(address,functionName,args=[])=>c.readContract({address,abi,functionName,args,blockNumber:block.number});
  for(const fn of ['factory','token0','token1','fee','liquidity','slot0'])try{row[fn]=await read(p.id,fn);}catch{row[fn]=null;}
  const clRead=(address,functionName,args=[])=>c.readContract({address,abi:clAbi,functionName,args,blockNumber:block.number});
  try{row.tickSpacing=await clRead(p.id,'tickSpacing');}catch{}
  if(!row.slot0)try{row.slot0=await clRead(p.id,'slot0');row.slot0Layout='concentrated-liquidity-six-fields';}catch{}
  try{row.history=await read(p.id,'observe',[[1800,0]]);}catch{row.history=null;}
  if(row.slot0)try{row.latestObservation=await read(p.id,'observations',[BigInt(row.slot0[2])]);}catch{}
  if(row.factory&&row.token0&&row.token1&&row.fee!==null)try{row.factoryPool=await read(row.factory,'getPool',[row.token0,row.token1,row.fee]);}catch{}
  if(row.factory&&row.token0&&row.token1&&row.tickSpacing!==undefined)try{row.spacingFactoryPool=await clRead(row.factory,'getPool',[row.token0,row.token1,row.tickSpacing]);row.isPool=await clRead(row.factory,'isPool',[p.id]);row.poolImplementation=await clRead(row.factory,'poolImplementation');}catch{}
  report.pools.push(row);
 }
 const json=JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2);
 fs.writeFileSync('deployments/alternative-reference-candidates.json',json+'\n');
 for(const p of report.pools)console.log(JSON.stringify({symbol:p.symbol,pool:p.pool,factory:p.factory,fee:p.fee,liquidity:String(p.liquidity),history:!!p.history,age:p.latestObservation?String(block.timestamp-BigInt(p.latestObservation[0])):null,factoryMatches:p.factoryPool?.toLowerCase()===p.pool.toLowerCase()||p.spacingFactoryPool?.toLowerCase()===p.pool.toLowerCase()}));
}
main().catch(()=>{console.error('Reference inspection incomplete; connection details suppressed');process.exitCode=1;});
