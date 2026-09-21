/** Preserve exact share quantities and round protection down only in wei. */
export function withdrawalFloor(assets: bigint, shares: bigint, supply: bigint, percent: number) {
  if (supply <= 0n || shares <= 0n || assets <= 0n || !Number.isInteger(percent) || percent < 1 || percent > 100) return { selected: 0n, floor: 0n };
  const selected = shares * BigInt(percent) / 100n;
  return { selected, floor: assets * selected / supply * 99n / 100n };
}
