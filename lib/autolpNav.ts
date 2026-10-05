/**
 * Automated LP NAV maths (pure). Mirrors research/autolp_nav.py, which pinned the launch baseline below.
 * Each sleeve is valued as its position + idle balances (owed performance fees excluded) at the pool price;
 * LP fees not yet collected are excluded, so NAV is slightly conservative.
 */
const Q96 = 2 ** 96;

/** Measured at the v3 seeding block with the functions below (v2 launched at 77,213,506 on 2026-10-01). */
export const AUTO_LP_LAUNCH = {
  block: 80_488_312, // v3 seeding transaction, 2026-10-05 (NAV $55.04, $6.88 per stock)
  perShareUsd: 0.9901567891797377,
  perShareEth: 0.0003646497830071709,
  ethUsd: 2715.36371423061,
} as const;

export type SleeveRead = {
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  vaultShares: bigint;
  sleeveSupply: bigint;
  bal0: bigint;
  bal1: bigint;
  owed0: bigint;
  owed1: bigint;
  usdgIsToken0: boolean;
};

const sqrtAtTick = (t: number) => Math.pow(1.0001, t / 2) * Q96;

/** Token amounts (raw, float) held by liquidity `L` in [sL, sU] at sqrt price sP. */
export function positionAmounts(L: number, sP: number, sL: number, sU: number): [number, number] {
  if (sP <= sL) return [(L * (sU - sL)) / (sL * sU) * Q96, 0];
  if (sP >= sU) return [0, (L * (sU - sL)) / Q96];
  return [(L * (sU - sP)) / (sP * sU) * Q96, (L * (sP - sL)) / Q96];
}

/** USD value of the vault's share of one sleeve (USDG has 6 decimals). */
export function sleeveValueUsd(s: SleeveRead): number {
  if (s.sleeveSupply === 0n) return 0;
  const sP = Number(s.sqrtPriceX96);
  const [a0, a1] = positionAmounts(Number(s.liquidity), sP, sqrtAtTick(s.tickLower), sqrtAtTick(s.tickUpper));
  const x0 = a0 + Number(s.bal0 - s.owed0);
  const x1 = a1 + Number(s.bal1 - s.owed1);
  const p = (sP / Q96) ** 2; // token1 per token0, raw units
  const usdgRaw = s.usdgIsToken0 ? x0 + x1 / p : x1 + x0 * p;
  return (Number(s.vaultShares) / Number(s.sleeveSupply)) * (usdgRaw / 1e6);
}

/** ETH price in USD from the native ETH / USDG pool sqrt price (ETH 18 decimals, USDG 6). */
export const ethUsdFromSqrt = (sqrtPriceX96: bigint) => (Number(sqrtPriceX96) / Q96) ** 2 * 1e12;

export function navSummary(sleeveUsd: number[], supplyWei: bigint, ethUsd: number) {
  const navUsd = sleeveUsd.reduce((a, b) => a + b, 0);
  const supply = Number(supplyWei) / 1e18;
  const perShareUsd = supply > 0 ? navUsd / supply : 0;
  const perShareEth = ethUsd > 0 ? perShareUsd / ethUsd : 0;
  return {
    navUsd, navEth: ethUsd > 0 ? navUsd / ethUsd : 0, supply, perShareUsd, perShareEth, ethUsd,
    sinceLaunchUsdPct: perShareUsd > 0 ? (perShareUsd / AUTO_LP_LAUNCH.perShareUsd - 1) * 100 : 0,
    sinceLaunchEthPct: perShareEth > 0 ? (perShareEth / AUTO_LP_LAUNCH.perShareEth - 1) * 100 : 0,
  };
}

/** Wallet P/L in ETH from vault events, like the other HOODX indexes (position + withdrawn - deposited). */
export function walletPnl(positionWei: bigint, depositedWei: bigint, withdrawnWei: bigint) {
  if (depositedWei === 0n) return undefined;
  const pnl = positionWei + withdrawnWei - depositedWei;
  return { pnlWei: pnl, pct: (Number(pnl) / Number(depositedWei)) * 100 };
}
