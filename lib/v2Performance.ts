export function launchReturnBps(assets: bigint, supply: bigint): bigint | undefined {
  if (supply === 0n) return undefined;
  // V2 genesis mint price is 0.04 ETH/share; use actual NAV/share, not total TVL growth.
  return assets * 10n ** 18n * 10000n / (supply * 40000000000000000n) - 10000n;
}
export function walletReturn(assets: bigint, supply: bigint, shares: bigint, deposited: bigint, withdrawn: bigint) {
  if (deposited === 0n) return undefined;
  const position = supply === 0n ? 0n : assets * shares / supply;
  const pnl = position + withdrawn - deposited;
  return { pnl, bps: pnl * 10000n / deposited, position };
}
