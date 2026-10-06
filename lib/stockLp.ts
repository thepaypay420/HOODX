import { parseAbi, type Address } from "viem";

/** HOODX Automated LP ("Hands-free LP"), v3 since 2026-10-05: the reviewed V2 autopilot contracts with higher-fee pools,
 *  about ±2% ranges and a 15-minute re-placement rule (deployments/stock-lp-vault-v3-live.json). */
export const AUTO_LP = {
  slug: "autolp",
  symbol: "STKX",
  vault: "0xB064d074Ff141A68771AF32c3EAB9Dd3c9379f6D" as Address | null, // live 2026-10-05, verified on-chain
  controller: "0x5E58B414f0200Af135F27Ff0f7e490B7FDeDA0F7" as Address | null,
  curator: "0x134D468B0bcaeA6DF127916f951F7938c06A37C6" as Address,
  capUsd: 10_000,
  minUsd: 10,
  perfFeePct: 10,
  /** The autopilot rule, as shown on the page (manifest: halfWidthTicks ~ ±2%, breachDelaySeconds). */
  bandLabel: "±2%",
  breachDelaySec: 900,
  stocks: ["PLTR", "SNDK", "MU", "DELL", "MSFT", "AAPL", "USO", "SPCX"],
  /** First block of the v3 deployment (event scans start here). */
  deployBlock: 80_488_143n,
  /** Static per-sleeve config (from deployments/stock-lp-vault-v3-live.json), in controller order. */
  sleeves: [
    { symbol: "PLTR", sleeve: "0x047a7F8F301Ede7b7e05645bD82DCDF3fCa089d7", token: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", usdgIsToken0: true, tickSpacing: 15, makerWidth: 195 },
    { symbol: "SNDK", sleeve: "0x45985F6C41F02c5806a160D3dd8A9b91B921B1f2", token: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", usdgIsToken0: true, tickSpacing: 200, makerWidth: 200 },
    { symbol: "MU", sleeve: "0x21e10Ae4258B77334d8776111354ce737F2b7567", token: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", usdgIsToken0: true, tickSpacing: 200, makerWidth: 200 },
    { symbol: "DELL", sleeve: "0x892998cA14360a34C6edAFF6e4ED18aBDA3BfD7d", token: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", usdgIsToken0: true, tickSpacing: 25, makerWidth: 200 },
    { symbol: "MSFT", sleeve: "0x84E7959Ce268a7Fcb6BC27d7576DE82d64aF97E6", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", usdgIsToken0: true, tickSpacing: 60, makerWidth: 180 },
    { symbol: "AAPL", sleeve: "0xC6a49A0e6ab5daEaccBCb2B43c5b703Cf2730001", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", usdgIsToken0: true, tickSpacing: 60, makerWidth: 180 },
    { symbol: "USO", sleeve: "0xd2d5D8a4f9E47a6990f162C5fC0396993B2D88b9", token: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", usdgIsToken0: true, tickSpacing: 15, makerWidth: 195 },
    { symbol: "SPCX", sleeve: "0xfefb2fbA692Fa01a7882353243E28F9bb1D2C133", token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", usdgIsToken0: false, tickSpacing: 60, makerWidth: 180 },
  ] as { symbol: string; sleeve: Address; token: Address; usdgIsToken0: boolean; tickSpacing: number; makerWidth: number }[],
} as const;

/** Retired V2 (2026-10-01 .. 10-05: cheaper pools, ±1%, 24 h rule). Exit-only; only the treasury holds shares. */
export const AUTO_LP_V2 = {
  vault: "0x67D2327eA0C42Cf92C4601ebc59df0F3e9b2aa80" as Address,
  controller: "0x269c6ECac6ACdD8d13b748B14ee8F76CdeD26585" as Address,
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

/** The range HoodxStockLpControllerV2.executeReband would move an out-of-range sleeve to, or null when the move would be a
 *  no-op (the contract refuses a new range equal to the current one): the sleeve already sits in the band beside the
 *  price, and moves once the price clears the next tick-spacing step. Mirrors the contract's floor-to-spacing rule. */
export function nextBand(s: { tick: number; tickLower: number; tickUpper: number; tickSpacing: number; makerWidth: number }): [number, number] | null {
  const floor = (t: number, sp: number) => { const c = Math.trunc(t / sp) * sp; return t < 0 && t % sp !== 0 ? c - sp : c; };
  let lower: number, upper: number;
  if (s.tick >= s.tickUpper) { upper = floor(s.tick, s.tickSpacing); if (upper > s.tick) upper -= s.tickSpacing; lower = upper - s.makerWidth; }
  else if (s.tick < s.tickLower) { lower = floor(s.tick, s.tickSpacing) + s.tickSpacing; upper = lower + s.makerWidth; }
  else return null;
  return lower === s.tickLower && upper === s.tickUpper ? null : [lower, upper];
}

/** Human status for one sleeve from the controller's status() view. */
export function sleeveState(s: { inRange: boolean; referenceAgrees: boolean; breachStart: bigint; rebandReady: boolean; atEdge?: boolean }, nowSec: number) {
  if (!s.referenceAgrees) return { label: "Price check paused", tone: "warn" as const };
  if (s.inRange) return { label: "Earning in range", tone: "good" as const };
  if (s.rebandReady && s.atEdge) return { label: "At the band edge", tone: "info" as const };
  if (s.rebandReady) return { label: "Rebalance due", tone: "info" as const };
  if (s.breachStart > 0n) {
    const left = Math.ceil((AUTO_LP.breachDelaySec - (nowSec - Number(s.breachStart))) / 60);
    return { label: left > 0 ? `Out of range · ${left} min to rebalance` : "At the band edge", tone: "info" as const };
  }
  return { label: "Maker range · waiting for price", tone: "info" as const };
}
