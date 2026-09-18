import { CURATOR_696, GEN0_SLUG } from "@/lib/curators";

const KEY = (slug: string) => `hoodx-token-image-v1:${slug}`;
const SIZE = 400;
const MAX_CHARS = 350_000;

export function stockTokenImage(slug: string): string {
  return slug === GEN0_SLUG ? CURATOR_696.avatar : "";
}

export function canSetTokenImage(slug: string): boolean {
  return Boolean(slug) && slug !== GEN0_SLUG;
}

/** On-chain imageURI: https or ipfs, no quotes, ≤256 chars. Data URLs stay HUD-only. */
export function walletImageUri(raw: string): string | null {
  const uri = raw.trim();
  if (!uri || uri.length > 256) return null;
  if (/[\u0000-\u001f"]/.test(uri)) return null;
  if (/^https:\/\//i.test(uri) || /^ipfs:\/\//i.test(uri)) return uri;
  return null;
}

export const GEN0_WALLET_IMAGE = "https://www.xhoodindex.com/curators/696_eth.jpg";

export function loadTokenImage(slug: string): string {
  const stock = stockTokenImage(slug);
  if (stock) return stock;
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY(slug)) || "";
  } catch {
    return "";
  }
}

export function saveTokenImage(slug: string, dataUrl: string) {
  if (!canSetTokenImage(slug) || !dataUrl) return;
  localStorage.setItem(KEY(slug), dataUrl);
}

export function dropTokenImage(slug: string) {
  if (!canSetTokenImage(slug)) return;
  try {
    localStorage.removeItem(KEY(slug));
  } catch {
    /* ignore */
  }
}

export function fileToTokenImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
      reject(new Error("need a jpg, png, webp, or gif"));
      return;
    }
    if (file.size > 6_000_000) {
      reject(new Error("image too large"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("cannot draw image"));
        return;
      }
      const side = Math.min(img.width, img.height) || SIZE;
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      for (const q of [0.85, 0.7, 0.55]) {
        const data = canvas.toDataURL("image/jpeg", q);
        if (data.length <= MAX_CHARS) {
          resolve(data);
          return;
        }
      }
      reject(new Error("image still too large"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read image"));
    };
    img.src = url;
  });
}
