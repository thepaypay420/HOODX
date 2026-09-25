import { getHoldingMarket } from "@/lib/holdingMarketServer";
import { guardedError, mapConcurrent, withWorkBudget } from "@/lib/requestGuard";
export async function GET(request: Request) {
  const tokens = [...new Set((new URL(request.url).searchParams.get("tokens") || "").toLowerCase().split(","))].sort();
  if (!tokens.length || tokens.length > 24 || tokens.some(t => !/^0x[0-9a-f]{40}$/.test(t))) return Response.json({ error: "Invalid tokens" }, { status: 400 });
  try {
    return await withWorkBudget("holding-market", tokens.length, { capacity: 96, refillPerSecond: 1.6, maxConcurrent: 4 }, async () => {
      const entries = await mapConcurrent(tokens, 4, async token => {
        try { const data = await getHoldingMarket(token); return [token, { ...data, image: data.image ? `/api/holding-image/${token}` : null }] as const; }
        catch { return [token, null] as const; }
      });
      return Response.json(Object.fromEntries(entries), { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=900" } });
    });
  } catch (error) { return guardedError(error); }
}
