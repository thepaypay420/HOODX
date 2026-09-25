import { unstable_cache } from "next/cache";
import { createPublicClient, http, type Address } from "viem";
import { RPC_URL } from "@/lib/config";
import { verifiedV2Vaults } from "@/lib/v2";
import { readVaultCostBasis } from "@/lib/vaultCostBasisServer";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

const read=unstable_cache(async(vault:Address)=>{
  try {
    const client=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL||RPC_URL,{timeout:10000,retryCount:0})});
    if(await client.getChainId()!==4663)throw new Error("Wrong network");
    const result=await readVaultCostBasis(client,vault);
    return {ok:true as const,value:{...result,indexedBlock:String(result.indexedBlock),assets:result.assets.map(a=>({...a,units:String(a.units),costWei:String(a.costWei),realizedPnlWei:String(a.realizedPnlWei),acquiredUnits:String(a.acquiredUnits),acquiredCostWei:String(a.acquiredCostWei),disposedUnits:String(a.disposedUnits),proceedsWei:String(a.proceedsWei),currentBalance:String(a.currentBalance)}))}};
  } catch { return {ok:false as const}; }
},["vault-cost-basis-v1"],{revalidate:60});

export async function GET(request:Request){
  const requested=new URL(request.url).searchParams.get("vault")?.toLowerCase();
  const vault=Object.values(verifiedV2Vaults).find(v=>v.toLowerCase()===requested);
  if(!vault)return Response.json({error:"Unknown vault"},{status:400});
  try{return await withWorkBudget("vault-cost-basis",1,{capacity:4,refillPerSecond:1/30,maxConcurrent:1},async()=>{
    const result=await read(vault);
    if(!result.ok)return Response.json({error:"Verified cost basis is temporarily unavailable"},{status:503,headers:{"Cache-Control":"public, max-age=15, s-maxage=60"}});
    return Response.json(result.value,{headers:{"Cache-Control":"public, max-age=15, s-maxage=60, stale-while-revalidate=300"}});
  });}catch(error){return guardedError(error);}
}
