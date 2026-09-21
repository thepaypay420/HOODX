import { unstable_cache } from "next/cache";
import { createPublicClient, http, type Address } from "viem";
import { quoteVaultHoldings } from "@/lib/quoteVaultHoldings";
import { verifiedV2Vaults } from "@/lib/v2";
import { RPC_URL } from "@/lib/config";
const quote = unstable_cache(async (vault: Address) => {
  const client=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL || RPC_URL,{timeout:15000,retryCount:1})});
  if(await client.getChainId()!==4663)throw Error("Wrong network");
  return quoteVaultHoldings(client,vault);
},["vault-route-quote-v1"],{revalidate:60});
export async function GET(request: Request) {
  const vault=new URL(request.url).searchParams.get("vault")?.toLowerCase();
  const allowed=Object.values(verifiedV2Vaults).find(a=>a.toLowerCase()===vault);
  if(!allowed)return Response.json({error:"Unknown vault"},{status:400});
  try { const result=await quote(allowed);if(Date.now()-result.timestamp>180000)throw Error("Stale quote");return Response.json(result,{headers:{"Cache-Control":"public, max-age=15, s-maxage=30"}}); }
  catch {return Response.json({error:"A complete recent holdings quote is unavailable"},{status:503});}
}
