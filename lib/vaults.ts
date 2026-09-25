import { GEN0_SLUG } from "@/lib/curators";
import type { Address } from "viem";

export type VaultCategory = "culture" | "technology" | "markets" | "defensive";
export type VaultStatus = "live" | "validated";
export type VaultMeta = {
  slug: string; symbol: string; name: string; thesis: string; flair: string; image: string; orbitDeg: number;
  category: VaultCategory; status: VaultStatus; assets: string[]; cashTarget: number; model7dUsd?: number; accent: string; mark: string; address?: Address;
};

/** New entries remain validated until their successor address is verified on-chain. */
export const FEATURED_VAULTS: VaultMeta[] = [
  { slug: GEN0_SLUG, symbol: "696X", name: "The conviction list", thesis: "Crypto culture, curated by 696.", flair: "Culture · High risk", image: "/vaults/696x.png", orbitDeg: -55, category: "culture", status: "live", assets: ["PONS", "AI", "CASHCAT", "INDEX", "MEME", "STONKBROKER", "HOOKR", "DELTA"], cashTarget: 25, accent: "#4fd7cb", mark: "69" },
  { slug: "faangx", symbol: "FAANGX", name: "Big tech conviction", thesis: "Five category leaders in one basket.", flair: "Technology · Core", image: "/vaults/faangx.png", orbitDeg: 48, category: "technology", status: "live", assets: ["META", "AAPL", "AMZN", "NFLX", "GOOGL"], cashTarget: 25, model7dUsd: 1.31, accent: "#8dd8ff", mark: "F" },
  { slug: "chainfin", symbol: "CHAINX", name: "On-chain finance", thesis: "Public companies building the crypto economy.", flair: "Markets · Momentum", image: "/vaults/chainx.png", orbitDeg: 0, category: "markets", status: "live", assets: ["MSTR", "COIN", "CRCL", "GLXY"], cashTarget: 25, model7dUsd: 16.40, accent: "#b8f36b", mark: "↗", address: "0xF77fb0e5cE0682B8D8064e754cF99d7F3EC643d2" },
  { slug: "siliconx", symbol: "CHIPX", name: "Silicon stack", thesis: "The compute supply chain behind the next cycle.", flair: "Technology · Semiconductors", image: "/vaults/chipx.png", orbitDeg: 0, category: "technology", status: "live", assets: ["NVDA", "AMD", "INTC", "TSM", "MU", "AVGO"], cashTarget: 25, model7dUsd: 8.35, accent: "#66e0ff", mark: "▦", address: "0xb70dD77B61ad2d2D70d14d1e74591fd173f2FBBE" },
  { slug: "aistack", symbol: "AIX", name: "AI stack", thesis: "Compute, platforms and software powering AI.", flair: "Technology · Growth", image: "/vaults/aix.png", orbitDeg: 0, category: "technology", status: "live", assets: ["NVDA", "META", "PLTR", "MSFT", "GOOGL"], cashTarget: 25, model7dUsd: 3.79, accent: "#ba9cff", mark: "✦", address: "0x5B0a7D7e596fc7E627716945644B3cEe738c82E7" },
  { slug: "retailx", symbol: "CULTX", name: "Retail pulse", thesis: "The names internet markets refuse to ignore.", flair: "Culture · High risk", image: "/vaults/cultx.png", orbitDeg: 0, category: "culture", status: "live", assets: ["GME", "AMC", "RDDT", "DJT", "BB", "RBLX"], cashTarget: 25, model7dUsd: 3.30, accent: "#ff8ab5", mark: "◎", address: "0xB8C2F95238A9076E73D60273C22724360a7A052b" },
  { slug: "healthx", symbol: "HLTHX", name: "Health frontier", thesis: "Medicine, longevity and consumer health leaders.", flair: "Defensive · Innovation", image: "/vaults/hlthx.png", orbitDeg: 0, category: "defensive", status: "live", assets: ["MRNA", "LLY", "HIMS", "PFE", "JNJ"], cashTarget: 25, model7dUsd: 3.82, accent: "#7be6ae", mark: "+", address: "0x8b53F25665e0fE8A860A1120A0A08d0007570166" },
  { slug: "cloudx", symbol: "CLOUDX", name: "Cloud layer", thesis: "The software and infrastructure behind modern work.", flair: "Technology · Software", image: "/vaults/cloudx.png", orbitDeg: 0, category: "technology", status: "live", assets: ["SHOP", "NET", "SNOW", "ORCL", "MSFT"], cashTarget: 25, model7dUsd: 3.44, accent: "#83bfff", mark: "☁", address: "0x649be0E6396778Cf58cd5bdfD347cbe83508a3ec" },
  { slug: "realx", symbol: "REALX", name: "Real assets", thesis: "Gold, silver and energy for a different regime.", flair: "Defensive · Real assets", image: "/vaults/realx.png", orbitDeg: 0, category: "defensive", status: "live", assets: ["GLD", "SLV", "USO", "USAR"], cashTarget: 25, model7dUsd: 1.58, accent: "#e4c46e", mark: "◆", address: "0x1a396BfE4f79b1d12a27524217C4DED677BEF1b9" },
  { slug: "corex", symbol: "COREX", name: "Core & carry", thesis: "Broad markets, short Treasuries and a gold sleeve.", flair: "Defensive · Core", image: "/vaults/corex.png", orbitDeg: 0, category: "defensive", status: "live", assets: ["SPY", "QQQ", "SGOV", "GLD", "VTI"], cashTarget: 25, model7dUsd: 2.17, accent: "#d9e3dd", mark: "◇", address: "0xD6b3ba50aFf684df5B53bAD77CA697F64F076789" },
  { slug: "frontierx", symbol: "EDGE", name: "Frontier systems", thesis: "Space, autonomy and strategic industry.", flair: "Markets · Frontier", image: "/vaults/edge.png", orbitDeg: 0, category: "markets", status: "live", assets: ["SPCX", "TSLA", "BA", "LMT", "RCAT", "USAR"], cashTarget: 25, model7dUsd: 0.97, accent: "#ffb86a", mark: "△", address: "0xaabFc490682AD036b421458F10E14dFc105E3AdC" },
  { slug: "consumerx", symbol: "ICONX", name: "Consumer icons", thesis: "Products and platforms people choose every day.", flair: "Markets · Brands", image: "/vaults/iconx.png", orbitDeg: 0, category: "markets", status: "live", assets: ["AAPL", "AMZN", "COST", "META", "NFLX", "LULU"], cashTarget: 25, model7dUsd: 2.44, accent: "#f2a6ff", mark: "✺", address: "0xba12dD90Af13C89662Cb89b85f940c3b8b9bbA15" },
];

export const NEW_VAULTS = FEATURED_VAULTS.filter((vault) => vault.status === "validated");
export const LIVE_OFFICIAL_VAULTS: Readonly<Record<string, Address>> = Object.freeze(
  Object.fromEntries(FEATURED_VAULTS.flatMap((vault) => vault.address ? [[vault.slug, vault.address]] : [])) as Record<string, Address>,
);
const BY_SLUG = new Map(FEATURED_VAULTS.map((v) => [v.slug.toLowerCase(), v]));
export function vaultMeta(slug: string): VaultMeta | undefined { return BY_SLUG.get(slug.trim().toLowerCase()); }
export function vaultImage(slug: string): string { return vaultMeta(slug)?.image ?? ""; }
