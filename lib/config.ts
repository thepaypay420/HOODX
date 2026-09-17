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
export const VAULT = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ||
  "0xeBFA7c94D6d708a242f84c98a048C84b59e95C24") as `0x${string}` | "";
export const LIVE_696X = "0xeBFA7c94D6d708a242f84c98a048C84b59e95C24".toLowerCase();
export function isLive696x(addr?: string | null) {
  return (addr || "").toLowerCase() === LIVE_696X;
}
export const FACTORY = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  "0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9") as `0x${string}` | "";
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
