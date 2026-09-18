import { listTargetBps, type Sleeve } from "@/lib/weights";

/** Risk-on budget: everything not parked in WETH. */
export function riskCap(cashTargetBps: number) {
  return 10_000 - cashTargetBps;
}

export function bpsToPct(bps: number) {
  return bps / 100;
}

export function pctToBps(pct: number) {
  return Math.max(0, Math.min(10_000, Math.round(pct * 100)));
}

export type TargetDraft = Record<string, number>;

export type StrategyId = "mcap" | "equal" | "list696" | "live" | "trim" | "parkLegacy";

export type Strategy = {
  id: StrategyId;
  label: string;
  hint: string;
};

export type McapRow = {
  token: string;
  mcapUsd?: number;
  buyTvlUsd?: number;
  vol24Usd?: number;
  hops?: number;
};

const LIQ_REF_USD = 10_000;
const HOP2_HAIRCUT = 0.5;
const WEIGHT_CAP = 0.1;
const WEIGHT_FLOOR = 0.03;

export const CURATOR_STRATEGIES: Strategy[] = [
  {
    id: "mcap",
    label: "Mcap weight",
    hint: "Capped sqrt-mcap vs the rest of the book — default for targets and slider rebalance.",
  },
  { id: "list696", label: "696 list book", hint: "Fixed 696 snapshot weights (skips dead-volume names)." },
  { id: "equal", label: "Equal weight", hint: "Split risk-on evenly across every listed name." },
  { id: "live", label: "Match live mix", hint: "Copy what the vault holds now into targets." },
  { id: "trim", label: "Trim drift", hint: "Snap only out-of-band names to live weights; keep the rest on-chain." },
  {
    id: "parkLegacy",
    label: "Park legacy",
    hint: "Zero targets for 696-skipped bags (e.g. QUOTIENT) so you can sell to cash.",
  },
];

export function equalTargetBps(n: number, cashTargetBps = 2500) {
  if (n < 1) return 0;
  return Math.floor(riskCap(cashTargetBps) / n);
}

export function equalTargets(tokens: string[], cashTargetBps = 2500): TargetDraft {
  const each = equalTargetBps(tokens.length, cashTargetBps);
  const out: TargetDraft = {};
  for (const t of tokens) out[t.toLowerCase()] = each;
  return out;
}

export function liveMixTargets(rows: { token: string; liveBps: number }[], cashTargetBps = 2500): TargetDraft {
  const cap = riskCap(cashTargetBps);
  let used = rows.reduce((a, r) => a + Math.max(0, r.liveBps), 0);
  const scale = used > cap && used > 0 ? cap / used : 1;
  const out: TargetDraft = {};
  for (const r of rows) out[r.token.toLowerCase()] = Math.floor(Math.max(0, r.liveBps) * scale);
  return out;
}

/** Keep on-chain targets for in-band names; snap drifted sleeves to live weights. */
export function trimDriftTargets(
  rows: { token: string; liveBps: number; onChainTargetBps: number }[],
  cashTargetBps = 2500,
  bandBps = 200,
): TargetDraft {
  const mixed = rows.map((r) => {
    const drift = r.liveBps - r.onChainTargetBps;
    const bps = Math.abs(drift) > bandBps ? r.liveBps : r.onChainTargetBps;
    return { token: r.token, liveBps: Math.max(0, bps) };
  });
  return liveMixTargets(mixed, cashTargetBps);
}

/** Zero draft targets for legacy/skipped names that still have a bag; keep on-chain for the rest. */
export function parkLegacyTargets(
  rows: { token: string; balanceWei: bigint; onChainTargetBps: number; legacy?: boolean }[],
  cashTargetBps = 2500,
): TargetDraft {
  const out: TargetDraft = {};
  for (const r of rows) {
    if (r.legacy && r.balanceWei > 0n) out[r.token.toLowerCase()] = 0;
    else out[r.token.toLowerCase()] = r.onChainTargetBps;
  }
  return out;
}

export function draftFromOnChain(tokens: string[], targetBps: Map<string, number>): TargetDraft {
  const out: TargetDraft = {};
  for (const t of tokens) out[t.toLowerCase()] = targetBps.get(t.toLowerCase()) || 0;
  return out;
}

export function list696Targets(
  sleeves: Sleeve[],
  tokens: string[],
  navUsd: number,
  navWei: bigint,
  minSleeveWei: bigint,
  cashTargetBps: number,
): TargetDraft {
  const { who, bps } = listTargetBps(sleeves, tokens, navUsd, navWei, minSleeveWei, cashTargetBps);
  const out: TargetDraft = {};
  who.forEach((t, i) => {
    out[t.toLowerCase()] = bps[i];
  });
  return out;
}

/** Sqrt-mcap score with liquidity + hop haircuts (matches weights.py). */
export function mcapScore(row: McapRow): number {
  const mc = row.mcapUsd || 0;
  if (mc <= 0) return 0;
  const tvl = row.buyTvlUsd || LIQ_REF_USD;
  const liq = Math.min(1, tvl / LIQ_REF_USD);
  const hop = (row.hops || 1) >= 2 ? HOP2_HAIRCUT : 1;
  return Math.sqrt(mc) * liq * hop;
}

