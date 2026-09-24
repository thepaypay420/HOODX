import fs from "node:fs";
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

const rpc=process.env.ROBINHOOD_RPC_URL?.trim();
if(!rpc)throw new Error("ROBINHOOD_RPC_URL is required");
const client=createPublicClient({transport:http(rpc,{timeout:30000,retryCount:2})});
if(await client.getChainId()!==4663)throw new Error("Wrong network");

const config=JSON.parse(fs.readFileSync(new URL("../deployments/robinhood-4663-v2.json",import.meta.url),"utf8"));
const vaults={"696x":config.production.vault696x,"faangx":config.production.vaultFaangx};
const abi=parseAbi(["function constituents() view returns(address[])","function weth() view returns(address)","function balanceOf(address) view returns(uint256)","function symbol() view returns(string)","function decimals() view returns(uint8)"]);
const transferEvent=parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const startBlock=67761602n;
const indexedBlock=await client.getBlockNumber();

function blank(token){return {token,units:0n,costWei:0n,realizedPnlWei:0n,acquiredUnits:0n,acquiredCostWei:0n,disposedUnits:0n,proceedsWei:0n,complete:true};}
function acquire(p,units,cost){p.units+=units;p.costWei+=cost;p.acquiredUnits+=units;p.acquiredCostWei+=cost;}
function dispose(p,units,proceeds){if(units>p.units){p.units=0n;p.costWei=0n;p.disposedUnits+=units;p.complete=false;return;}const removed=p.units?p.costWei*units/p.units:0n;p.units-=units;p.costWei-=removed;p.disposedUnits+=units;if(proceeds!==undefined){p.proceedsWei+=proceeds;p.realizedPnlWei+=proceeds-removed;}}

async function scan(slug,vault){
  const [tokens,weth]=await Promise.all([client.readContract({address:vault,abi,functionName:"constituents",blockNumber:indexedBlock}),client.readContract({address:vault,abi,functionName:"weth",blockNumber:indexedBlock})]);
  const addresses=[...tokens,weth];
  const seen=new Set(), logs=[];
  for(let from=startBlock;from<=indexedBlock;from+=10000n){
    const to=from+9999n>indexedBlock?indexedBlock:from+9999n;
    const batches=await Promise.all([
      client.getLogs({address:addresses,event:transferEvent,args:{from:vault},fromBlock:from,toBlock:to}),
      client.getLogs({address:addresses,event:transferEvent,args:{to:vault},fromBlock:from,toBlock:to}),
    ]);
    for(const log of batches.flat()){
      const key=`${log.transactionHash}:${log.logIndex}`;if(seen.has(key))continue;seen.add(key);
      logs.push({token:log.address,from:log.args.from,to:log.args.to,amount:log.args.value,blockNumber:log.blockNumber,transactionHash:log.transactionHash,transactionIndex:log.transactionIndex,logIndex:log.logIndex});
    }
  }
  logs.sort((a,b)=>Number(a.blockNumber-b.blockNumber)||a.transactionIndex-b.transactionIndex||a.logIndex-b.logIndex);
  const positions=new Map(tokens.map(t=>[t.toLowerCase(),blank(t)]));
  const groups=new Map();for(const log of logs){const list=groups.get(log.transactionHash)||[];list.push(log);groups.set(log.transactionHash,list);}
  for(const transfers of groups.values()){
    let pendingBuy, pendingSell;
    const flush=()=>{if(!pendingSell)return;dispose(positions.get(pendingSell.token.toLowerCase())??blank(pendingSell.token),pendingSell.units);pendingSell=undefined;};
    for(const t of transfers){const token=t.token.toLowerCase(),incoming=t.to.toLowerCase()===vault.toLowerCase();
      if(token===weth.toLowerCase()){if(!incoming){flush();pendingBuy={cost:t.amount};}else if(pendingSell){dispose(positions.get(pendingSell.token.toLowerCase())??blank(pendingSell.token),pendingSell.units,t.amount);pendingSell=undefined;}continue;}
      if(incoming){const p=positions.get(token)??blank(t.token);if(pendingBuy){acquire(p,t.amount,pendingBuy.cost);pendingBuy=undefined;}else{acquire(p,t.amount,0n);p.complete=false;}positions.set(token,p);}
      else{flush();pendingBuy=undefined;pendingSell={token:t.token,units:t.amount};}
    }flush();
  }
  const assets=[];
  for(const token of tokens){const [symbol,decimals,balance]=await Promise.all([client.readContract({address:token,abi,functionName:"symbol",blockNumber:indexedBlock}),client.readContract({address:token,abi,functionName:"decimals",blockNumber:indexedBlock}),client.readContract({address:token,abi,functionName:"balanceOf",args:[vault],blockNumber:indexedBlock})]);const p=positions.get(token.toLowerCase())??blank(token);assets.push({symbol,decimals,token,units:String(p.units),costWei:String(p.costWei),realizedPnlWei:String(p.realizedPnlWei),acquiredUnits:String(p.acquiredUnits),acquiredCostWei:String(p.acquiredCostWei),disposedUnits:String(p.disposedUnits),proceedsWei:String(p.proceedsWei),complete:p.complete,reconciled:p.units===balance,balance:String(balance)});}
  return {slug,vault,weth,startBlock:String(startBlock),indexedBlock:String(indexedBlock),transactionCount:groups.size,assets};
}

const result={chainId:4663,generatedAt:new Date().toISOString(),indexedBlock:String(indexedBlock),vaults:{}};
for(const [slug,vault] of Object.entries(vaults)){result.vaults[slug]=await scan(slug,vault);console.log(`${slug}: ${result.vaults[slug].transactionCount} transfer transactions`);}
fs.writeFileSync(new URL("../deployments/vault-cost-basis-4663.json",import.meta.url),JSON.stringify(result,null,2)+"\n");
console.log(`wrote block ${indexedBlock}`);
