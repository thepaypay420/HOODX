import { unstable_cache } from "next/cache";
import { createPublicClient, http, type Address } from "viem";
import { quoteVaultHoldings } from "@/lib/quoteVaultHoldings";
import { verifiedV2Vaults } from "@/lib/v2";
import { RPC_URL } from "@/lib/config";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";
const quote = unstable_cache(async (vault: Address) => {
  try {
    const client=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL || RPC_URL,{timeout:10000,retryCount:0})});
    if(await client.getChainId()!==4663)throw Error("Wrong network");
    return { ok: true as const, value: await quoteVaultHoldings(client,vault) };
  } catch { return { ok: false as const }; }
},["vault-route-quote-v1"],{revalidate:60});
export async function GET(request: Request) {
  const vault=new URL(request.url).searchParams.get("vault")?.toLowerCase();
  const allowed=Object.values(verifiedV2Vaults).find(a=>a.toLowerCase()===vault);
  if(!allowed)return Response.json({error:"Unknown vault"},{status:400});
  try {
    return await withWorkBudget("vault-quote", 1, { capacity: 12, refillPerSecond: 0.2, maxConcurrent: 2 }, async () => {
      const cached=await quote(allowed);
      if(!cached.ok)return Response.json({error:"A complete recent holdings quote is unavailable"},{status:503,headers:{"Cache-Control":"public, max-age=15, s-maxage=60"}});
      if(Date.now()-cached.value.timestamp>180000)return Response.json({error:"A complete recent holdings quote is unavailable"},{status:503,headers:{"Cache-Control":"public, max-age=15, s-maxage=60"}});
      return Response.json(cached.value,{headers:{"Cache-Control":"public, max-age=15, s-maxage=30"}});
    });
  } catch(error) { return guardedError(error); }
}
