import { assetLogo } from "@/lib/assetLogos";

/**
 * Names for the Automated LP stocks. Logos are static files from public/logos (see lib/assetLogos.ts),
 * reviewed by eye: the US ticker "SPCX" is an unrelated company, so SPCX (SpaceX on Robinhood Chain) uses a
 * designed rocket mark. `light` = transparent logo that needs a light tile.
 */
export const STOCK_LOGOS: Record<string, { light?: boolean; name: string }> = {
  NVDA: { name: "NVIDIA" },
  META: { name: "Meta" },
  SPY: { name: "SPDR S&P 500" },
  SPCX: { name: "SpaceX" },
  PLTR: { name: "Palantir" },
  BABA: { name: "Alibaba" },
  USO: { light: true, name: "United States Oil Fund" },
  MSTR: { name: "Strategy" },
  SNDK: { name: "Sandisk" },
  MU: { name: "Micron" }, // the lowercase "m" is Micron's 2024 mark (the orbit "M" was retired)
  DELL: { name: "Dell Technologies" },
  MSFT: { name: "Microsoft" },
  AAPL: { name: "Apple" },
};

export const stockLogoSrc = (symbol: string) => assetLogo(symbol) ?? null;
