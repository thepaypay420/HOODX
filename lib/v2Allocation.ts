export function percentBps(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Use percentages with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps > 10000) throw new Error("Percentages must be between 0 and 100.");
  return bps;
}
export function allocation(cash: string, weights: string[]) {
  const cashBps = percentBps(cash), bps = weights.map(percentBps);
  if (cashBps < 2000 || cashBps > 5000) throw new Error("Cash must be between 20% and 50%.");
  if (cashBps + bps.reduce((a, b) => a + b, 0) !== 10000) throw new Error("Targets and cash must total exactly 100%.");
  return { cashBps, weights: bps };
}
export function equalAllocation(cash: string, count: number): string[] {
  const bps = percentBps(cash);
  if (bps < 2000 || bps > 5000 || count < 1) throw new Error("Choose cash between 20% and 50% first.");
  const remaining = 10000 - bps;
  return Array.from({ length: count }, (_, i) => ((Math.floor(remaining / count) + (i < remaining % count ? 1 : 0)) / 100).toFixed(2));
}
