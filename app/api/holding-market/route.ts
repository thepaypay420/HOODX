import { getHoldingMarket } from "@/lib/holdingMarketServer";
export async function GET(request: Request) {
  const tokens = [...new Set((new URL(request.url).searchParams.get("tokens") || "").toLowerCase().split(","))].sort();
  if (!tokens.length || tokens.length > 24 || tokens.some(t => !/^0x[0-9a-f]{40}$/.test(t))) return Response.json({ error: "Invalid tokens" }, { status: 400 });
  const entries = await Promise.all(tokens.map(async token => {
    try { const data = await getHoldingMarket(token); return [token, { ...data, image: data.image ? `/api/holding-image/${token}` : null }]; }
    catch { return [token, null]; }
  }));
  return Response.json(Object.fromEntries(entries), { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=900" } });
}
