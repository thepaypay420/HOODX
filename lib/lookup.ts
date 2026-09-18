"use client";

import { type Coin, isIndexPool, rememberCoin } from "@/lib/catalog";
import { USDG, WETH } from "@/lib/config";
import { isAddress } from "@/lib/format";
import { catalogBridge, isRhStockToken } from "@/lib/rhStocks";
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

function isBytes32(id: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(id);
}

function ethQuote(p: DexPair) {
  const qaddr = (p.quoteToken?.address || "").toLowerCase();
  const qsym = (p.quoteToken?.symbol || "").toUpperCase();
  const baddr = (p.baseToken?.address || "").toLowerCase();
  const bsym = (p.baseToken?.symbol || "").toUpperCase();
  return (
    qaddr === WETH.toLowerCase() ||
    qaddr === NATIVE ||
    ETH_SYM.has(qsym) ||
    baddr === WETH.toLowerCase() ||
    baddr === NATIVE ||
    ETH_SYM.has(bsym)
  );
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

function usdgQuote(p: DexPair) {
  const qaddr = (p.quoteToken?.address || "").toLowerCase();
  const qsym = (p.quoteToken?.symbol || "").toUpperCase();
  return qaddr === USDG.toLowerCase() || qsym === "USDG";
}

function rhStockQuote(p: DexPair) {
  const qaddr = (p.quoteToken?.address || "").toLowerCase();
  return isRhStockToken(qaddr);
}

function pickPool(pairs: DexPair[], token: string): DexPair | null {
  const scored = pairs
    .filter((p) => String(p.chainId || "").toLowerCase() === "robinhood")
    .filter((p) => (p.baseToken?.address || "").toLowerCase() === token)
    .filter((p) => kind(p) && num(p.liquidity?.usd) > 0)
    .sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));

  // Naked RH stock stoken: bind the deepest WETH V3, USDG V3, or V4 ETH book.
  if (isRhStockToken(token)) {
    const bindable = scored.filter(
      (p) =>
        (ethQuote(p) && (kind(p) === "v3" || kind(p) === "v4")) ||
        (usdgQuote(p) && kind(p) === "v3"),
    );
    if (bindable.length) return bindable[0];
  }

  // Meme on RH stock or USDG quote: bind the deepest quoted V4 pool.
  const quotedV4 = scored.filter((p) => (rhStockQuote(p) || usdgQuote(p)) && kind(p) === "v4");
  if (quotedV4.length) return quotedV4[0];

  const eth = scored.filter((p) => ethQuote(p));
  return eth[0] || null;
}

/** Deepest Uni V3 WETH bridge for a canonical RH stock quote token. */
export async function findWethBridge(quoteAddr: string): Promise<string | null> {
  const quote = quoteAddr.toLowerCase();
  if (!isRhStockToken(quote)) return null;
  const pairs = await pairsFor(quote);
  let best: string | null = catalogBridge(quote) || null;
  let bestTvl = 0;
  for (const p of pairs) {
    if (String(p.chainId || "").toLowerCase() !== "robinhood") continue;
    const pool = (p.pairAddress || "").toLowerCase();
    const labels = (p.labels || []).map((x) => String(x).toLowerCase());
    if (pool.length !== 42 || !labels.includes("v3")) continue;
    const base = (p.baseToken?.address || "").toLowerCase();
    const q = (p.quoteToken?.address || "").toLowerCase();
    if (!ethQuote(p)) continue;
    const tvl = num(p.liquidity?.usd);
    const ok =
      (base === quote && (q === WETH.toLowerCase() || q === NATIVE)) ||
      (q === quote && (base === WETH.toLowerCase() || base === NATIVE));
    if (ok && tvl > bestTvl) {
      best = pool;
      bestTvl = tvl;
    }
  }
  return best;
}

/** Resolve a Robinhood token to a vault-bindable pool (WETH V3, V4 ETH, or V4 RH-stock quote). */
export async function lookupIndexCoin(addr: string): Promise<Coin> {
  if (!isAddress(addr)) throw new Error("paste a token 0x");
  const token = addr.toLowerCase();
  if (token === WETH.toLowerCase()) throw new Error("WETH is cash, not a name");
  const buy = pickPool(await pairsFor(token), token);
  if (!buy?.pairAddress) {
    throw new Error("No bindable Uni pool — need WETH V3, USDG V3, V4 ETH, or V4 quote on Dexscreener.");
  }
  const labels = kind(buy) === "v4" ? ["v4"] : ["v3"];
  const quoteTok = buy.quoteToken || {};
  const quote = (quoteTok.symbol || "WETH").toUpperCase();
  const quoteAddr = (quoteTok.address || "").toLowerCase();
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
    buyQuoteAddr: quoteAddr || undefined,
    buyPool: buy.pairAddress.toLowerCase(),
    buyLabels: labels,
  };
  if (!isIndexPool(coin)) {
    throw new Error("Pool must be Uni V3 WETH/USDG, V4 ETH/WETH, or V4 RH stock/USDG quote.");
  }
  rememberCoin(coin);
  return coin;
}
