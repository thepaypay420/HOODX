/**
 * Verified logo sources for the Automated LP stocks. Explicit per-symbol allowlist (never a blind ticker lookup:
 * the US ticker "SPCX" is an unrelated company, while SPCX on Robinhood Chain is SpaceX). Served through
 * /api/stock-logo/[symbol] with a 30-day edge cache. `null` = no reliable high-resolution source: a designed mark
 * is shown instead. `light` = transparent logo that needs a light tile.
 */
export const STOCK_LOGOS: Record<string, { url: string | null; light?: boolean; name: string }> = {
  NVDA: { url: "https://assets.parqet.com/logos/symbol/NVDA?format=png&size=256", name: "NVIDIA" },
  META: { url: "https://assets.parqet.com/logos/symbol/META?format=png&size=256", name: "Meta" },
  SPY: { url: "https://assets.parqet.com/logos/symbol/SPY?format=png&size=256", name: "SPDR S&P 500" },
  SPCX: { url: null, name: "SpaceX" },
  PLTR: { url: "https://assets.parqet.com/logos/symbol/PLTR?format=png&size=256", name: "Palantir" },
  BABA: { url: "https://assets.parqet.com/logos/symbol/BABA?format=png&size=256", name: "Alibaba" },
  USO: { url: "https://assets.parqet.com/logos/symbol/USO?format=png&size=256", light: true, name: "United States Oil Fund" },
  MSTR: { url: "https://assets.parqet.com/logos/symbol/MSTR?format=png&size=256", name: "Strategy" },
};

export const stockLogoSrc = (symbol: string) => (STOCK_LOGOS[symbol]?.url ? `/api/stock-logo/${symbol}` : null);
