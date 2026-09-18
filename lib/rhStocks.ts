import bridges from "../public/rh_bridges.json";
import stocks from "../public/rh_stocks.json";

export type RhStock = { symbol: string; token: string; kind?: string };
export type RhBridge = { token: string; bridge: string; tvlUsd?: number };

const TOKEN_LIST: RhStock[] = (stocks as { tokens?: RhStock[] }).tokens || [];
const BRIDGE_MAP: Record<string, RhBridge> = (bridges as { bridges?: Record<string, RhBridge> }).bridges || {};

const BY_TOKEN = new Map(TOKEN_LIST.map((t) => [t.token.toLowerCase(), t]));
const BY_SYMBOL = new Map(TOKEN_LIST.map((t) => [t.symbol.toUpperCase(), t]));

export const RH_STOCKS: RhStock[] = TOKEN_LIST;
export const RH_BRIDGES = BRIDGE_MAP;

export function isRhStockToken(addr: string) {
  return BY_TOKEN.has(addr.toLowerCase());
}

export function isRhStockSymbol(sym: string) {
  return BY_SYMBOL.has(sym.toUpperCase());
}

export function rhStock(addrOrSymbol: string): RhStock | undefined {
  const k = addrOrSymbol.toLowerCase();
  if (k.startsWith("0x")) return BY_TOKEN.get(k);
  return BY_SYMBOL.get(addrOrSymbol.toUpperCase());
}

/** Known WETH V3 bridge for a canonical RH stock (may be stale — Dexscreener wins at runtime). */
export function catalogBridge(token: string): string | undefined {
  const row = BY_TOKEN.get(token.toLowerCase());
  if (!row) return undefined;
  return BRIDGE_MAP[row.symbol]?.bridge?.toLowerCase();
}
