import { CASH_TARGET, MIN_SLEEVE_USD } from "./config";

export type Sleeve = {
  id: string;
  symbol?: string;
  token?: string;
  weight: number;
  hops?: number;
  buyTvlUsd?: number;
  buyDex?: string;
  buyQuote?: string;
};

export type ActiveRow = Sleeve & {
  policyWeight: number;
  policyUsd: number;
  usd: number;
  reason?: string;
};

export type ActiveBook = {
  navUsd: number;
  minSleeveUsd: number;
  cashTarget: number;
  cashWeight: number;
  cashUsd: number;
  nActive: number;
  nSkipped: number;
  scaledForCash: boolean;
  active: ActiveRow[];
  skipped: ActiveRow[];
  activeWeightSum: number;
};

/** Same rule as rh-index/weights.py active_book. */
export function activeBook(
  sleeves: Sleeve[],
  navUsd: number,
  minSleeveUsd = MIN_SLEEVE_USD,
  cashTarget = CASH_TARGET,
): ActiveBook {
  const held: ActiveRow[] = [];
  const skipped: ActiveRow[] = [];
  for (const s of sleeves) {
    const policyWeight = Number(s.weight) || 0;
    const policyUsd = navUsd * policyWeight;
    const row: ActiveRow = { ...s, policyWeight, policyUsd, usd: policyUsd, weight: policyWeight };
    if (minSleeveUsd > 0 && policyUsd < minSleeveUsd - 1e-12) {
      skipped.push({ ...row, weight: 0, usd: 0, reason: "below_floor" });
    } else {
      held.push(row);
    }
  }
  let heldW = held.reduce((a, s) => a + s.weight, 0);
  let cashW = 1 - heldW;
  let scaledForCash = false;
  if (held.length && cashW < cashTarget - 1e-12) {
    const scale = (1 - cashTarget) / heldW;
    for (const s of held) {
      s.weight *= scale;
      s.usd = navUsd * s.weight;
    }
    cashW = cashTarget;
    scaledForCash = true;
    heldW = 1 - cashW;
  }
  return {
    navUsd,
    minSleeveUsd,
    cashTarget,
    cashWeight: cashW,
    cashUsd: navUsd * cashW,
    nActive: held.length,
    nSkipped: skipped.length,
    scaledForCash,
    active: held,
    skipped,
    activeWeightSum: heldW,
  };
}

export function issueSplit(wei: bigint, bps = 50n): { net: bigint; fee: bigint } {
  const fee = (wei * bps) / 10_000n;
  return { net: wei - fee, fee };
}
