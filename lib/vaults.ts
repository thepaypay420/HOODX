import { CURATOR_696, GEN0_SLUG } from "@/lib/curators";

export type VaultMeta = {
  slug: string;
  symbol: string;
  flair: string;
  image: string;
  /** Degrees on the orbit ring (0 = top, clockwise). */
  orbitDeg: number;
};

/** Featured vaults shown on /explore and used for stock token art. */
export const FEATURED_VAULTS: VaultMeta[] = [
  {
    slug: GEN0_SLUG,
    symbol: "696X",
    flair: "Memes · High Risk",
    image: CURATOR_696.avatar,
    orbitDeg: -55,
  },
  {
    slug: "faangx",
    symbol: "FAANGX",
    flair: "Blue chips · Stonks",
    image: "/curators/faangx.jpg",
    orbitDeg: 48,
  },
];

const BY_SLUG = new Map(FEATURED_VAULTS.map((v) => [v.slug.toLowerCase(), v]));

export function vaultMeta(slug: string): VaultMeta | undefined {
  return BY_SLUG.get(slug.trim().toLowerCase());
}

export function vaultImage(slug: string): string {
  return vaultMeta(slug)?.image ?? "";
}
