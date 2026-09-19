export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.xhoodindex.com").replace(
  /\/$/,
  "",
);
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 4663);
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER || "https://robinhoodchain.blockscout.com";
export const WETH = (process.env.NEXT_PUBLIC_WETH ||
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73") as `0x${string}`;
export const USDG = (process.env.NEXT_PUBLIC_USDG ||
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") as `0x${string}`;

/** Superseded Gen-0 clone — HUD ignores this pin. */
export const BRICKED_696X_ADDR = "0x6350f9e8e630785ABF09fD1127366998Ad821E33";
/** Canonical Gen-0 vault — hardened factory, live $696X. */
export const SAFE_696X_ADDR = "0xAC45f6FffB17645057aa783b72b2Ce78BD7A1a3A";
/** @deprecated alias for the superseded clone */
export const LIVE_696X_ADDR = BRICKED_696X_ADDR;
export const LIVE_FACTORY_ADDR = "0x56809a2738A23650aF939F73588E72C67CafC19b";
export const LEGACY_FACTORY_ADDR = "0x3860176e3cEd09519C377FFc9eDC8379aC4DDf71";
export const V4_POSM = (process.env.NEXT_PUBLIC_V4_POSM ||
  "0x58daec3116aae6D93017bAAea7749052E8a04fA7") as `0x${string}`;
export const V4_STATE_VIEW = (process.env.NEXT_PUBLIC_V4_STATE_VIEW ||
  "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b") as `0x${string}`;
/** Superseded hook-safe vault — HUD ignores this pin. */
export const HOOK_SAFE_696X_ADDR = "0x466742D65C21eC1A4c82f2D0Fd9E3C01C78D89dE";
export const HOOK_SAFE_FACTORY_ADDR = "0xc29a60cc325b35794f4AE65B8bc518639e716FbD";
export const EMPTIED_696X = "0xeBFA7c94D6d708a242f84c98a048C84b59e95C24";
export const EMPTIED_FACTORY = "0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9";

function liveOr(env: string | undefined, canonical: string, legacy: string[]): `0x${string}` {
  const v = (env || "").trim();
  const legacyLc = legacy.map((x) => x.toLowerCase());
  if (!v || legacyLc.includes(v.toLowerCase())) return canonical as `0x${string}`;
  return v as `0x${string}`;
}

export const VAULT = liveOr(
  process.env.NEXT_PUBLIC_VAULT_ADDRESS,
  SAFE_696X_ADDR,
  [EMPTIED_696X, BRICKED_696X_ADDR, HOOK_SAFE_696X_ADDR],
) as `0x${string}` | "";
export const LIVE_696X = SAFE_696X_ADDR.toLowerCase();
export function isLive696x(addr?: string | null) {
  return (addr || "").toLowerCase() === LIVE_696X;
}
export function isBricked696x(addr?: string | null) {
  return (addr || "").toLowerCase() === BRICKED_696X_ADDR.toLowerCase();
}
export function isSafe696x(addr?: string | null) {
  return (addr || "").toLowerCase() === SAFE_696X_ADDR.toLowerCase();
}
export function isEmptied696x(addr?: string | null) {
  return (addr || "").toLowerCase() === EMPTIED_696X.toLowerCase();
}
export const FACTORY = liveOr(
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS,
  LIVE_FACTORY_ADDR,
  [EMPTIED_FACTORY, LEGACY_FACTORY_ADDR, HOOK_SAFE_FACTORY_ADDR],
) as `0x${string}` | "";
export const QUOTER = (process.env.NEXT_PUBLIC_QUOTER ||
  "0x33e885eD0Ec9bF04EcfB19341582AADCb4c8A9E7") as `0x${string}`;

export const PROTOCOL_FEE_BPS = 10;
export const CREATOR_FEE_BPS = 40;
export const ISSUE_FEE_BPS = PROTOCOL_FEE_BPS + CREATOR_FEE_BPS;
export const REDEEM_FEE_BPS = 0;
export const MIN_SLEEVE_USD = 10;
export const CASH_TARGET = 0.25;
export const MIN_DEPOSIT_ETH = 0.02;
export const MIN_FIRST_ETH = 0.08;
export const MIN_CREATE_FIRST_ETH = 0.02;
export const USD_PER_SHARE = 100;
export const MAX_NAV_DIVERGE = 0.02;
export const HOODX_SLUG = "696x";
export const TWEET = "https://x.com/696_eth/status/2100067116594725086";
export const GITHUB_REPO = "https://github.com/thepaypay420/HOODX";
export const TELEGRAM = "https://t.me/HOODXINDEX";
export const X_ACCOUNT = "https://x.com/XHOODINDEX";
