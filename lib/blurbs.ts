export const BLURB_MAX = 140;
export const BLURB_EVENT = "hoodx:blurb";

const DEFAULTS: Record<string, string> = {
  "696x": "CTO lead of @PrometheusGrok / Health & Wealth",
  faangx:
    "Equal-weight FAANG on RH Chain — META, AMZN, AAPL, NFLX, GOOGL. 0% curator fees; 10 bps protocol only.",
};

function key(id: string) {
  return `hoodx:vault-blurb:${id.toLowerCase()}`;
}

export function defaultBlurb(slug: string) {
  return DEFAULTS[slug.trim().toLowerCase()] || "";
}

export function readBlurb(slug: string, vault?: string) {
  if (typeof window !== "undefined") {
    for (const id of [vault, slug]) {
      if (!id) continue;
      const stored = window.localStorage.getItem(key(id));
      if (stored != null) return stored.trim();
    }
  }
  return defaultBlurb(slug);
}

export function writeBlurb(slug: string, vault: string | undefined, text: string) {
  const next = text.trim().slice(0, BLURB_MAX);
  if (typeof window === "undefined") return next;
  for (const id of [vault, slug]) {
    if (!id) continue;
    if (next) window.localStorage.setItem(key(id), next);
    else window.localStorage.removeItem(key(id));
  }
  window.dispatchEvent(new CustomEvent(BLURB_EVENT, { detail: { slug, vault, text: next } }));
  return next;
}
