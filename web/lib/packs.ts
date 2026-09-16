import { CATALOG } from "@/lib/catalog";

export type DraftPack = {
  slug: string;
  name: string;
  symbol: string;
  tokens: string[];
  feeBps: number;
  payout?: string;
  createdAt: number;
};

const GALLERY = "696x-gallery-v1";
const packKey = (slug: string) => `696x-pack-v1:${slug}`;
const payoutKey = (slug: string) => `696x-payout-v1:${slug}`;

export function defaultPack(): string[] {
  return CATALOG.filter((c) => (c.vol24Usd || 0) >= 100).map((c) => c.token);
}

export function loadTokens(slug: string, fallback?: string[]): string[] {
  try {
    const raw = localStorage.getItem(packKey(slug));
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed) && parsed.length) return parsed.map((t) => t.toLowerCase());
    }
  } catch {
    /* ignore */
  }
  return fallback ?? [];
}

export function saveTokens(slug: string, tokens: string[]) {
  localStorage.setItem(packKey(slug), JSON.stringify(tokens.map((t) => t.toLowerCase())));
}

export function loadPayout(slug: string): string {
  try {
    return localStorage.getItem(payoutKey(slug)) || "";
  } catch {
    return "";
  }
}

export function savePayout(slug: string, addr: string) {
  if (!addr) {
    localStorage.removeItem(payoutKey(slug));
    return;
  }
  localStorage.setItem(payoutKey(slug), addr);
}

export function loadGallery(): DraftPack[] {
  try {
    const raw = localStorage.getItem(GALLERY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DraftPack[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDraft(pack: DraftPack) {
  const next = [pack, ...loadGallery().filter((p) => p.slug !== pack.slug)].slice(0, 24);
  localStorage.setItem(GALLERY, JSON.stringify(next));
  saveTokens(pack.slug, pack.tokens);
  if (pack.payout) savePayout(pack.slug, pack.payout);
}

export function dropDraft(slug: string) {
  localStorage.setItem(GALLERY, JSON.stringify(loadGallery().filter((p) => p.slug !== slug)));
}

export function ownsDraft(slug: string) {
  return loadGallery().some((p) => p.slug === slug);
}
