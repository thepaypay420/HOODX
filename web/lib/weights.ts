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

/** On-chain `setTargets` bps from the 696 capped-sqrt book. Skipped names are omitted (0). */
export function listTargetBps(
  sleeves: Sleeve[],
  listed: string[],
  navUsd: number,
  navWei: bigint,
  minSleeveWei: bigint,
  cashTargetBps = 2500,
): { who: `0x${string}`[]; bps: number[] } {
  const book = activeBook(sleeves, Math.max(navUsd, 1), MIN_SLEEVE_USD, cashTargetBps / 10_000);
  const want = new Map(book.active.map((s) => [(s.token || "").toLowerCase(), s]));
  const who: `0x${string}`[] = [];
  const bps: number[] = [];
  let used = 0;
  for (const t of listed) {
    const row = want.get(t.toLowerCase());
    let b = row ? Math.floor(row.weight * 10_000) : 0;
    if (b > 0 && navWei > 0n && (navWei * BigInt(b)) / 10_000n < minSleeveWei) b = 0;
    if (b <= 0) continue;
    who.push(t as `0x${string}`);
    bps.push(b);
    used += b;
  }
  const cap = 10_000 - cashTargetBps;
  if (used > cap && used > 0) {
    const scale = cap / used;
    for (let i = 0; i < bps.length; i++) bps[i] = Math.max(0, Math.floor(bps[i] * scale));
  }
  return { who, bps };
}
