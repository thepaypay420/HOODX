/** Transaction-plan arithmetic for the opt-in proportional candidate; never used by V2. */
export type ProportionalSnapshot = {
  supply: bigint; cash: bigint; balances: readonly bigint[];
  nonce: bigint; blockNumber: bigint; timestamp: number;
  creatorFeeBps: number; protocolFeeBps: number;
};
export type ProportionalBuyQuote = {
  index: number; budget: bigint; netOutput: bigint; blockNumber: bigint;
};
const MIN_SHARES = 10n ** 12n;
const MIN_DEPOSIT = 20n * 10n ** 15n;
const MAX_UINT256 = (1n << 256n) - 1n;
const checkUint = (v: bigint) => { if (v < 0n || v > MAX_UINT256) throw new Error('Invalid amount'); };
export function ceilRatio(value: bigint, numerator: bigint, denominator: bigint): bigint {
  checkUint(value); checkUint(numerator); checkUint(denominator);
  if (denominator === 0n) throw new Error('Empty basket');
  const result = (value * numerator + denominator - 1n) / denominator;
  checkUint(result); return result;
}
export function proportionalRequirements(snapshot: ProportionalSnapshot, shares: bigint) {
  if (shares < MIN_SHARES || snapshot.balances.length < 2 || snapshot.balances.length > 24) throw new Error('Invalid basket or shares');
  checkUint(snapshot.supply); checkUint(shares);
  checkUint(snapshot.supply + shares);
  return {cash: ceilRatio(snapshot.cash, shares, snapshot.supply), amounts: snapshot.balances.map(b => ceilRatio(b, shares, snapshot.supply))};
}
/** Quotes must be net of reviewed fees/taxes and pinned to the supplied snapshot block. */
export function buildProportionalPlan(snapshot: ProportionalSnapshot, shares: bigint, maxEth: bigint, quotes: readonly ProportionalBuyQuote[], now: number) {
  checkUint(maxEth); checkUint(snapshot.nonce); checkUint(snapshot.blockNumber);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(snapshot.timestamp) || snapshot.timestamp > now || now - snapshot.timestamp > 60) throw new Error('Refresh basket quote');
  for (const fee of [snapshot.creatorFeeBps, snapshot.protocolFeeBps]) if (!Number.isInteger(fee) || fee < 0 || fee > 50) throw new Error('Invalid fees');
  if (maxEth < MIN_DEPOSIT) throw new Error('Minimum deposit is 0.02 ETH');
  const required = proportionalRequirements(snapshot, shares);
  const budgets = snapshot.balances.map(() => 0n), floors = [...budgets];
  const seen = new Set<number>();
  for (const quote of quotes) {
    const i = quote.index;
    if (!Number.isInteger(i) || i < 0 || i >= budgets.length || seen.has(i) || required.amounts[i] === 0n || quote.blockNumber !== snapshot.blockNumber) throw new Error('Mismatched route quote');
    checkUint(quote.budget); checkUint(quote.netOutput);
    if (quote.budget === 0n || quote.netOutput < required.amounts[i]) throw new Error('Quote cannot fund requested shares');
    seen.add(i); budgets[i] = quote.budget;
    const quotedFloor = quote.netOutput * 9700n / 10000n;
    floors[i] = quotedFloor > required.amounts[i] ? quotedFloor : required.amounts[i];
  }
  if (required.amounts.some((amount, i) => amount > 0n && !seen.has(i))) throw new Error('Missing route quote');
  const netSpent = budgets.reduce((sum, value) => sum + value, required.cash);
  const grossSpent = ceilRatio(netSpent, 10000n, BigInt(10000 - snapshot.creatorFeeBps - snapshot.protocolFeeBps));
  if (grossSpent === 0n || grossSpent > maxEth) throw new Error('ETH budget exceeded');
  return {shares, budgets, floors, nonce: snapshot.nonce, deadline: BigInt(now + 180), value: maxEth,
    grossSpent, fee: grossSpent - netSpent, ethRefund: maxEth - grossSpent,
    surplusTokens: required.amounts.map((amount, i) => (quotes.find(q => q.index === i)?.netOutput ?? 0n) - amount)};
}

export type ProportionalSellQuote = {
  index: number; amount: bigint; netEthOutput: bigint; blockNumber: bigint;
};
/** Sell only the selected holder's quantities; fees/taxes must already be reflected in net quotes. */
export function buildProportionalWithdrawal(snapshot: ProportionalSnapshot, shares: bigint, walletShares: bigint, quotes: readonly ProportionalSellQuote[], now: number) {
  checkUint(shares); checkUint(walletShares); checkUint(snapshot.supply);
  checkUint(snapshot.cash); checkUint(snapshot.nonce); checkUint(snapshot.blockNumber);
  if (shares === 0n || shares > walletShares || walletShares > snapshot.supply || snapshot.balances.length < 2 || snapshot.balances.length > 24) throw new Error('Invalid withdrawal');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(snapshot.timestamp) || snapshot.timestamp > now || now - snapshot.timestamp > 60) throw new Error('Refresh basket quote');
  const amounts = snapshot.balances.map(balance => { checkUint(balance); return balance * shares / snapshot.supply; });
  const cash = snapshot.cash * shares / snapshot.supply;
  const floors = amounts.map(() => 0n), seen = new Set<number>();
  let quotedEth = cash;
  for (const quote of quotes) {
    const i = quote.index;
    if (!Number.isInteger(i) || i < 0 || i >= amounts.length || seen.has(i) || amounts[i] === 0n || quote.amount !== amounts[i] || quote.blockNumber !== snapshot.blockNumber) throw new Error('Mismatched sale quote');
    checkUint(quote.netEthOutput);
    floors[i] = quote.netEthOutput * 9700n / 10000n;
    if (floors[i] === 0n) throw new Error('Sale output too small');
    seen.add(i); quotedEth += quote.netEthOutput;
  }
  if (amounts.some((amount, i) => amount > 0n && !seen.has(i))) throw new Error('Missing sale quote');
  const minEthOut = floors.reduce((sum, floor) => sum + floor, cash);
  checkUint(quotedEth); checkUint(minEthOut);
  if (minEthOut === 0n) throw new Error('Withdrawal output too small');
  return {shares, amounts, floors, minEthOut, quotedEth, nonce: snapshot.nonce, deadline: BigInt(now + 180)};
}
