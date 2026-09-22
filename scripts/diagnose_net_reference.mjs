import fs from 'node:fs';
import {createPublicClient,http,parseAbi} from 'viem';
async function main(){
 if(!process.env.ROBINHOOD_RPC_URL)throw Error('Configuration missing');
 const c=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL,{timeout:20000,retryCount:1})});
 if(await c.getChainId()!==4663)throw Error('Wrong chain');
 const at=process.argv[2];if(at&&!/^[1-9][0-9]*$/.test(at))throw Error('Invalid block');
 const block=await c.getBlock(at?{blockNumber:BigInt(at)}:{});
 const rows=[['NET','0x99e70a5b06215e5d2f3bec773b4f59c008fc1673',2118471187028n,true],['USDG/ETH','0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',2631289198634062971n,false]];
 const report={block:block.number,timestamp:block.timestamp,approved:false,references:[]};
 for(const [name,pool,minimum,cl] of rows){
  const abi=parseAbi(['function liquidity() view returns(uint128)','function observe(uint32[]) view returns(int56[],uint160[])','function observations(uint256) view returns(uint32,int56,uint160,bool)',cl?'function slot0() view returns(uint160,int24,uint16,uint16,uint16,bool)':'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)']);
  const read=(functionName,args=[])=>c.readContract({address:pool,abi,functionName,args,blockNumber:block.number});
  const live=await read('liquidity'),slot=await read('slot0'),obs=await read('observations',[BigInt(slot[2])]);
  const [,acc]=await read('observe',[[1800,0]]);const delta=(acc[1]-acc[0]+(1n<<160n))%(1n<<160n);const harmonic=delta?(1800n<<128n)/delta:0n;
  report.references.push({name,pool,minimum,live,harmonic,age:block.timestamp-BigInt(obs[0]),livePass:live>=minimum,historyDepthPass:harmonic>=minimum,fresh:obs[3]&&block.timestamp-BigInt(obs[0])<=1800n});
 }
 const json=JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2);fs.writeFileSync('deployments/net-reference-diagnosis.json',json+'\n');console.log(json);
}
main().catch(()=>{console.error('Reference diagnosis incomplete; connection details suppressed.');process.exitCode=1;});
