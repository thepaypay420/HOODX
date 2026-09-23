export function basketHoldReturnBps(
  cashBps: number,
  weightsBps: number[],
  launchPrices: bigint[],
  currentPrices: bigint[],
): bigint | undefined {
  if (
    cashBps < 0 || cashBps > 10_000 || weightsBps.length !== launchPrices.length
    || launchPrices.length !== currentPrices.length
  ) return undefined;
  const total = cashBps + weightsBps.reduce((a, b) => a + b, 0);
  if (total !== 10_000 || launchPrices.some((p) => p <= 0n) || currentPrices.some((p) => p <= 0n)) return undefined;
  const WAD = 10n ** 18n;
  let ending = BigInt(cashBps) * WAD;
  for (let i = 0; i < weightsBps.length; i++) {
    ending += BigInt(weightsBps[i]) * currentPrices[i] * WAD / launchPrices[i];
  }
  return ending / WAD - 10_000n;
}

export function excessReturnBps(vaultReturn?: bigint, basketReturn?: bigint): bigint | undefined {
  return vaultReturn === undefined || basketReturn === undefined ? undefined : vaultReturn - basketReturn;
}

export function basketHoldReturnFromValue(initialNet: bigint, currentValue: bigint): bigint | undefined {
  if (initialNet <= 0n || currentValue < 0n) return undefined;
  return currentValue * 10_000n / initialNet - 10_000n;
}
