/* Watch rules: plain-English alerts ("tell me if ETH drops below $2,500") turned into small data rules that plain code
 * checks against live state. No model runs to evaluate them. Shared by the server (to validate) and the page (to
 * evaluate and store). Pure functions only. */

export type WatchRule =
  | { kind: "eth_price"; op: "below" | "above"; usd: number }
  | { kind: "boost_leverage"; op: "below" | "above"; x: number }
  | { kind: "boost_event"; event: "steps_aside" | "leaves_max" | "any_change" }
  | { kind: "position_value"; vault: string; op: "below" | "above"; usd: number }
  | { kind: "position_change"; vault: string; pct: number };

export type WatchState = {
  at: number;
  ethUsd: number | null;
  boost: { target: number; leverage: number } | null;
  positions: Record<string, { name: string; valueUsd: number | null }> | null;
};

/** A saved rule: the rule, a sentence for the chip, and the reading it started from (for "changes" and moves). */
export type SavedRule = { id: string; rule: WatchRule; label: string; createdAt: number; baseline?: number; firedAt?: number; firedText?: string };

const money = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function describeRule(r: WatchRule, vaultName = (s: string) => s): string {
  switch (r.kind) {
    case "eth_price": return `ETH ${r.op} ${money(r.usd)}`;
    case "boost_leverage": return `Boost leverage ${r.op} ${r.x}×`;
    case "boost_event": return r.event === "steps_aside" ? "Boost steps aside into dollars" : r.event === "leaves_max" ? "Boost drops below 2×" : "Boost leverage changes";
    case "position_value": return `${vaultName(r.vault)} ${r.op} ${money(r.usd)}`;
    case "position_change": return `${vaultName(r.vault)} ${r.pct < 0 ? "falls" : "rises"} ${Math.abs(r.pct)}%`;
  }
}

/** The number a rule compares against, read from state (null when the state does not have it yet). */
export function reading(r: WatchRule, s: WatchState): number | null {
  switch (r.kind) {
    case "eth_price": return s.ethUsd;
    case "boost_leverage": case "boost_event": return s.boost?.target ?? null;
    case "position_value": case "position_change": return s.positions?.[r.vault]?.valueUsd ?? null;
  }
}

/** Has the rule fired? Returns a sentence for the alert, or null. `baseline` is the reading when the rule was saved. */
export function evaluate(r: WatchRule, s: WatchState, baseline?: number): string | null {
  const v = reading(r, s);
  if (v === null) return null;
  const name = "vault" in r ? s.positions?.[r.vault]?.name ?? r.vault : "";
  switch (r.kind) {
    case "eth_price": return (r.op === "below" ? v < r.usd : v > r.usd) ? `ETH is ${money(v)}, ${r.op} your ${money(r.usd)} line.` : null;
    case "boost_leverage": return (r.op === "below" ? v < r.x : v > r.x) ? `Boosted ETH's target leverage is now ${v.toFixed(2)}×, ${r.op} ${r.x}×.` : null;
    case "boost_event":
      if (r.event === "steps_aside") return v <= 0.05 ? "Boosted ETH has stepped aside into dollars." : null;
      if (r.event === "leaves_max") return v < 1.99 ? `Boosted ETH dropped below 2×, to ${v.toFixed(2)}×.` : null;
      return baseline !== undefined && Math.abs(v - baseline) >= 0.05 ? `Boosted ETH's target moved from ${baseline.toFixed(2)}× to ${v.toFixed(2)}×.` : null;
    case "position_value": return (r.op === "below" ? v < r.usd : v > r.usd) ? `Your ${name} position is ${money(v)}, ${r.op} ${money(r.usd)}.` : null;
    case "position_change": {
      if (!baseline) return null;
      const pct = ((v - baseline) / baseline) * 100;
      return (r.pct < 0 ? pct <= r.pct : pct >= r.pct) ? `Your ${name} position moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% since you started watching (${money(baseline)} → ${money(v)}).` : null;
    }
  }
}

/** Is this a well-formed rule? Rejects anything the page could not evaluate safely. */
export function validRule(x: unknown, vaults: string[]): x is WatchRule {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>, num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const op = r.op === "below" || r.op === "above";
  switch (r.kind) {
    case "eth_price": return op && num(r.usd, 1, 1_000_000);
    case "boost_leverage": return op && num(r.x, 0, 2);
    case "boost_event": return r.event === "steps_aside" || r.event === "leaves_max" || r.event === "any_change";
    case "position_value": return op && num(r.usd, 0, 100_000_000) && vaults.includes(String(r.vault));
    case "position_change": return num(r.pct, -99, 1000) && r.pct !== 0 && vaults.includes(String(r.vault));
    default: return false;
  }
}
