import { unstable_cache } from "next/cache";
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { vaultNav, vaultUniverse } from "@/lib/myVaultsServer";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);

export type PlatformTvl = { usd: number; eth: number; ethUsd: number; vaults: number; complete: boolean; at: number };

/* Everything held in HOODX vaults: every index vault the factories created and Boosted ETH, from the shared 60-second
 * valuation (oracle-free vaults are valued at live quotes to sell every holding), plus Hands-free LP from its own stats.
 * Recomputed at most every two minutes and served from the CDN in between. */
const read = unstable_cache(async (origin: string): Promise<PlatformTvl> => {
  const [refs, lp] = await Promise.all([
    vaultUniverse(),
    fetch(`${origin}/api/autolp-stats`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.ok ? r.json() as Promise<{ navEth: number; ethUsd: number }> : undefined).catch(() => undefined),
  ]);
  let complete = !!lp;
  // most vaults the factories ever created are empty: one batched supply read finds the ones worth valuing
  const client = createPublicClient({ chain: robinhood, batch: { multicall: true }, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 12_000, retryCount: 1 }) });
  const candidates = refs.filter((r) => r.kind !== "autolp");
  const supplies = await Promise.all(candidates.map((r) => client.readContract({ address: r.vault, abi: supplyAbi, functionName: "totalSupply" }).catch(() => null)));
  if (supplies.some((x) => x === null)) complete = false;
  // four at a time with one retry: the public RPC rate-limits bursts, and each valuation is itself a few batched calls
  const targets = candidates.filter((_, i) => (supplies[i] ?? 0n) > 0n);
  const navs: (Awaited<ReturnType<typeof vaultNav>>)[] = [];
  for (let i = 0; i < targets.length; i += 4) {
    navs.push(...await Promise.all(targets.slice(i, i + 4).map((r) =>
      vaultNav(r.vault).catch(() => new Promise((ok) => setTimeout(ok, 400)).then(() => vaultNav(r.vault))).catch(() => null))));
  }
  let eth = 0, counted = 0;
  for (const n of navs) {
    if (!n || n.assetsWei === null) { complete = false; continue; }
    const v = Number(formatEther(BigInt(n.assetsWei)));
    if (v > 0) counted++;
    eth += v;
  }
  if (lp) { eth += lp.navEth; if (lp.navEth > 0) counted++; }
  const ethUsd = lp?.ethUsd ?? 0;
  // never cache a partial total: throwing here leaves the last complete one in place and retries on the next request
  if (!ethUsd || !complete) throw new Error(`incomplete (${navs.filter((n) => !n || n.assetsWei === null).length} vaults unvalued)`);
  return { usd: eth * ethUsd, eth, ethUsd, vaults: counted, complete, at: Date.now() };
}, ["platform-tvl-v2"], { revalidate: 120 });

export async function GET(request: Request) {
  try {
    return await withWorkBudget("platform-tvl", 1, { capacity: 60, refillPerSecond: 2, maxConcurrent: 2 }, async () => {
      try {
        return Response.json(await read(new URL(request.url).origin), { headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=900" } });
      } catch (e) {
        console.error("platform-tvl", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=30" } });
      }
    });
  } catch (error) { return guardedError(error); }
}
