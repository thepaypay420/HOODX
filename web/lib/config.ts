export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 4663);
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER || "https://robinhoodchain.blockscout.com";
export const WETH = (process.env.NEXT_PUBLIC_WETH ||
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73") as `0x${string}`;
export const VAULT = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ||
  "") as `0x${string}` | "";
export const FACTORY = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  "") as `0x${string}` | "";

export const PROTOCOL_FEE_BPS = 10;
export const CREATOR_FEE_BPS = 40;
export const ISSUE_FEE_BPS = PROTOCOL_FEE_BPS + CREATOR_FEE_BPS;
export const REDEEM_FEE_BPS = 0;
export const MIN_SLEEVE_USD = 10;
export const CASH_TARGET = 0.25;
export const MIN_DEPOSIT_ETH = 0.02;
export const MIN_FIRST_ETH = 0.08;
export const MIN_CREATE_FIRST_ETH = 0.02;
export const ETH_USD_REF = 2400;
export const MAX_NAV_DIVERGE = 0.02;
export const HOODX_SLUG = "696x";
export const TWEET = "https://x.com/696_eth/status/2100067116594725086";
