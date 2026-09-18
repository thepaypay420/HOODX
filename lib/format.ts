export function fmtPct(n: number, digits = 1) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

/** (now − then) / then from wei. Converts to ether first so 0.08 ETH stays in Number range. */
export function pctDelta(now: bigint, then: bigint): number | null {
  if (then <= 0n) return null;
  const n = Number(formatEtherSafe(now));
  const t = Number(formatEtherSafe(then));
  if (!Number.isFinite(n) || !Number.isFinite(t) || t === 0) return null;
  return (n - t) / t;
}

export function toneOf(pct: number | null): "up" | "down" | "flat" {
  if (pct == null) return "flat";
  if (pct > 0.0005) return "up";
  if (pct < -0.0005) return "down";
  return "flat";
}

export function fmtShares(wei: bigint, symbol: string, digits = 4) {
  const n = Number(formatEtherSafe(wei));
  return `${n.toFixed(digits)} ${symbol}`;
}

export function fmtUsd(n: number, digits = 2) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

/** Sleeve / drift lines — keep sub-dollar and tiny high-price bags visible. */
export function fmtUsdSleeve(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return fmtUsd(0, 2);
  if (abs >= 1000) return fmtUsd(n, 0);
  if (abs >= 1) return fmtUsd(n, 2);
  if (abs >= 0.01) return fmtUsd(n, 2);
  return fmtUsd(n, 4);
}

export function fmtEth(wei: bigint, digits = 4) {
  const n = Number(formatEtherSafe(wei));
  return `${n.toFixed(digits)} ETH`;
}

/** Avoid Number(wei) — genesis ~4e16 is above MAX_SAFE_INTEGER. */
export function formatEtherSafe(wei: bigint) {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0");
  const s = `${whole}.${frac}`.replace(/\.?0+$/, "") || "0";
  return neg ? `-${s}` : s;
}

/** $100 of ETH in wei. Integer tape (8 dp). Never a HUD fallback price. */
export function genesisEthWei(usdPerShare: number, ethUsd: number, pxDecimals = 8): bigint {
  if (!Number.isFinite(ethUsd) || !Number.isFinite(usdPerShare) || ethUsd <= 0 || usdPerShare <= 0) {
    return 0n;
  }
  const scale = 10 ** pxDecimals;
  const px = BigInt(Math.round(ethUsd * scale));
  if (px === 0n) return 0n;
  return (BigInt(Math.round(usdPerShare)) * 10n ** 18n * BigInt(scale)) / px;
}

export function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function isAddress(addr: string): addr is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDR = "0x000000000000000000000000000000000000dEaD";

export function blockedHandoff(
  who: string,
  ctx: { owner?: string; vault?: string; weth?: string },
): string | null {
  if (!isAddress(who)) return "need a 0x address";
  const a = who.toLowerCase();
  if (a === ZERO_ADDR) return "cannot hand the book to the zero address";
  if (a === DEAD_ADDR.toLowerCase()) return "cannot hand the book to dead";
  if (ctx.weth && a === ctx.weth.toLowerCase()) return "cannot hand the book to WETH";
  if (ctx.vault && a === ctx.vault.toLowerCase()) return "cannot hand the book to the vault";
  if (ctx.owner && a === ctx.owner.toLowerCase()) return "already the curator";
  return null;
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