function renormalizeWeights(w: Record<string, number>): Record<string, number> {
  const keys = Object.keys(w);
  const sum = keys.reduce((a, k) => a + w[k], 0);
  if (sum <= 0) {
    const eq = keys.length ? 1 / keys.length : 0;
    return Object.fromEntries(keys.map((k) => [k, eq]));
  }
  return Object.fromEntries(keys.map((k) => [k, w[k] / sum]));
}

/** Capped sqrt-mcap weights for whatever is on the vault book. */
export function capFloorWeights(raw: Record<string, number>, cap = WEIGHT_CAP, floor = WEIGHT_FLOOR) {
  const names = Object.keys(raw);
  const n = names.length;
  if (!n) return {};
  const capUse = Math.max(cap, 1 / n);
  let floorUse = Math.min(floor, 0.99 / n);
  if (floorUse * n > 1 - 1e-9) floorUse = 0;
  let w = renormalizeWeights({ ...raw });
  for (let pass = 0; pass < 8; pass++) {
    let overflow = 0;
    const flex: string[] = [];
    for (const k of names) {
      if (w[k] > capUse + 1e-12) {
        overflow += w[k] - capUse;
        w[k] = capUse;
      } else if (w[k] < capUse - 1e-9) flex.push(k);
    }
    if (overflow > 0 && flex.length) {
      const room = flex.reduce((a, k) => a + Math.max(0, capUse - w[k]), 0);
      if (room > 0) {
        for (const k of flex) w[k] += (overflow * Math.max(0, capUse - w[k])) / room;
      }
    }
    w = renormalizeWeights(w);
    let deficit = 0;
    const donors: string[] = [];
    for (const k of names) {
      if (w[k] + 1e-12 < floorUse) {
        deficit += floorUse - w[k];
        w[k] = floorUse;
      } else if (w[k] > floorUse + 1e-9) donors.push(k);
    }
    if (deficit > 0 && donors.length) {
      const pool = donors.reduce((a, k) => a + Math.max(0, w[k] - floorUse), 0);
      if (pool > 0) {
        const take = Math.min(deficit, pool);
        for (const k of donors) {
          const share = Math.max(0, w[k] - floorUse) / pool;
          w[k] -= take * share;
        }
      }
    }
    w = renormalizeWeights(w);
    if (names.every((k) => w[k] >= floorUse - 1e-9 && w[k] <= capUse + 1e-12)) break;
  }
  return w;
}

export function vaultMcapTargets(rows: McapRow[], cashTargetBps = 2500): TargetDraft {
  const tokens = rows.map((r) => r.token.toLowerCase());
  const scored = rows.filter((r) => mcapScore(r) > 0);
  if (!scored.length) return equalTargets(tokens, cashTargetBps);
  const raw: Record<string, number> = {};
  const sum = scored.reduce((a, r) => a + mcapScore(r), 0);
  for (const r of scored) raw[r.token.toLowerCase()] = mcapScore(r) / sum;
  const capped = capFloorWeights(raw);
  const budget = riskCap(cashTargetBps);
  const out: TargetDraft = {};
  for (const t of tokens) out[t] = 0;
  let used = 0;
  for (const [t, w] of Object.entries(capped)) {
    const bps = Math.floor(w * budget);
    out[t] = bps;
    used += bps;
  }
  if (used > budget && used > 0) {
    const scale = budget / used;
    for (const t of tokens) out[t] = Math.floor((out[t] || 0) * scale);
  }
  return out;
}

function distributeBpsByMcap(
  tokens: string[],
  totalBps: number,
  locked: Map<string, number>,
  mcapRows: McapRow[],
): TargetDraft {
  const scores = new Map(mcapRows.map((r) => [r.token.toLowerCase(), mcapScore(r)]));
  const out: TargetDraft = {};
  let lockedSum = 0;
  for (const [k, v] of locked) {
    out[k] = v;
    lockedSum += v;
  }
  const room = Math.max(0, totalBps - lockedSum);
  const free = tokens.map((t) => t.toLowerCase()).filter((t) => !locked.has(t));
  const scored = free.filter((t) => (scores.get(t) || 0) > 0);
  for (const t of free.filter((t) => !scored.includes(t))) out[t] = 0;
  const sum = scored.reduce((a, t) => a + (scores.get(t) || 0), 0);
  if (room <= 0 || sum <= 0) {
    for (const t of scored) out[t] = 0;
    return out;
  }
  for (const t of scored) out[t] = Math.floor((room * (scores.get(t) || 0)) / sum);
  let used = Object.values(out).reduce((a, b) => a + (b || 0), 0);
  const remainder = totalBps - used;
  if (remainder > 0 && scored.length) {
    const top = [...scored].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0))[0];
    out[top] = (out[top] || 0) + remainder;
  }
  return out;
}

