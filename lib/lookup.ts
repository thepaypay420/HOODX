"use client";

import { type Coin, isBytes32, isIndexPool, rememberCoin } from "@/lib/catalog";
import { WETH } from "@/lib/config";
import { isAddress } from "@/lib/format";
import { publicClient } from "@/lib/wallet";

const DEX_TOKENS = "https://api.dexscreener.com/tokens/v1/robinhood/";
const DEX_PAIRS = "https://api.dexscreener.com/token-pairs/v1/robinhood/";
const NATIVE = "0x0000000000000000000000000000000000000000";
const ETH_SYM = new Set(["WETH", "ETH"]);

const metaAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  labels?: string[];
  dexId?: string;
  liquidity?: { usd?: number | string };
  volume?: { h24?: number | string };
  marketCap?: number | string;
  fdv?: number | string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string };
};

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ethQuote(p: DexPair) {
  const qaddr = (p.quoteToken?.address || "").toLowerCase();
  const qsym = (p.quoteToken?.symbol || "").toUpperCase();
  return qaddr === WETH.toLowerCase() || qaddr === NATIVE || ETH_SYM.has(qsym);
}

function kind(p: DexPair): "v3" | "v4" | null {
  const labels = (p.labels || []).map((x) => String(x).toLowerCase());
  const pool = p.pairAddress || "";
  if (labels.includes("v4") || isBytes32(pool)) return "v4";
  if (labels.includes("v3") || isAddress(pool)) return "v3";
  return null;
}

async function pairsFor(token: string): Promise<DexPair[]> {
  const seen = new Map<string, DexPair>();
  for (const url of [DEX_TOKENS + token, DEX_PAIRS + token]) {
    try {
      const raw = await fetch(url).then((r) => r.json());
      const rows: unknown[] = Array.isArray(raw) ? raw : raw?.pairs || [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const p = row as DexPair;
        const addr = (p.pairAddress || "").toLowerCase();
        if (addr) seen.set(addr, p);
      }
    } catch {
      /* one endpoint can 404 */
    }
  }
  return [...seen.values()];
}

function pickPool(pairs: DexPair[], token: string): DexPair | null {
  const scored = pairs
    .filter((p) => String(p.chainId || "").toLowerCase() === "robinhood")
    .filter((p) => (p.baseToken?.address || "").toLowerCase() === token)
    .filter((p) => ethQuote(p) && kind(p) && num(p.liquidity?.usd) > 0)
    .sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
  return scored[0] || null;
}

/** Resolve a Robinhood token to a vault-bindable Uni V3 WETH or V4 ETH/WETH pool. */
export async function lookupIndexCoin(addr: string): Promise<Coin> {
  if (!isAddress(addr)) throw new Error("paste a token 0x");
  const token = addr.toLowerCase();
  if (token === WETH.toLowerCase()) throw new Error("WETH is cash, not a name");
  const buy = pickPool(await pairsFor(token), token);
  if (!buy?.pairAddress) throw new Error("No Uni V3 WETH or V4 ETH pool on Dexscreener.");
  const labels = kind(buy) === "v4" ? ["v4"] : ["v3"];
  const quote = (buy.quoteToken?.symbol || "WETH").toUpperCase();
  let symbol = (buy.baseToken?.symbol || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  let name = buy.baseToken?.name || symbol;
  let decimals = 0;
  try {
    decimals = Number(
      await publicClient.readContract({ address: token as `0x${string}`, abi: metaAbi, functionName: "decimals" }),
    );
  } catch {
    throw new Error("Could not read decimals.");
  }
  if (decimals !== 18) throw new Error("Token must be 18 decimals.");
  try {
    const on = await publicClient.readContract({
      address: token as `0x${string}`,
      abi: metaAbi,
      functionName: "symbol",
    });
    if (on) symbol = String(on).replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || symbol;
  } catch {
    /* Dexscreener symbol is enough */
  }
  try {
    const on = await publicClient.readContract({
      address: token as `0x${string}`,
      abi: metaAbi,
      functionName: "name",
    });
    if (on) name = String(on);
  } catch {
    /* */
  }
  const coin: Coin = {
    id: symbol || token.slice(2, 8).toUpperCase(),
    symbol: symbol || token.slice(2, 8).toUpperCase(),
    name,
    token,
    mcapUsd: num(buy.marketCap || buy.fdv),
    vol24Usd: num(buy.volume?.h24),
    hops: 1,
    buyQuote: quote,
    buyPool: buy.pairAddress.toLowerCase(),
    buyLabels: labels,
  };
  if (!isIndexPool(coin)) throw new Error("Pool must be Uni V3 WETH or V4 ETH/WETH.");
  rememberCoin(coin);
  return coin;
}
