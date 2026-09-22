import fs from 'node:fs';
import {createPublicClient,http,parseAbi} from 'viem';
async function main(){
 if(!process.env.ROBINHOOD_RPC_URL)throw Error('Missing configuration');
 const c=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL,{timeout:20000,retryCount:1})});
 if(await c.getChainId()!==4663)throw Error('Wrong chain');
 const b=await c.getBlock();const factory='0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';
 const abi=parseAbi(['function getPair(address,address) view returns(address)','function getReserves() view returns(uint112,uint112,uint32)','function price0CumulativeLast() view returns(uint256)','function price1CumulativeLast() view returns(uint256)','function token0() view returns(address)','function token1() view returns(address)','function factory() view returns(address)']);
 const read=(address,functionName,args=[])=>c.readContract({address,abi,functionName,args,blockNumber:b.number});
 const d=JSON.parse(fs.readFileSync('deployments/696x-compatibility-discovery.json'));
 const report={block:b.number,timestamp:b.timestamp,approved:false,factory,assets:[]};
 for(const a of d.assets.filter(a=>['NET','Aria','HARMONIC','PROMETHEUS','QUOTRON'].includes(a.symbol))){
  const row={symbol:a.symbol,pairs:[]};
  const quotes=[...new Set(['0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x5fc5360d0400a0fd4f2af552add042d716f1d168',...a.pools.map(p=>p.quote.toLowerCase()).filter(q=>!/^0x0{40}$/.test(q))])];
  for(const quote of quotes){const pair=await read(factory,'getPair',[a.token,quote]);if(/^0x0{40}$/.test(pair))continue;
   const p={pair,quote};for(const fn of ['token0','token1','factory','getReserves','price0CumulativeLast','price1CumulativeLast'])try{p[fn]=await read(pair,fn);}catch{p[fn]=null;}
   row.pairs.push(p);
  }
  report.assets.push(row);console.log(JSON.stringify({symbol:a.symbol,pairs:row.pairs.length,nonempty:row.pairs.filter(p=>p.getReserves?.[0]>0n&&p.getReserves?.[1]>0n).length}));
 }
 fs.writeFileSync('deployments/v2-reference-candidates.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
}
main().catch(()=>{console.error('V2 inspection incomplete; connection details suppressed.');process.exitCode=1;});
