/* What an unfunded collection would have returned since launch: its on-chain target weights (plus the WETH cash sleeve,
 * which moves with ETH) priced from the close before launch to now, in USD, before fees and swap costs. */

export type Leg = { symbol: string; weightBps: number };
export type PricePair = { launch: number; now: number };
export type SimResult = { pct: number; coverageBps: number; since: number };

/** Weighted hold return. Legs without a price are left out and the rest re-weighted, but only while they cover at least
 *  90% of the basket; below that the estimate would say more about the gaps than the basket, so there is none. */
export function simulatedReturn(legs: Leg[], cashBps: number, prices: Record<string, PricePair | undefined>, eth: PricePair | undefined, since: number): SimResult | undefined {
  if (!eth || eth.launch <= 0 || eth.now <= 0) return undefined;
  let value = cashBps * (eth.now / eth.launch), covered = cashBps;
  for (const leg of legs) {
    const p = prices[leg.symbol];
    if (!p || p.launch <= 0 || p.now <= 0) continue;
    value += leg.weightBps * (p.now / p.launch); covered += leg.weightBps;
  }
  const total = cashBps + legs.reduce((s, l) => s + l.weightBps, 0);
  if (total <= 0 || covered < total * 0.9) return undefined;
  return { pct: (value / covered - 1) * 100, coverageBps: Math.round((covered / total) * 10_000), since };
}

/** Exchange ticker for a token symbol: share classes use a dash (BRK.B -> BRK-B). */
export const quoteSymbol = (symbol: string) => symbol.trim().toUpperCase().replace(".", "-");

/** Last daily close strictly before `launch` (seconds), and the latest price. */
export async function fetchPricePair(symbol: string, launch: number): Promise<PricePair | undefined> {
  const from = launch - 14 * 86_400, to = Math.floor(Date.now() / 1000) + 86_400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HOODX)" }, signal: AbortSignal.timeout(8_000) });
  if (!r.ok) return undefined;
  const d = (await r.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
  const res = d.chart?.result?.[0];
  const ts = res?.timestamp ?? [], close = res?.indicators?.quote?.[0]?.close ?? [];
  let launchClose: number | undefined;
  for (let i = 0; i < ts.length; i++) if (ts[i] < launch && close[i]) launchClose = close[i]!;
  const now = res?.meta?.regularMarketPrice;
  return launchClose && now ? { launch: launchClose, now } : undefined;
}
