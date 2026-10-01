import { parseAbi, type Address } from "viem";

/** HOODX Automated LP (Stock LP vault V2 "autopilot"). Set `vault`/`controller` once V2 is deployed and verified. */
export const AUTO_LP = {
  slug: "autolp",
  symbol: "STKX",
  vault: "0x67D2327eA0C42Cf92C4601ebc59df0F3e9b2aa80" as Address | null, // live 2026-10-01, verified on-chain
  controller: "0x269c6ECac6ACdD8d13b748B14ee8F76CdeD26585" as Address | null,
  curator: "0x134D468B0bcaeA6DF127916f951F7938c06A37C6" as Address,
  capUsd: 10_000,
  minUsd: 10,
  perfFeePct: 10,
  stocks: ["NVDA", "META", "SPY", "SPCX", "PLTR", "BABA", "USO", "MSTR"],
} as const;

/** Retired V1 (curator-signed management). Kept so the treasury can withdraw its seed. */
export const AUTO_LP_V1 = {
  vault: "0x4d28b7e20be7d95a5876310cfe128868c53e8d0e" as Address,
  controller: "0x8e396530d6e57786b45472ca122105738805beff" as Address,
} as const;

export const stockLpVaultAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function bootstrapped() view returns (bool)",
  "function tvlCapUsdg() view returns (uint256)",
  "function minDepositUsdg() view returns (uint256)",
  "function strategy() view returns (string)",
  "function holdings() view returns ((address sleeve,address stock,uint256 sleeveShares,uint256 sleeveSupply,int24 tickLower,int24 tickUpper,int24 tick,uint128 positionLiquidity)[])",
  "function depositEth(uint256 shares,address receiver,uint256 deadline) payable returns (uint256 ethUsed)",
  "function withdrawEth(uint256 shares,address receiver,uint256 minEthOut,uint256 deadline) returns (uint256 ethOut)",
  "function exitToSleeveShares(uint256 shares,address receiver)",
]);

export const stockLpControllerAbi = parseAbi([
  "function curator() view returns (address)",
  "function sleeves() view returns (address[])",
  "function status(uint256 i) view returns (bool inRange,bool referenceAgrees,uint64 breachStart,uint64 lastSeen,bool rebandReady,int24 tick)",
  "function lastReband(uint256) view returns (uint64)",
  "function signalAll() returns (uint256 readyMask)",
  "function executeReband(uint256 i) returns (int24 lower,int24 upper)",
  "function harvest(uint256 i) returns (uint256,uint256)",
  "function compound(uint256 i) returns (uint128)",
  "function setManagementPaused(bool paused)",
]);

export const stockLpSleeveAbi = parseAbi([
  "function managementPaused() view returns (bool)",
  "function feeOwed0() view returns (uint256)",
  "function feeOwed1() view returns (uint256)",
  "function claimFees() returns (uint256,uint256)",
  "function redeem(uint256 shares,address receiver,uint256 min0,uint256 min1,uint256 deadline) returns (uint256,uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

/** Deadline inside the contracts' 5-minute window. */
export const deadline = (nowSec = Math.floor(Date.now() / 1000)) => BigInt(nowSec + 240);

/**
 * Shares to request for `amountWei`, from a probe simulation that minted `probeShares` for `probeUsedWei`.
 * Keeps `marginBps` of the amount unspent as slippage headroom (the vault refunds unused ETH).
 */
export function sizeShares(probeShares: bigint, probeUsedWei: bigint, amountWei: bigint, marginBps = 300n): bigint {
  if (probeShares <= 0n || probeUsedWei <= 0n || amountWei <= 0n) return 0n;
  return (probeShares * amountWei * (10_000n - marginBps)) / (probeUsedWei * 10_000n);
}

/** Minimum ETH out for an exit quote, `slippageBps` below the simulated amount. */
export function minOut(quotedWei: bigint, slippageBps = 150n): bigint {
  if (quotedWei <= 0n) return 0n;
  const m = (quotedWei * (10_000n - slippageBps)) / 10_000n;
  return m > 0n ? m : 1n;
}

/** Human status for one sleeve from the controller's status() view. */
export function sleeveState(s: { inRange: boolean; referenceAgrees: boolean; breachStart: bigint; rebandReady: boolean }, nowSec: number) {
  if (!s.referenceAgrees) return { label: "Price check paused", tone: "warn" as const };
  if (s.inRange) return { label: "Earning in range", tone: "good" as const };
  if (s.rebandReady) return { label: "Rebalance due", tone: "info" as const };
  if (s.breachStart > 0n) {
    const hrs = Math.max(0, Math.floor((nowSec - Number(s.breachStart)) / 3600));
    return { label: `Waiting · ${hrs}h of 24h`, tone: "info" as const };
  }
  return { label: "Maker range · waiting for price", tone: "info" as const };
}
