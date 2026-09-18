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

export type StrategyId = "equal" | "list696" | "live" | "trim";

export type Strategy = {
  id: StrategyId;
  label: string;
  hint: string;
};

export const CURATOR_STRATEGIES: Strategy[] = [
  { id: "equal", label: "Equal weight", hint: "Split risk-on evenly across every listed name." },
  { id: "list696", label: "696 sqrt book", hint: "Capped sqrt-mcap weights with a 25% cash sleeve." },
  { id: "live", label: "Match live mix", hint: "Copy what the vault holds now into targets." },
  { id: "trim", label: "Trim drift", hint: "Snap only out-of-band names to live weights; keep the rest on-chain." },
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

/** When one slider moves, shrink the rest so risk-on stays within the cash floor cap. */
export function resizeSliderTargets(
  draft: TargetDraft,
  changedToken: string,
  newBps: number,
  cashTargetBps: number,
): TargetDraft {
  const cap = riskCap(cashTargetBps);
  const key = changedToken.toLowerCase();
  const clamped = Math.max(0, Math.min(cap, Math.floor(newBps)));
  const next: TargetDraft = { ...draft, [key]: clamped };
  const others = Object.keys(next).filter((k) => k !== key);
  let otherSum = others.reduce((a, k) => a + (next[k] || 0), 0);
  const room = cap - clamped;
  if (otherSum <= room || otherSum === 0) return next;
  const scale = room / otherSum;
  for (const k of others) next[k] = Math.floor((next[k] || 0) * scale);
  return next;
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
    })
    .sort((a, b) => {
      const rank = (x: DriftRow) => (x.action === "sell" || x.action === "park" ? 0 : x.action === "buy" ? 1 : 2);
      const d = rank(a) - rank(b);
      if (d) return d;
      return Math.abs(b.driftBps) - Math.abs(a.driftBps);
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
