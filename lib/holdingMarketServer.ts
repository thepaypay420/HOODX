import { unstable_cache } from "next/cache";
import { selectMarket } from "./holdingMarket";

// Per-address persistent Next data cache is shared across vaults and visitors.
// No RPC calls, polling, or user-controlled upstream hosts.
export const getHoldingMarket = unstable_cache(async (token: string) => {
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Market data unavailable");
  const pairs = await response.json();
  if (!Array.isArray(pairs)) throw new Error("Invalid market data");
  return selectMarket(pairs, token);
}, ["holding-market-v1"], { revalidate: 900 });
