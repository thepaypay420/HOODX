import universe from "../public/universe.json";
import { isRhStockSymbol, isRhStockToken } from "./rhStocks";
import { isAddress } from "./format";

export type Coin = {
  id: string;
  symbol: string;
  name?: string;
  token: string;
  mcapUsd?: number;
  vol24Usd?: number;
  buyTvlUsd?: number;
  hops?: number;
  buyQuote?: string;
  buyQuoteAddr?: string;
  buyPool?: string;
  buyLabels?: string[];
};

export const CATALOG: Coin[] = ((universe as { tokens?: Coin[] }).tokens || []).map((t) => ({
  ...t,
  token: t.token.toLowerCase(),
  buyPool: t.buyPool?.toLowerCase(),
}));

export function isBytes32(id: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(id);
}

/** Uni V3 WETH pool with a 20-byte address. */
export function isV3WethPool(c: Coin) {
  const quote = (c.buyQuote || "").toUpperCase();
  const labels = (c.buyLabels || []).map((x) => x.toLowerCase());
  return (
    Boolean(c.buyPool && isAddress(c.buyPool)) &&
    quote === "WETH" &&
    (labels.length === 0 || labels.includes("v3"))
  );
}

/** Uni V4 pool quoted in native ETH or WETH. */
export function isV4EthWethPool(c: Coin) {
  const quote = (c.buyQuote || "").toUpperCase();
  const labels = (c.buyLabels || []).map((x) => x.toLowerCase());
  return (
    Boolean(c.buyPool && isBytes32(c.buyPool)) &&
    (quote === "WETH" || quote === "ETH") &&
    labels.includes("v4")
  );
}

/** Uni V3 pool quoted in USDG (6 decimals). WETH/USDG bridge is seeded at init. */
export function isV3UsdgPool(c: Coin) {
  const quote = (c.buyQuote || "").toUpperCase();
  const labels = (c.buyLabels || []).map((x) => x.toLowerCase());
  return (
    Boolean(c.buyPool && isAddress(c.buyPool)) &&
    quote === "USDG" &&
    (labels.length === 0 || labels.includes("v3"))
  );
}

/** Uni V4 pool quoted in a canonical RH stock token. WETH bridge is on-chain. */
export function isV4RhQuotePool(c: Coin) {
  const quote = (c.buyQuote || "").toUpperCase();
  const quoteAddr = (c.buyQuoteAddr || "").toLowerCase();
  const labels = (c.buyLabels || []).map((x) => x.toLowerCase());
  return (
    Boolean(c.buyPool && isBytes32(c.buyPool)) &&
    labels.includes("v4") &&
    (isRhStockToken(quoteAddr) || isRhStockSymbol(quote))
  );
}

/** Uni V4 pool quoted in USDG. WETH/USDG bridge is seeded at init. */
export function isV4UsdgQuotePool(c: Coin) {
  const quote = (c.buyQuote || "").toUpperCase();
  const labels = (c.buyLabels || []).map((x) => x.toLowerCase());
  return (
    Boolean(c.buyPool && isBytes32(c.buyPool)) &&
    quote === "USDG" &&
    labels.includes("v4")
  );
}

/** @deprecated use isV4RhQuotePool */
export const isV4QuotePool = isV4RhQuotePool;

/** Vault NAV is 1e18-wad. NET is 9 decimals; bind reverts. */
const NON_WAD = new Set(["0xca9c78dd337a67f6e0077f65f5e9218719d30edf"]);

export function isIndexPool(c: Coin) {
  if (NON_WAD.has(c.token.toLowerCase())) return false;
  return isV3WethPool(c) || isV3UsdgPool(c) || isV4EthWethPool(c) || isV4RhQuotePool(c) || isV4UsdgQuotePool(c);
}

/** Pad a V3 pool address to bytes32; pass a V4 pool id through. */
export function poolRef(c: Coin): `0x${string}` {
  const p = c.buyPool || "";
  if (isBytes32(p)) return p as `0x${string}`;
  if (isAddress(p)) return `0x${p.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
  throw new Error("need a Uni V3 WETH/USDG, V4 ETH/WETH, or V4 quote pool");
}

export const V3_CATALOG: Coin[] = CATALOG.filter(isV3WethPool);
export const INDEX_CATALOG: Coin[] = CATALOG.filter(isIndexPool);

const EXTRA: Coin[] = [];
const BIND = new Map<string, Coin>();

function normCoin(c: Coin): Coin {
  return { ...c, token: c.token.toLowerCase(), buyPool: c.buyPool?.toLowerCase() };
}

/** Vault bind pool from Dexscreener lookup — overrides catalog display pools (e.g. PROMETHEUS/SPCX). */
export function rememberBindCoin(c: Coin) {
  const coin = normCoin(c);
  if (!isIndexPool(coin)) return;
  BIND.set(coin.token, coin);
}

export function rememberCoin(c: Coin) {
  const coin = normCoin(c);
  rememberBindCoin(coin);
  if (CATALOG.some((x) => x.token === coin.token) || EXTRA.some((x) => x.token === coin.token)) return;
  EXTRA.push(coin);
}

/** Pool ref for addToken / mint — prefers resolved ETH/WETH bind over catalog display pool. */
export function coinForBind(addr: string): Coin | undefined {
  const k = addr.toLowerCase();
  const bound = BIND.get(k);
  if (bound) return bound;
  const cat = CATALOG.find((c) => c.token === k);
  if (cat && isIndexPool(cat)) return cat;
  const extra = EXTRA.find((c) => c.token === k);
  if (extra && isIndexPool(extra)) return extra;
  return undefined;
}

export function bookCatalog(): Coin[] {
  return EXTRA.length ? [...INDEX_CATALOG, ...EXTRA] : INDEX_CATALOG;
}

export function tier(mcap = 0) {
  if (mcap >= 100_000_000) return "S";
  if (mcap >= 20_000_000) return "A";
  if (mcap >= 5_000_000) return "B";
  return "C";
}

export function byAddress(addr: string) {
  const k = addr.toLowerCase();
  const cat = CATALOG.find((c) => c.token === k);
  const extra = EXTRA.find((c) => c.token === k);
  const bound = BIND.get(k);
  const base = cat || extra;
  if (bound && base) {
    return { ...base, buyPool: bound.buyPool, buyLabels: bound.buyLabels };
  }
  return bound || base;
}
