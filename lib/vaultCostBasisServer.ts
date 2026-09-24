import { parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";
import snapshot from "@/deployments/vault-cost-basis-4663.json";
import { applyReceiptTransfers, emptyBasis, type BasisPosition, type VaultTransfer } from "@/lib/vaultCostBasis";

const abi=parseAbi(["function constituents() view returns(address[])","function weth() view returns(address)","function balanceOf(address) view returns(uint256)"]);
const transferEvent=parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
type SavedAsset={token:Address;symbol:string;decimals:number;units:string;costWei:string;realizedPnlWei:string;acquiredUnits:string;acquiredCostWei:string;disposedUnits:string;proceedsWei:string;complete:boolean};
type SavedVault={slug:string;vault:Address;weth:Address;indexedBlock:string;transactionCount:number;assets:SavedAsset[]};

function restore(asset:SavedAsset):BasisPosition{return {token:asset.token,units:BigInt(asset.units),costWei:BigInt(asset.costWei),realizedPnlWei:BigInt(asset.realizedPnlWei),acquiredUnits:BigInt(asset.acquiredUnits),acquiredCostWei:BigInt(asset.acquiredCostWei),disposedUnits:BigInt(asset.disposedUnits),proceedsWei:BigInt(asset.proceedsWei),complete:asset.complete};}

export async function readVaultCostBasis(client:PublicClient,vault:Address){
  const saved=Object.values(snapshot.vaults).find(v=>v.vault.toLowerCase()===vault.toLowerCase()) as SavedVault|undefined;
  if(!saved)throw new Error("Unknown vault");
  const end=await client.getBlockNumber(), from=BigInt(saved.indexedBlock)+1n;
  const current=await client.readContract({address:vault,abi,functionName:"constituents",blockNumber:end});
  const tokens=Array.from(new Set([...saved.assets.map(a=>a.token.toLowerCase()),...current.map(a=>a.toLowerCase())])) as Address[];
  const addresses=[...tokens,saved.weth] as Address[];
  const positions=new Map<string,BasisPosition>(saved.assets.map(a=>[a.token.toLowerCase(),restore(a)]));
  for(const token of tokens)if(!positions.has(token))positions.set(token,emptyBasis(token));
  const logs:VaultTransfer[]=[]; const seen=new Set<string>();
  for(let start=from;start<=end;start+=10000n){const stop=start+9999n>end?end:start+9999n;
    const parts=await Promise.all([
      client.getLogs({address:addresses,event:transferEvent,args:{from:vault},fromBlock:start,toBlock:stop}),
      client.getLogs({address:addresses,event:transferEvent,args:{to:vault},fromBlock:start,toBlock:stop}),
    ]);
    for(const log of parts.flat()){const key=`${log.transactionHash}:${log.logIndex}`;if(seen.has(key))continue;seen.add(key);logs.push({token:log.address,from:log.args.from!,to:log.args.to!,amount:log.args.value!,blockNumber:log.blockNumber,transactionHash:log.transactionHash,logIndex:log.logIndex});}
  }
  const grouped=new Map<string,VaultTransfer[]>();for(const log of logs){const list=grouped.get(log.transactionHash)||[];list.push(log);grouped.set(log.transactionHash,list);}
  for(const transfers of [...grouped.values()].sort((a,b)=>Number(a[0].blockNumber-b[0].blockNumber)))applyReceiptTransfers(positions,transfers,vault,saved.weth);
  const assets=await Promise.all(tokens.map(async token=>{const position=positions.get(token)!;const balance=await client.readContract({address:token,abi,functionName:"balanceOf",args:[vault],blockNumber:end});return {...position,currentBalance:balance,reconciled:position.complete&&position.units===balance};}));
  return {chainId:4663,vault,indexedBlock:end,transactionCount:grouped.size+saved.transactionCount,verified:assets.every(a=>a.reconciled),assets};
}
