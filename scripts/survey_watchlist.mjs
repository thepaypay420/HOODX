/** Read-only compatibility discovery. Results are candidates, never approval to trade. */
import fs from 'node:fs';
import {createPublicClient,http,parseAbi,encodeAbiParameters,parseAbiParameters,keccak256} from 'viem';
const universe=JSON.parse(fs.readFileSync('universe.json')).tokens;
const names=['PONS','AI','CASHCAT','Index','MEME','STONKBROKER','PRISM','HOOKR','DELTA','SHROOM','BOW','UP','QUOTRON','NET','ZEAL','musebook','Aria','HARMONIC','QUOTIENT','PROMETHEUS','STELX'];
const extra={PRISM:'0x20024e485c0b22b42855589700721b28320a7777',ZEAL:'0x9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc',Aria:'0xa74a94c15b95f8d5f3abdd2db00f6c7384037b55',musebook:'0x91a2dae9699f0b82540b5886b0d8759c22820ba3',STELX:'0x7a8cda6a1cab3e5146cd13cb623a3bb284fb4ad1'};
const deployed=JSON.parse(fs.readFileSync('deployments/robinhood-4663-v2.json')).production;
const integrations=JSON.parse(fs.readFileSync('deployed.json'));
const client=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',{retryCount:1,timeout:20000})});
process.on('unhandledRejection',()=>{console.error('Discovery stopped: remote data unavailable. No approval or transaction was produced.');process.exitCode=1;});
const chain=await client.getChainId();if(chain!==4663)throw Error('Wrong chain');
const previous=process.argv.includes('--resume')?JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json')):null;
const block=previous?BigInt(previous.block):await client.getBlockNumber(),zero='0x0000000000000000000000000000000000000000';
const abi=parseAbi(['function v3Factory() view returns(address)','function getPool(address,address,uint24) view returns(address)','function liquidity() view returns(uint128)','function observe(uint32[]) view returns(int56[],uint160[])','function poolKeys(bytes25) view returns(address,address,uint24,int24,address)','function getLiquidity(bytes32) view returns(uint128)','function compatibleHook(address) view returns(bool)','function symbol() view returns(string)','function decimals() view returns(uint8)','function owner() view returns(address)']);
const read=async(address,functionName,args=[])=>{await new Promise(r=>setTimeout(r,180));return client.readContract({address,abi,functionName,args,blockNumber:block});};
const factory=await read(deployed.executor,'v3Factory');
const report={chainId:chain,block:String(block),sampledAt:new Date().toISOString(),policy:deployed.policy,policyOwner:await read(deployed.policy,'owner'),limitations:['Discovery only. No protected round-trip or vault simulation is certified.','DEX liquidity is display data, not an economic safety bound.','V3 history availability alone does not certify price quality or liquidity retention.','V4 pool discovery is limited to indexed pools with recoverable pool keys.'],assets:[]};
if(previous)report.assets=previous.assets.filter(r=>!r.error);
async function survey(symbol){
 const token=extra[symbol]||universe.find(t=>t.symbol===symbol)?.token;if(!token)throw Error('Missing identity '+symbol);
 const row={symbol,token,identitySource:extra[symbol]?'prior user address or exact-name public listing; curator confirmation required':'existing universe',references:[],pools:[]};
 try{
  row.onchainSymbol=await read(token,'symbol');row.decimals=await read(token,'decimals');
  const response=await fetch('https://api.dexscreener.com/token-pairs/v1/robinhood/'+token);if(!response.ok)throw Error('Listing unavailable');
  const listings=await response.json();const pairs=listings.filter(p=>p.chainId==='robinhood'&&p.baseToken.address.toLowerCase()===token.toLowerCase());
  const quotes=new Set([integrations.weth.toLowerCase(),'0x5fc5360d0400a0fd4f2af552add042d716f1d168',...pairs.map(p=>p.quoteToken.address.toLowerCase()).filter(q=>q!==zero)]);
  for(const quote of quotes)for(const fee of [100,500,3000,10000]){
   const pool=await read(factory,'getPool',[token,quote,fee]);if(pool.toLowerCase()===zero)continue;
   const reference={pool,quote,fee,liquidity:String(await read(pool,'liquidity')),history1800:false};
   try{const [,a]=await read(pool,'observe',[[1800,0]]);reference.history1800=true;const delta=(a[1]-a[0]+(1n<<160n))%(1n<<160n);reference.harmonicLiquidity=delta?String((1800n<<128n)/delta):'0';}catch{reference.historyError='Observation unavailable';}
   row.references.push(reference);
  }
  for(const pair of pairs){
   const pool={id:pair.pairAddress,version:pair.labels?.[0]||'unknown',quote:pair.quoteToken.address,displayLiquidityUsd:pair.liquidity?.usd??null};
   if(pool.version==='v4')try{
    const values=await read(integrations.v4Posm,'poolKeys',[pool.id.slice(0,52)]);
    const key={currency0:values[0],currency1:values[1],fee:values[2],tickSpacing:values[3],hooks:values[4]};pool.key=key;
    pool.identityMatches=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),values)).toLowerCase()===pool.id.toLowerCase();
    pool.activeLiquidity=String(await read(integrations.v4StateView,'getLiquidity',[pool.id]));pool.hookAllowed=key.hooks.toLowerCase()===zero||await read(deployed.executor,'compatibleHook',[key.hooks]);
   }catch{pool.discoveryError='Pool key or liquidity unavailable';}
   row.pools.push(pool);
  }
  row.v3HistoryCandidate=row.references.some(r=>BigInt(r.liquidity)>0n&&r.history1800&&BigInt(r.harmonicLiquidity)>0n);
  row.v4ExecutionCandidate=row.pools.some(p=>p.version==='v4'&&p.identityMatches&&p.hookAllowed&&BigInt(p.activeLiquidity)>0n);
 }catch(e){row.error='Incomplete discovery; retry before drawing conclusions';row.errorType=e.name;}
 report.assets.push(row);report.assets.sort((a,b)=>names.indexOf(a.symbol)-names.indexOf(b.symbol));fs.writeFileSync('deployments/696x-compatibility-discovery.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({symbol,v3HistoryCandidate:row.v3HistoryCandidate,v4ExecutionCandidate:row.v4ExecutionCandidate,pools:row.pools.length,error:row.error}));
}


const pending=names.filter(s=>!report.assets.some(r=>r.symbol===s));
await Promise.all(Array.from({length:3},async()=>{while(pending.length){const symbol=pending.shift();await survey(symbol);}}));
