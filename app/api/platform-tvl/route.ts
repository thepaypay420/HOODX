import { unstable_cache } from "next/cache";
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { readAutoLpStats } from "@/lib/autolpStats";
import { vaultNav, vaultUniverse } from "@/lib/myVaultsServer";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);

export type PlatformTvl = { usd: number; eth: number; ethUsd: number; vaults: number; complete: boolean; at: number };

/* Everything held in HOODX vaults: every index vault the factories created and Boosted ETH, from the shared 60-second
 * valuation (oracle-free vaults are valued at live quotes to sell every holding), plus Hands-free LP from its own stats.
 * The total is cached per set of share supplies: any deposit or withdrawal in any vault changes a supply, so the next
 * request recomputes at once; otherwise a total is reused for up to two minutes. */
const client = () => createPublicClient({ chain: robinhood, batch: { multicall: true }, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 12_000, retryCount: 1 }) });

async function read(): Promise<PlatformTvl> {
  const refs = await vaultUniverse();
  // one batched supply read: finds the vaults worth valuing and fingerprints the platform for the cache
  const supplies = await Promise.all(refs.map((r) => client().readContract({ address: r.vault, abi: supplyAbi, functionName: "totalSupply" }).then(String).catch(() => null)));
  return total(refs.map((r, i) => `${r.vault}:${supplies[i] ?? "?"}`).join(","));
}

const total = unstable_cache(async (fingerprint: string): Promise<PlatformTvl> => {
  const refs = await vaultUniverse();
  const supplyOf = new Map(fingerprint.split(",").map((x) => x.split(":") as [string, string]));
  const lp = await readAutoLpStats().catch(() => undefined);
  let complete = !!lp;
  const candidates = refs.filter((r) => r.kind !== "autolp");
  const supplies = candidates.map((r) => { const v = supplyOf.get(r.vault); return v && v !== "?" ? BigInt(v) : null; });
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
}, ["platform-tvl-v3"], { revalidate: 120 });

export async function GET(request: Request) {
  try {
    return await withWorkBudget("platform-tvl", 1, { capacity: 60, refillPerSecond: 2, maxConcurrent: 2 }, async () => {
      try {
        return Response.json(await read(), { headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60" } });
      } catch (e) {
        console.error("platform-tvl", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=30" } });
      }
    });
  } catch (error) { return guardedError(error); }
}
