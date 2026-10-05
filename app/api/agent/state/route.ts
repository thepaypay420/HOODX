import { unstable_cache } from "next/cache";
import { getAddress, isAddress } from "viem";
import { boostSignal, boostStats, positions } from "@/lib/mcp/hoodx";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

/* Live readings for the companion's briefing and watch rules: plain data, no model. GET ?wallet=0x… adds that wallet's
 * positions. The public part is shared and cached for a minute. */
const shared = unstable_cache(async (origin: string) => {
  const [stats, sig] = await Promise.all([boostStats(origin), boostSignal().catch(() => null)]);
  type Flag = { trend: string; on: boolean; turnsOffBelow: number; turnsOnAbove: number };
  const eth = (sig?.eth.flags ?? []) as Flag[];
  const off = eth.filter((f) => !f.on), on = eth.filter((f) => f.on);
  return {
    ethUsd: stats?.ethUsd ?? sig?.eth.price ?? null,
    boost: stats ? { target: stats.target, leverage: stats.leverage } : sig ? { target: sig.target, leverage: sig.target } : null,
    boostLevels: sig ? { fullAbove: off.length ? Math.min(...off.map((f) => f.turnsOnAbove)) : null, firstStepBelow: on.length ? Math.max(...on.map((f) => f.turnsOffBelow)) : null } : null,
  };
}, ["agent-state-v1"], { revalidate: 60 });

export async function GET(request: Request) {
  const url = new URL(request.url), w = url.searchParams.get("wallet");
  try {
    return await withWorkBudget("agent-state", 1, { capacity: 120, refillPerSecond: 2, maxConcurrent: 8 }, async () => {
      const pub = await shared(url.origin);
      let pos: Record<string, { name: string; valueUsd: number | null }> | null = null, totalUsd: number | null = null, walletEth: string | null = null;
      if (w && isAddress(w)) {
        const p = await positions(url.origin, getAddress(w)).catch(() => null);
        if (p) { pos = Object.fromEntries(p.positions.map((r) => [r.slug, { name: r.vault, valueUsd: r.valueUsd }])); totalUsd = p.totalValueUsd; walletEth = p.ethBalanceOnRobinhoodChain; }
      }
      return Response.json({ at: Date.now(), ...pub, positions: pos, totalUsd, walletEth }, { headers: { "Cache-Control": w ? "private, no-store" : "public, max-age=30, s-maxage=60" } });
    });
  } catch (e) { return guardedError(e); }
}
