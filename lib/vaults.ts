import { CURATOR_696, GEN0_SLUG } from "@/lib/curators";

export type VaultCategory = "culture" | "technology" | "markets" | "defensive";
export type VaultStatus = "live" | "validated";
export type VaultMeta = {
  slug: string; symbol: string; name: string; thesis: string; flair: string; image: string; orbitDeg: number;
  category: VaultCategory; status: VaultStatus; assets: string[]; cashTarget: number; model7d?: number; accent: string; mark: string;
};

/** New entries remain validated until their successor address is verified on-chain. */
export const FEATURED_VAULTS: VaultMeta[] = [
  { slug: GEN0_SLUG, symbol: "696X", name: "The conviction list", thesis: "Crypto culture, curated by 696.", flair: "Culture · High risk", image: CURATOR_696.avatar, orbitDeg: -55, category: "culture", status: "live", assets: ["PONS", "AI", "CASHCAT", "INDEX", "MEME", "STONKBROKER", "HOOKR", "DELTA"], cashTarget: 25, accent: "#4fd7cb", mark: "69" },
  { slug: "faangx", symbol: "FAANGX", name: "Big tech conviction", thesis: "Five category leaders in one basket.", flair: "Technology · Core", image: "/curators/faangx.jpg", orbitDeg: 48, category: "technology", status: "live", assets: ["META", "AAPL", "AMZN", "NFLX", "GOOGL"], cashTarget: 25, accent: "#8dd8ff", mark: "F" },
  { slug: "chainfin", symbol: "CHAINX", name: "On-chain finance", thesis: "Public companies building the crypto economy.", flair: "Markets · Momentum", image: "", orbitDeg: 0, category: "markets", status: "validated", assets: ["MSTR", "COIN", "CRCL", "GLXY"], cashTarget: 25, model7d: 14.00, accent: "#b8f36b", mark: "↗" },
  { slug: "siliconx", symbol: "CHIPX", name: "Silicon stack", thesis: "The compute supply chain behind the next cycle.", flair: "Technology · Semiconductors", image: "", orbitDeg: 0, category: "technology", status: "validated", assets: ["NVDA", "AMD", "INTC", "TSM", "MU", "AVGO"], cashTarget: 25, model7d: 6.11, accent: "#66e0ff", mark: "▦" },
  { slug: "aistack", symbol: "AIX", name: "AI stack", thesis: "Compute, platforms and software powering AI.", flair: "Technology · Growth", image: "", orbitDeg: 0, category: "technology", status: "validated", assets: ["NVDA", "META", "PLTR", "MSFT", "GOOGL"], cashTarget: 25, model7d: 1.65, accent: "#ba9cff", mark: "✦" },
  { slug: "retailx", symbol: "CULTX", name: "Retail pulse", thesis: "The names internet markets refuse to ignore.", flair: "Culture · High risk", image: "", orbitDeg: 0, category: "culture", status: "validated", assets: ["GME", "AMC", "RDDT", "DJT", "BB", "RBLX"], cashTarget: 25, model7d: 1.17, accent: "#ff8ab5", mark: "◎" },
  { slug: "healthx", symbol: "HLTHX", name: "Health frontier", thesis: "Medicine, longevity and consumer health leaders.", flair: "Defensive · Innovation", image: "", orbitDeg: 0, category: "defensive", status: "validated", assets: ["MRNA", "LLY", "HIMS", "PFE", "JNJ"], cashTarget: 25, model7d: 1.68, accent: "#7be6ae", mark: "+" },
  { slug: "cloudx", symbol: "CLOUDX", name: "Cloud layer", thesis: "The software and infrastructure behind modern work.", flair: "Technology · Software", image: "", orbitDeg: 0, category: "technology", status: "validated", assets: ["SHOP", "NET", "SNOW", "ORCL", "MSFT"], cashTarget: 25, model7d: 1.31, accent: "#83bfff", mark: "☁" },
  { slug: "realx", symbol: "REALX", name: "Real assets", thesis: "Gold, silver and energy for a different regime.", flair: "Defensive · Real assets", image: "", orbitDeg: 0, category: "defensive", status: "validated", assets: ["GLD", "SLV", "USO", "USAR"], cashTarget: 25, model7d: -0.51, accent: "#e4c46e", mark: "◆" },
  { slug: "corex", symbol: "COREX", name: "Core & carry", thesis: "Broad markets, short Treasuries and a gold sleeve.", flair: "Defensive · Core", image: "", orbitDeg: 0, category: "defensive", status: "validated", assets: ["SPY", "QQQ", "SGOV", "GLD", "VTI"], cashTarget: 25, model7d: 0.07, accent: "#d9e3dd", mark: "◇" },
  { slug: "frontierx", symbol: "EDGE", name: "Frontier systems", thesis: "Space, autonomy and strategic industry.", flair: "Markets · Frontier", image: "", orbitDeg: 0, category: "markets", status: "validated", assets: ["SPCX", "TSLA", "BA", "LMT", "RCAT", "USAR"], cashTarget: 25, model7d: -1.11, accent: "#ffb86a", mark: "△" },
  { slug: "consumerx", symbol: "ICONX", name: "Consumer icons", thesis: "Products and platforms people choose every day.", flair: "Markets · Brands", image: "", orbitDeg: 0, category: "markets", status: "validated", assets: ["AAPL", "AMZN", "COST", "META", "NFLX", "LULU"], cashTarget: 25, model7d: 0.33, accent: "#f2a6ff", mark: "✺" },
];

export const NEW_VAULTS = FEATURED_VAULTS.filter((vault) => vault.status === "validated");
const BY_SLUG = new Map(FEATURED_VAULTS.map((v) => [v.slug.toLowerCase(), v]));
export function vaultMeta(slug: string): VaultMeta | undefined { return BY_SLUG.get(slug.trim().toLowerCase()); }
export function vaultImage(slug: string): string { return vaultMeta(slug)?.image ?? ""; }
