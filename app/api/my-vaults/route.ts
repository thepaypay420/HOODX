import { getAddress, isAddress } from "viem";
import { readPositions } from "@/lib/myVaultsServer";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

// A wallet's HOODX positions. Every chain read behind this is cached (see lib/myVaultsServer.ts), and the edge cache
// absorbs repeat refreshes for 15 seconds per address, so a user mashing refresh costs the RPC nothing extra.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(raw)) return Response.json({ error: "bad address" }, { status: 400 });
  try {
    return await withWorkBudget("my-vaults", 1, { capacity: 30, refillPerSecond: 1, maxConcurrent: 4 }, async () => {
      try {
        return Response.json(await readPositions(getAddress(raw)), { headers: { "Cache-Control": "public, max-age=10, s-maxage=15" } });
      } catch (e) {
        console.error("my-vaults", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=10" } });
      }
    });
  } catch (error) { return guardedError(error); }
}
