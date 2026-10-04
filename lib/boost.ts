import { parseAbi, type Address } from "viem";

const envAddr = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null);

/** HOODX Boosted ETH (HoodxBoostVaultV1 + HoodxBoostSignalV1), live since 2026-10-04 (deployments/boost-eth-v1-live.json).
 *  The env variables only override the deployed addresses (e.g. for a local fork rehearsal). */
export const BOOST = {
  slug: "boost",
  name: "Boosted ETH",
  symbol: "BOOSTX",
  vault: envAddr(process.env.NEXT_PUBLIC_BOOST_VAULT) ?? ("0x5e0135C3592095592C4B43d84c817c26A0F43515" as Address),
  signal: envAddr(process.env.NEXT_PUBLIC_BOOST_SIGNAL) ?? ("0x53569D741Abd674dA942D0Af660684953193b232" as Address),
  curator: "0x134D468B0bcaeA6DF127916f951F7938c06A37C6" as Address,
  deployBlock: BigInt(process.env.NEXT_PUBLIC_BOOST_DEPLOY_BLOCK ?? "79671870"),
  capUsd: 1_000_000,
  minDepositEth: 0.005,
  maxLeverage: 2,
  accent: "#ff9a3c",
  morpho: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010" as Address,
  pool: "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca" as Address,
  cash: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd" as Address,
  ethFeed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as Address,
  btcFeed: "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251" as Address,
};

export const boostVaultAbi = parseAbi([
  "function deposit(address receiver, uint256 minShares, uint256 deadline) payable returns (uint256 shares)",
  "function withdraw(uint256 shares, address receiver, uint256 minEthOut, uint256 deadline) returns (uint256 ethOut)",
  "function exitInKind(uint256 shares, address receiver) returns (uint256 wethOut, uint256 cashOut, uint256 repaid)",
  "function previewExitInKind(uint256 shares) view returns (uint256 wethOut, uint256 usdgToApprove, uint256 cashSharesOut, uint256 usdgOut)",
  "function rebalance() returns (uint256 leverageAfter)",
  "function crystalliseFees() returns (uint256 feeShares)",
  "function setDepositsPaused(bool paused)",
  "function acceptOwnership()",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function navPerShare() view returns (uint256)",
  "function highWaterMark() view returns (uint256)",
  "function launchEthPrice() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function lastRebalance() view returns (uint64)",
  "function lastFeeTime() view returns (uint64)",
  "function tvlCapUsdg() view returns (uint256)",
  "function rebalanceStatus() view returns (bool ready, bool emergency, uint256 leverage, uint256 target, bool fresh)",
  "function state() view returns ((uint256 price, uint256 collateral, uint256 borrowShares, uint256 debt, uint256 cashShares, uint256 cashUsdg, uint256 idleUsdg, uint256 idleWeth, uint256 nav, uint256 leverage))",
  "event Deposited(address indexed account, address indexed receiver, uint256 ethIn, uint256 shares, uint256 navAddedUsdg)",
  "event Withdrawn(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut)",
  "event Bootstrapped(address indexed receiver, uint256 shares, uint256 ethIn, uint256 navUsdg)",
  "event Rebalanced(uint256 leverageBefore, uint256 target, uint256 leverageAfter, int256 exposureChangeUsdg, bool emergency, address indexed by)",
]);

export const boostSignalAbi = parseAbi([
  "function poke() returns (uint256)",
  "function target() view returns (uint256)",
  "function sigma() view returns (uint256)",
  "function isFresh() view returns (bool)",
  "function lastHour() view returns (uint256)",
  "function snapshot() view returns (uint256 target, uint256 sigma, uint8 ethFlags, uint8 btcFlags, uint128[8] ethEma, uint128[8] btcEma, uint256 ethLast, uint256 lastHour)",
]);

/** Leverage regime names used across the UI. */
export function regime(lev: number): { key: "dollars" | "partial" | "eth" | "boost"; label: string } {
  if (lev < 0.15) return { key: "dollars", label: "In dollars" };
  if (lev < 0.9) return { key: "partial", label: "Partly in ETH" };
  if (lev <= 1.1) return { key: "eth", label: "Holding ETH" };
  return { key: "boost", label: "Boosted" };
}

/** Research numbers (docs/SMART-ETH-HIGH-VARIANT-2026-10-04.md; research/boost). All costs included. */
export const BOOST_BACKTEST = {
  years: [
    { y: 2019, vault: 17, eth: -2 }, { y: 2020, vault: 989, eth: 475 }, { y: 2021, vault: 771, eth: 400 },
    { y: 2022, vault: -16, eth: -68 }, { y: 2023, vault: 57, eth: 91 }, { y: 2024, vault: 88, eth: 45 },
    { y: 2025, vault: 35, eth: -12 }, { y: 2026, vault: 8, eth: -9 },
  ],
  test: { vault: 32, eth: -7, vaultDd: -62, ethDd: -77 },
  monteCarlo: { median: 141, p10: 12, beatEth: 88, lossChance: 7 },
  compounded: { vault: 403, eth: 20 },
};

export const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 240);
/** 1% below a simulated output, the user's slippage bound. */
export const minOut = (x: bigint) => (x * 99n) / 100n;
