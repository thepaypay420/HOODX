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

export const LIVE_696X_ADDR = "0x6350f9e8e630785ABF09fD1127366998Ad821E33";
export const LIVE_FACTORY_ADDR = "0x3860176e3cEd09519C377FFc9eDC8379aC4DDf71";
export const EMPTIED_696X = "0xeBFA7c94D6d708a242f84c98a048C84b59e95C24";
export const EMPTIED_FACTORY = "0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9";

function liveOr(env: string | undefined, live: string, emptied: string): `0x${string}` {
  const v = (env || "").trim();
  if (!v || v.toLowerCase() === emptied.toLowerCase()) return live as `0x${string}`;
  return v as `0x${string}`;
}

export const VAULT = liveOr(
  process.env.NEXT_PUBLIC_VAULT_ADDRESS,
  LIVE_696X_ADDR,
  EMPTIED_696X,
) as `0x${string}` | "";
export const LIVE_696X = LIVE_696X_ADDR.toLowerCase();
export function isLive696x(addr?: string | null) {
  return (addr || "").toLowerCase() === LIVE_696X;
}
export function isEmptied696x(addr?: string | null) {
  return (addr || "").toLowerCase() === EMPTIED_696X.toLowerCase();
}
export const FACTORY = liveOr(
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS,
  LIVE_FACTORY_ADDR,
  EMPTIED_FACTORY,
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
