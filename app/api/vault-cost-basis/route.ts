import { unstable_cache } from "next/cache";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { RPC_URL } from "@/lib/config";
import { verifiedV2Vaults } from "@/lib/v2";
import { atomicFactoryAbi, atomicFactoryAddress, atomicFactoryStartBlock } from "@/lib/atomicFactory";
import { readVaultCostBasis } from "@/lib/vaultCostBasisServer";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

const read=unstable_cache(async(vault:Address)=>{
  try {
    const client=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL||RPC_URL,{timeout:10000,retryCount:0})});
    if(await client.getChainId()!==4663)throw new Error("Wrong network");
    // Vaults outside the saved V2 list must be clones of the atomic factory's implementation.
    let origin:{factory:Address;startBlock:bigint}|undefined;
    if(!Object.values(verifiedV2Vaults).some(v=>v.toLowerCase()===vault.toLowerCase())){
      const [code,implementation]=await Promise.all([client.getCode({address:vault}),client.readContract({address:atomicFactoryAddress,abi:atomicFactoryAbi,functionName:"implementation"})]);
      if(code?.toLowerCase()!==`0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`.toLowerCase())throw new Error("Unknown vault");
      origin={factory:atomicFactoryAddress,startBlock:atomicFactoryStartBlock};
    }
    const result=await readVaultCostBasis(client,vault,origin);
    return {ok:true as const,value:{...result,indexedBlock:String(result.indexedBlock),assets:result.assets.map(a=>({...a,units:String(a.units),costWei:String(a.costWei),realizedPnlWei:String(a.realizedPnlWei),acquiredUnits:String(a.acquiredUnits),acquiredCostWei:String(a.acquiredCostWei),disposedUnits:String(a.disposedUnits),proceedsWei:String(a.proceedsWei),currentBalance:String(a.currentBalance)}))}};
  } catch (error) { console.error("vault-cost-basis", vault, error instanceof Error ? error.message.split(String.fromCharCode(10))[0] : error); return {ok:false as const}; }
},["vault-cost-basis-v1"],{revalidate:60});

export async function GET(request:Request){
  const requested=new URL(request.url).searchParams.get("vault")?.toLowerCase();
  if(!requested||!isAddress(requested))return Response.json({error:"Unknown vault"},{status:400});
  const vault=requested as Address;
  try{return await withWorkBudget("vault-cost-basis",1,{capacity:4,refillPerSecond:1/30,maxConcurrent:1},async()=>{
    const result=await read(vault);
    if(!result.ok)return Response.json({error:"Verified cost basis is temporarily unavailable"},{status:503,headers:{"Cache-Control":"public, max-age=15, s-maxage=60"}});
    return Response.json(result.value,{headers:{"Cache-Control":"public, max-age=15, s-maxage=60, stale-while-revalidate=300"}});
  });}catch(error){return guardedError(error);}
}
