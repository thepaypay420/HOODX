import manifest from "@/public/logos/manifest.json";

/**
 * Static asset logos saved by scripts/fetch_logos.py into public/logos/ (128px WebP).
 * URLs carry a content hash (`?v=…`), so the CDN caches them as immutable and a changed logo gets a new URL.
 * Symbols without a reviewed logo return undefined and render as a ticker chip.
 */
const LOGOS = manifest as Record<string, string>;
export const assetLogo = (symbol: string): string | undefined => LOGOS[symbol.toUpperCase()];
