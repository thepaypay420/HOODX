import { unstable_cache } from "next/cache";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { fetchPricePair, quoteSymbol, simulatedReturn, type Leg, type PricePair, type SimResult } from "@/lib/collectionReturns";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";
import { verifiedV2Vaults } from "@/lib/v2";
import { FEATURED_VAULTS } from "@/lib/vaults";

const abi = parseAbi([
  "function constituents() view returns (address[])",
  "function targetBps(address) view returns (uint16)",
  "function cashTargetBps() view returns (uint16)",
  "function symbol() view returns (string)",
]);

/** Collections that can be simulated: an on-chain weight book and a launch time. */
const TARGETS = FEATURED_VAULTS.flatMap((v) => {
  const vault = v.address ?? verifiedV2Vaults[v.slug];
  return v.status !== "pilot" && v.launchedAt && vault ? [{ slug: v.slug, vault: vault as Address, since: v.launchedAt }] : [];
});

const read = unstable_cache(async (): Promise<Record<string, SimResult>> => {
  const client = createPublicClient({ chain: robinhood, batch: { multicall: true }, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 10_000, retryCount: 1 }) });
  // each vault's weight book, straight from the chain
  const books = await Promise.all(TARGETS.map(async (t) => {
    const [tokens, cash] = await Promise.all([
      client.readContract({ address: t.vault, abi, functionName: "constituents" }),
      client.readContract({ address: t.vault, abi, functionName: "cashTargetBps" }),
    ]);
    const legs: Leg[] = await Promise.all(tokens.map(async (token) => {
      const [weightBps, symbol] = await Promise.all([
        client.readContract({ address: t.vault, abi, functionName: "targetBps", args: [token] }),
        client.readContract({ address: token, abi, functionName: "symbol" }),
      ]);
      return { symbol: quoteSymbol(symbol), weightBps: Number(weightBps) };
    }));
    return { ...t, cashBps: Number(cash), legs };
  }));
  // one price history per ticker and launch date
  const want = new Map<string, { symbol: string; since: number }>();
  for (const b of books) for (const l of [...b.legs, { symbol: "ETH-USD", weightBps: 0 }]) want.set(`${l.symbol}@${b.since}`, { symbol: l.symbol, since: b.since });
  const prices = new Map<string, PricePair | undefined>();
  const keys = [...want.keys()];
  for (let i = 0; i < keys.length; i += 6) {
    await Promise.all(keys.slice(i, i + 6).map(async (k) => {
      const { symbol, since } = want.get(k)!;
      prices.set(k, await fetchPricePair(symbol, since).catch(() => undefined));
    }));
  }
  const out: Record<string, SimResult> = {};
  for (const b of books) {
    const byLeg = Object.fromEntries(b.legs.map((l) => [l.symbol, prices.get(`${l.symbol}@${b.since}`)]));
    const r = simulatedReturn(b.legs, b.cashBps, byLeg, prices.get(`ETH-USD@${b.since}`), b.since);
    if (r) out[b.slug] = r;
  }
  return out;
}, ["collection-returns-v1", ...TARGETS.map((t) => `${t.slug}:${t.vault}:${t.since}`)], { revalidate: 1800 });

export async function GET() {
  try {
    return await withWorkBudget("collection-returns", 1, { capacity: 30, refillPerSecond: 1, maxConcurrent: 2 }, async () => {
      try {
        return Response.json(await read(), { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } });
      } catch (e) {
        console.error("collection-returns", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=30" } });
      }
    });
  } catch (error) { return guardedError(error); }
}
