export type HoldingMarket = { marketCap: number | null; name: string; image: string | null; updatedAt: number };
type Pair = { chainId?: string; baseToken?: { address?: string; name?: string }; liquidity?: { usd?: number }; marketCap?: number; info?: { imageUrl?: string } };
export function selectMarket(pairs: Pair[], token: string, now = Date.now()): HoldingMarket {
  const pair = pairs.filter(p => p.chainId === "robinhood" && p.baseToken?.address?.toLowerCase() === token.toLowerCase()).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const cap = pair?.marketCap;
  let image: string | null = null;
  try { const url = new URL(pair?.info?.imageUrl || ""); if (url.protocol === "https:" && url.hostname === "cdn.dexscreener.com" && !url.username && !url.password && !url.port) { url.searchParams.set("width", "96"); url.searchParams.set("height", "96"); url.searchParams.set("format", "png"); image = url.href; } } catch {}
  return { marketCap: typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : null, name: (pair?.baseToken?.name || "").slice(0, 80), image, updatedAt: now };
}
export const compactCap = (cap?: number | null) => cap && cap > 0 ? "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(cap) : "—";
