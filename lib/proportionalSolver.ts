import {buildProportionalPlan, ceilRatio, type ProportionalSnapshot} from './proportionalPlan';

/** One complete basket simulation per iteration, never per-token polling. */
export async function solveProportionalDeposit(
  snapshot: ProportionalSnapshot,
  maxEth: bigint,
  quote: (budgets: readonly bigint[]) => Promise<readonly bigint[]>,
  now: () => number,
) {
  const active = snapshot.balances.map((b, i) => b > 0n ? i : -1).filter(i => i >= 0);
  if (snapshot.supply <= 0n || snapshot.balances.length < 2 || snapshot.balances.length > 24 || maxEth < 20n * 10n ** 15n) throw new Error('Invalid funded basket or deposit');
  for (const fee of [snapshot.creatorFeeBps, snapshot.protocolFeeBps]) if (!Number.isInteger(fee) || fee < 0 || fee > 50) throw new Error('Invalid fees');
  const net = maxEth * BigInt(10000 - snapshot.creatorFeeBps - snapshot.protocolFeeBps) / 10000n;
  if (active.length === 0) {
    if (snapshot.cash <= 0n) throw new Error('Empty basket');
    return buildProportionalPlan(snapshot, net * snapshot.supply / snapshot.cash, maxEth, [], now());
  }
  // Discovery allocation only; actual output quantities, not target weights, determine shares.
  const initialSpend = snapshot.cash > 0n ? net * 3n / 4n : net;
  let budgets = snapshot.balances.map(b => b > 0n ? initialSpend / BigInt(active.length) : 0n);
  let outputs: readonly bigint[] = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    if (now() - snapshot.timestamp > 60 || now() < snapshot.timestamp) throw new Error('Refresh basket quote');
    outputs = await quote(budgets);
    if (outputs.length !== budgets.length || outputs.some((output, i) => output < 0n || (budgets[i] > 0n && output === 0n) || (budgets[i] === 0n && output !== 0n))) throw new Error('Incomplete basket quote');
    if (iteration === 3) break;
    const costs = snapshot.balances.map((balance, i) => balance === 0n ? 0n : ceilRatio(balance, budgets[i], outputs[i]));
    const total = costs.reduce((sum, cost) => sum + cost, snapshot.cash);
    if (total === 0n) throw new Error('Empty basket');
    const next = costs.map(cost => net * cost / total);
    if (active.some(i => next[i] === 0n)) throw new Error('Deposit too small for this basket');
    // Avoid another expensive eth_call once route budgets settle within 0.1%.
    const settled = active.every(i => (next[i] > budgets[i] ? next[i] - budgets[i] : budgets[i] - next[i]) * 1000n <= budgets[i]);
    if (settled) break;
    budgets = next;
  }
  const spend = budgets.reduce((sum, amount) => sum + amount, 0n);
  if (spend > net) throw new Error('ETH budget exceeded');
  let shares = snapshot.cash === 0n ? (1n << 256n) - 1n : (net - spend) * snapshot.supply / snapshot.cash;
  for (const i of active) {
    const supported = (outputs[i] * 9700n / 10000n) * snapshot.supply / snapshot.balances[i];
    if (supported < shares) shares = supported;
  }
  return buildProportionalPlan(snapshot, shares, maxEth, active.map(index => ({index, budget: budgets[index], netOutput: outputs[index], blockNumber: snapshot.blockNumber})), now());
}
