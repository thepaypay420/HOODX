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
  /** First block of the V2 deployment (event scans start here). */
  deployBlock: 77_213_266n,
  /** Static per-sleeve config (from deployments/stock-lp-vault-v2-live.json), in controller order. */
  sleeves: [
    { symbol: "NVDA", sleeve: "0xaAceE71743B165dA07Cb67e1516b0303C2bE1aB3", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", usdgIsToken0: true },
    { symbol: "META", sleeve: "0x5dc58931dF2751096A2A1592cDc7Ce9673461b50", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", usdgIsToken0: true },
    { symbol: "SPY", sleeve: "0x8459EbE7B2a8628410f2A15bC3F6487263516c4e", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", usdgIsToken0: false },
    { symbol: "SPCX", sleeve: "0xc1Bc64D2af27cfE28c084E0530A2FaD91eD9D09d", token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", usdgIsToken0: false },
    { symbol: "PLTR", sleeve: "0x5087B8f98e317A1167085F9c1f709E05FB5224d0", token: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", usdgIsToken0: true },
    { symbol: "BABA", sleeve: "0xc2610F562D9a6ec34114C9Dcb6938273604c800B", token: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4", usdgIsToken0: true },
    { symbol: "USO", sleeve: "0x3fA2dA43694934E1cB87f1DE8415d8cc09Ea0c8E", token: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", usdgIsToken0: true },
    { symbol: "MSTR", sleeve: "0x99aA2A30571994eeDB614DeC0932A68A6ee77303", token: "0xec262a75e413fAfD0dF80480274532C79D42da09", usdgIsToken0: true },
  ] as { symbol: string; sleeve: Address; token: Address; usdgIsToken0: boolean }[],
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
  // Vault + sleeve custom errors, so reverts decode by name (the deposit sizer depends on BelowMinimum).
  "error BelowMinimum()",
  "error CapExceeded()",
  "error Divergence()",
  "error Illiquid()",
  "error Invalid()",
  "error QuoteResult(uint256 need0, uint256 need1)",
  "error Slippage()",
  "error Stale()",
  "error Unauthorized()",
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
/** First deposit probe: ~60% of the shares `amountWei` buys at the live per-share ETH price, so the probe
 *  clears the vault minimum but never asks for more ETH than is sent. Returns 0 when the price is unknown. */
export function initialProbeShares(amountWei: bigint, perShareEth: number): bigint {
  if (amountWei <= 0n || !Number.isFinite(perShareEth) || perShareEth <= 0) return 0n;
  const perShareWei = BigInt(Math.round(perShareEth * 1e18));
  return perShareWei > 0n ? (amountWei * 6n * 10n ** 18n) / (perShareWei * 10n) : 0n;
}

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