/** When one slider moves, reallocate the rest by sqrt-mcap vs the book. */
export function resizeSliderTargets(
  draft: TargetDraft,
  changedToken: string,
  newBps: number,
  cashTargetBps: number,
  mcapRows: McapRow[],
): TargetDraft {
  const cap = riskCap(cashTargetBps);
  const key = changedToken.toLowerCase();
  const clamped = Math.max(0, Math.min(cap, Math.floor(newBps)));
  const tokens = Object.keys(draft);
  if (clamped === 0) {
    return distributeBpsByMcap(tokens, cap, new Map(), mcapRows);
  }
  return distributeBpsByMcap(tokens, cap, new Map([[key, clamped]]), mcapRows);
}

export function draftTotals(draft: TargetDraft, cashTargetBps: number) {
  const riskOn = Object.values(draft).reduce((a, b) => a + (b || 0), 0);
  const cap = riskCap(cashTargetBps);
  return {
    riskOnBps: riskOn,
    riskOnPct: bpsToPct(riskOn),
    cashBps: 10_000 - riskOn,
    cashPct: bpsToPct(10_000 - riskOn),
    cap,
    over: Math.max(0, riskOn - cap),
    room: Math.max(0, cap - riskOn),
  };
}

export function normalizeDraft(
  draft: TargetDraft,
  tokens: string[],
  navWei: bigint,
  minSleeveWei: bigint,
  cashTargetBps: number,
): { who: `0x${string}`[]; bps: number[]; errors: string[] } {
  const cap = riskCap(cashTargetBps);
  const errors: string[] = [];
  let entries = tokens
    .map((t) => ({
      token: t as `0x${string}`,
      bps: Math.floor(draft[t.toLowerCase()] || 0),
    }))
    .filter((e) => {
      if (e.bps <= 0) return false;
      if (navWei > 0n && (navWei * BigInt(e.bps)) / 10_000n < minSleeveWei) {
        errors.push(`Below ~$10 sleeve at ${bpsToPct(e.bps).toFixed(2)}%`);
        return false;
      }
      return true;
    });

  let used = entries.reduce((a, e) => a + e.bps, 0);
  if (used > cap && used > 0) {
    const scale = cap / used;
    entries = entries.map((e) => ({ ...e, bps: Math.floor(e.bps * scale) }));
    used = entries.reduce((a, e) => a + e.bps, 0);
  }

  const active = entries.filter((e) => e.bps > 0);
  if (active.length < 2) errors.push("Need at least 2 names above the sleeve floor");
  if (used > cap) errors.push(`Risk-on ${bpsToPct(used).toFixed(1)}% exceeds the ${bpsToPct(cap).toFixed(0)}% cap`);

  return {
    who: active.map((e) => e.token),
    bps: active.map((e) => e.bps),
    errors,
  };
}

export type DriftRow = {
  token: string;
  symbol: string;
  liveBps: number;
  targetBps: number;
  draftBps: number;
  driftBps: number;
  valueEth: number;
  valueUsd: number;
  markDelta: number | null;
  plVsTargetEth: number;
  plVsTargetUsd: number;
  action: "buy" | "sell" | "hold" | "park";
  swapEth: number;
};

export function analyzeDrift(
  rows: {
    token: string;
    symbol: string;
    balanceWei: bigint;
    wethValueWei: bigint;
    onChainTargetBps: number;
    draftBps: number;
    lastPxWad: bigint;
    currentPxWad: bigint;
  }[],
  navWei: bigint,
  ethUsd: number,
  bandBps = 200,
): DriftRow[] {
  if (navWei <= 0n) return [];
  return rows
    .map((r) => {
      const liveBps = Number((r.wethValueWei * 10_000n) / navWei);
      const draftBps = r.draftBps;
      const driftBps = liveBps - draftBps;
      const valueEth = Number(r.wethValueWei) / 1e18;
      const valueUsd = valueEth * ethUsd;
      const targetValEth = (Number(navWei) * draftBps) / 10_000 / 1e18;
      const plVsTargetEth = valueEth - targetValEth;
      const plVsTargetUsd = plVsTargetEth * ethUsd;
      const markDelta =
        r.lastPxWad > 0n && r.currentPxWad > 0n
          ? Number(r.currentPxWad - r.lastPxWad) / Number(r.lastPxWad)
          : null;
      let action: DriftRow["action"] = "hold";
      if (draftBps === 0 && r.balanceWei > 0n) action = "park";
      else if (driftBps < -bandBps) action = "buy";
      else if (driftBps > bandBps && r.balanceWei > 0n) action = "sell";
      const swapEth = Math.abs(plVsTargetEth);
      return {
        token: r.token,
        symbol: r.symbol,
        liveBps,
        targetBps: r.onChainTargetBps,
        draftBps,
        driftBps,
        valueEth,
        valueUsd,
        markDelta,
        plVsTargetEth,
        plVsTargetUsd,
        action,
        swapEth,
      };
    });
}

export function suggestSwapWei(row: DriftRow, navWei: bigint, maxFraction = 0.85): bigint {
  if (row.action === "hold") return 0n;
  const wei = BigInt(Math.floor(row.swapEth * 1e18 * maxFraction));
  if (row.action === "sell" || row.action === "park") return wei;
  // buy: cap by drift need
  const need = (navWei * BigInt(Math.abs(row.driftBps))) / 10_000n;
  return need > wei ? wei : need;
}
