import { parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";
import snapshot from "@/deployments/vault-cost-basis-4663.json";
import { applyReceiptTransfers, emptyBasis, type BasisPosition, type VaultTransfer } from "@/lib/vaultCostBasis";

const abi=parseAbi(["function constituents() view returns(address[])","function weth() view returns(address)","function balanceOf(address) view returns(uint256)"]);
const transferEvent=parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const MAX_INDEXER_PAGES=12;
const MAX_RPC_CHUNKS=48;
type SavedAsset={token:Address;symbol:string;decimals:number;units:string;costWei:string;realizedPnlWei:string;acquiredUnits:string;acquiredCostWei:string;disposedUnits:string;proceedsWei:string;complete:boolean};
type SavedVault={slug:string;vault:Address;weth:Address;indexedBlock:string;transactionCount:number;assets:SavedAsset[]};
type BlockscoutTransfer={block_number:number;transaction_hash:string;log_index:number;from:{hash:string};to:{hash:string};token:{address_hash:string};total:{value:string}};

function restore(asset:SavedAsset):BasisPosition{return {token:asset.token,units:BigInt(asset.units),costWei:BigInt(asset.costWei),realizedPnlWei:BigInt(asset.realizedPnlWei),acquiredUnits:BigInt(asset.acquiredUnits),acquiredCostWei:BigInt(asset.acquiredCostWei),disposedUnits:BigInt(asset.disposedUnits),proceedsWei:BigInt(asset.proceedsWei),complete:asset.complete};}

async function indexedTransfers(vault:Address,fromBlock:bigint,tracked:Set<string>):Promise<VaultTransfer[]> {
  const logs:VaultTransfer[]=[];
  let cursor:Record<string,string|number|null>|undefined;
  let complete=false;
  for(let page=0;page<MAX_INDEXER_PAGES;page++){
    const url=new URL(`https://robinhoodchain.blockscout.com/api/v2/addresses/${vault}/token-transfers`);
    url.searchParams.set("type","ERC-20");
    if(cursor)for(const [key,value] of Object.entries(cursor))if(value!==null)url.searchParams.set(key,String(value));
    const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error("Indexed transfer history unavailable");
    const body=await response.json() as {items:BlockscoutTransfer[];next_page_params?:Record<string,string|number|null>|null};
    if(!Array.isArray(body.items)||body.items.length>1000)throw new Error("Indexer page budget exceeded");
    let reachedSnapshot=false;
    for(const item of body.items){
      const blockNumber=BigInt(item.block_number);
      if(blockNumber<=fromBlock){reachedSnapshot=true;continue;}
      if(tracked.has(item.token.address_hash.toLowerCase()))logs.push({token:item.token.address_hash as Address,from:item.from.hash as Address,to:item.to.hash as Address,amount:BigInt(item.total.value),blockNumber,transactionHash:item.transaction_hash as `0x${string}`,logIndex:item.log_index});
    }
    if(reachedSnapshot||!body.next_page_params){complete=true;break;}
    cursor=body.next_page_params;
  }
  if(!complete)throw new Error("Indexer history budget exceeded");
  return logs;
}

async function rpcTransfers(client:PublicClient,vault:Address,addresses:Address[],from:bigint,end:bigint):Promise<VaultTransfer[]> {
  const logs:VaultTransfer[]=[];const seen=new Set<string>();
  if(from>end)return logs;
  // The chain RPC answers address- and topic-filtered ranges in one call; chunk only if it refuses the range.
  const ranges:Array<[bigint,bigint]>=[];
  const whole=await Promise.all([
    client.getLogs({address:addresses,event:transferEvent,args:{from:vault},fromBlock:from,toBlock:end}),
    client.getLogs({address:addresses,event:transferEvent,args:{to:vault},fromBlock:from,toBlock:end}),
  ]).catch(()=>undefined);
  if(!whole){
    if(Number((end-from)/10000n)+1>MAX_RPC_CHUNKS)throw new Error("RPC history budget exceeded");
    for(let start=from;start<=end;start+=10000n)ranges.push([start,start+9999n>end?end:start+9999n]);
  }
  for(const [start,stop] of whole?[[from,end] as [bigint,bigint]]:ranges){
    const parts=whole??await Promise.all([
      client.getLogs({address:addresses,event:transferEvent,args:{from:vault},fromBlock:start,toBlock:stop}),
      client.getLogs({address:addresses,event:transferEvent,args:{to:vault},fromBlock:start,toBlock:stop}),
    ]);
    for(const log of parts.flat()){const key=`${log.transactionHash}:${log.logIndex}`;if(seen.has(key))continue;seen.add(key);logs.push({token:log.address,from:log.args.from!,to:log.args.to!,amount:log.args.value!,blockNumber:log.blockNumber,transactionHash:log.transactionHash,logIndex:log.logIndex});}
  }
  return logs;
}

const createdEvent=parseAbiItem("event AtomicCreated(address indexed vault,address indexed controller,string slug,address curator,address creator)");
export type VaultOrigin={factory:Address;startBlock:bigint};

/** A vault with no saved snapshot (every atomic-factory vault) is indexed from the block its factory created it in.
 *  The creation event is used because the public RPC does not serve historical state. */
async function unsavedVault(client:PublicClient,vault:Address,origin:VaultOrigin):Promise<SavedVault>{
  const [created]=await client.getLogs({address:origin.factory,event:createdEvent,args:{vault},fromBlock:origin.startBlock,toBlock:"latest"});
  if(!created||created.blockNumber===null)throw new Error("Unknown vault");
  const weth=await client.readContract({address:vault,abi,functionName:"weth"});
  return {slug:"",vault,weth,indexedBlock:String(created.blockNumber-1n),transactionCount:0,assets:[]};
}

export async function readVaultCostBasis(client:PublicClient,vault:Address,origin?:VaultOrigin){
  const saved=(Object.values(snapshot.vaults).find(v=>v.vault.toLowerCase()===vault.toLowerCase()) as SavedVault|undefined)
    ??(origin===undefined?undefined:await unsavedVault(client,vault,origin));
  if(!saved)throw new Error("Unknown vault");
  const end=await client.getBlockNumber(), from=BigInt(saved.indexedBlock)+1n;
  const current=await client.readContract({address:vault,abi,functionName:"constituents",blockNumber:end});
  const tokens=Array.from(new Set([...saved.assets.map(a=>a.token.toLowerCase()),...current.map(a=>a.toLowerCase())])) as Address[];
  const addresses=[...tokens,saved.weth] as Address[];
  const positions=new Map<string,BasisPosition>(saved.assets.map(a=>[a.token.toLowerCase(),restore(a)]));
  for(const token of tokens)if(!positions.has(token))positions.set(token,emptyBasis(token));
  const balances=await Promise.all(tokens.map(token=>client.readContract({address:token,abi,functionName:"balanceOf",args:[vault],blockNumber:end})));
  const unchanged=tokens.every((token,index)=>{const position=positions.get(token)!;return position.complete&&position.units===balances[index];});
  if(unchanged){
    const assets=tokens.map((token,index)=>({...positions.get(token)!,currentBalance:balances[index],reconciled:true}));
    return {chainId:4663,vault,indexedBlock:end,transactionCount:saved.transactionCount,verified:true,assets};
  }
  const tracked=new Set(addresses.map(address=>address.toLowerCase()));
  const logs=await indexedTransfers(vault,BigInt(saved.indexedBlock),tracked).catch(()=>rpcTransfers(client,vault,addresses,from,end));
  const grouped=new Map<string,VaultTransfer[]>();for(const log of logs){const list=grouped.get(log.transactionHash)||[];list.push(log);grouped.set(log.transactionHash,list);}
  for(const transfers of [...grouped.values()].sort((a,b)=>Number(a[0].blockNumber-b[0].blockNumber)))applyReceiptTransfers(positions,transfers.sort((a,b)=>a.logIndex-b.logIndex),vault,saved.weth);
  const assets=tokens.map((token,index)=>{const position=positions.get(token)!;const balance=balances[index];return {...position,currentBalance:balance,reconciled:position.complete&&position.units===balance};});
  return {chainId:4663,vault,indexedBlock:end,transactionCount:grouped.size+saved.transactionCount,verified:assets.every(a=>a.reconciled),assets};
}
