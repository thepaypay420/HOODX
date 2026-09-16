import universe from "../public/universe.json";

export type Coin = {
  id: string;
  symbol: string;
  name?: string;
  token: string;
  mcapUsd?: number;
  vol24Usd?: number;
  hops?: number;
  buyQuote?: string;
};

export const CATALOG: Coin[] = ((universe as { tokens?: Coin[] }).tokens || []).map((t) => ({
  ...t,
  token: t.token.toLowerCase(),
}));

export function tier(mcap = 0) {
  if (mcap >= 100_000_000) return "S";
  if (mcap >= 20_000_000) return "A";
  if (mcap >= 5_000_000) return "B";
  return "C";
}

export function byAddress(addr: string) {
  const k = addr.toLowerCase();
  return CATALOG.find((c) => c.token === k);
}
