export function fmtUsd(n: number, digits = 2) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

export function fmtEth(wei: bigint, digits = 4) {
  const n = Number(wei) / 1e18;
  return `${n.toFixed(digits)} ETH`;
}

export function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function isAddress(addr: string): addr is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export function toSlug(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
}

export const RESERVED_USER_SLUGS = ["696x", "hoodx"] as const;

export function okSlug(slug: string) {
  if (!/^[a-z0-9]{3,16}$/.test(slug)) return false;
  return !["create", "factory", "admin", "index"].includes(slug);
}

export function okUserSlug(slug: string) {
  return okSlug(slug) && !(RESERVED_USER_SLUGS as readonly string[]).includes(slug);
}
