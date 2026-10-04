import { getAddress, isAddress } from "viem";
import { vaultNav } from "@/lib/myVaultsServer";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

// A vault's value and share supply for first paint, from the shared 60-second cache in lib/myVaultsServer.ts. The vault
// page shows it at once and replaces it with its own live block-pinned reads when they arrive.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("vault") ?? "";
  if (!isAddress(raw)) return Response.json({ error: "bad vault" }, { status: 400 });
  try {
    return await withWorkBudget("vault-nav", 1, { capacity: 30, refillPerSecond: 1, maxConcurrent: 4 }, async () => {
      try {
        const nav = await vaultNav(getAddress(raw));
        if (!nav || nav.assetsWei === null) return Response.json({ error: "unavailable" }, { status: 404, headers: { "Cache-Control": "public, max-age=15, s-maxage=60" } });
        return Response.json(nav, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=300" } });
      } catch (e) {
        console.error("vault-nav", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=10" } });
      }
    });
  } catch (error) { return guardedError(error); }
}
