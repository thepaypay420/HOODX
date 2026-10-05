/* The referee between the model and money. The model proposes an action (which vault, how much); this file checks the
 * proposal against what the user literally typed, using understand.ts and no model. Anything that does not match exactly
 * becomes a question back to the user, never a transaction. Pure functions: unit-tested in guard.test.ts. */
import { parseEther } from "viem";
import { amountMentions, canonDecimal, meansCurrentVault, vaultMentions, type AmountMention, type VaultRef } from "./understand";

export type DepositIntent = { vault: string; amount_eth?: string; amount_usd?: string; percent_of_wallet?: number };
export type WithdrawIntent = { vault: string; percent?: number; amount_eth?: string };
export type Clarify = { decision: "clarify"; question: string; options: string[] };
export type Approved<T> = { decision: "ok"; vault: string } & T;

/** Hard ceilings, whatever the user or the model says. */
export const LIMITS = {
  maxDepositEth: Number(process.env.AGENT_MAX_DEPOSIT_ETH || 5),
};

/** The user's words that count for this action: the newest message wins; earlier ones fill in only what it leaves out. */
export function context(userMessages: string[], vaults: VaultRef[]) {
  const recent = userMessages.slice(-3).filter(Boolean);
  const latest = recent[recent.length - 1] ?? "";
  const pick = <T,>(f: (m: string) => T[]): T[] => { for (let i = recent.length - 1; i >= 0; i--) { const r = f(recent[i]); if (r.length) return r; } return []; };
  const mentions = pick((m) => vaultMentions(m, vaults).slugs);
  const ambiguous = vaultMentions(latest, vaults).ambiguous;
  const amounts = pick((m) => amountMentions(m, vaults));
  const deictic = recent.some(meansCurrentVault);
  return { latest, mentions, ambiguous, amounts, deictic };
}

const nameOf = (slug: string, vaults: VaultRef[]) => { const v = vaults.find((x) => x.slug === slug); return v ? `${v.name} ($${v.ticker})` : slug; };
const clarify = (question: string, options: string[] = []): Clarify => ({ decision: "clarify", question, options });

/** Which vault the action may use. The model's choice must be a vault the user named, or the one on screen when they
 *  named none ("put 0.1 in" on the Boosted ETH page). */
export function checkVault(chosen: string, ctx: ReturnType<typeof context>, vaults: VaultRef[], pageVault?: string): string | Clarify {
  const slug = chosen.trim().toLowerCase().replace(/^\$/, "");
  const known = vaults.find((v) => v.slug === slug || v.ticker.toLowerCase() === slug);
  if (ctx.mentions.length === 0 && ctx.ambiguous.length) {
    const c = ctx.ambiguous[0].candidates;
    return clarify(`Which vault do you mean by "${ctx.ambiguous[0].word}"?`, c.map((s) => nameOf(s, vaults)));
  }
  if (!known) {
    if (ctx.mentions.length === 1) return clarify(`Did you mean ${nameOf(ctx.mentions[0], vaults)}?`, [nameOf(ctx.mentions[0], vaults)]);
    return clarify("Which vault should this go to?", ctx.mentions.map((s) => nameOf(s, vaults)));
  }
  if (ctx.mentions.includes(known.slug)) return known.slug;
  if (ctx.mentions.length === 0 && pageVault === known.slug) return known.slug;
  if (ctx.mentions.length === 0) return clarify(`Which vault? I can use ${nameOf(known.slug, vaults)} if that's the one.`, [nameOf(known.slug, vaults)]);
  return clarify(`You mentioned ${ctx.mentions.map((s) => nameOf(s, vaults)).join(" and ")}. Which one should this use?`, ctx.mentions.map((s) => nameOf(s, vaults)));
}

/** How many different amounts the user said (0.1 ETH and "0.10 eth" are one). */
function distinct(said: AmountMention[], deposit: boolean) {
  return new Set(said.map((m) => { const e = ethOf(m, deposit); if (e !== null) { try { return `eth:${parseEther(e)}`; } catch { return `eth:${e}`; } } return m.kind === "usd" ? `usd:${m.usd}` : m.kind === "percent" ? `pct:${m.percent}` : `bare:${(m as { value: string }).value}`; })).size;
}
const ethOf = (m: AmountMention, deposit: boolean) => (m.kind === "eth" ? m.eth : m.kind === "bare" && deposit ? m.value : null);
const sameEth = (a: string, b: string) => { try { return parseEther(a) === parseEther(b); } catch { return false; } };

export function checkDeposit(intent: DepositIntent, userMessages: string[], vaults: VaultRef[], pageVault?: string): Approved<{ amount_eth?: string; amount_usd?: string; percent_of_wallet?: number }> | Clarify {
  const ctx = context(userMessages, vaults);
  const vault = checkVault(intent.vault, ctx, vaults, pageVault);
  if (typeof vault !== "string") return vault;
  const said = ctx.amounts;
  if (!said.length) return clarify(`How much ETH should go into ${nameOf(vault, vaults)}?`, ["0.01 ETH", "0.05 ETH", "0.1 ETH"]);
  // one message, two amounts (a correction, or text pasted from elsewhere): never pick for the user, ask
  if (distinct(said, true) > 1) return clarify(`I see more than one amount there. How much should go into ${nameOf(vault, vaults)}?`, [...new Set(said.map(describe))]);
  const given = [intent.amount_eth, intent.amount_usd, intent.percent_of_wallet].filter((x) => x !== undefined && x !== null && x !== "").length;
  if (given !== 1) return clarify(`How much should go into ${nameOf(vault, vaults)}?`, said.map(describe));

  if (intent.amount_eth !== undefined) {
    const eth = canonDecimal(String(intent.amount_eth));
    if (!eth || !said.some((m) => { const e = ethOf(m, true); return e !== null && sameEth(e, eth); })) return mismatch(said, vault, vaults);
    if (Number(eth) <= 0) return clarify("The amount has to be above zero. How much ETH?");
    if (Number(eth) > LIMITS.maxDepositEth) return clarify(`The assistant can prepare deposits up to ${LIMITS.maxDepositEth} ETH at a time. Use the deposit form on the vault page for more, or choose a smaller amount.`);
    return { decision: "ok", vault, amount_eth: eth };
  }
  if (intent.amount_usd !== undefined) {
    const usd = canonDecimal(String(intent.amount_usd));
    if (!usd || !said.some((m) => m.kind === "usd" && m.usd === usd)) return mismatch(said, vault, vaults);
    return { decision: "ok", vault, amount_usd: usd };
  }
  const pct = Number(intent.percent_of_wallet);
  if (!Number.isFinite(pct) || !said.some((m) => m.kind === "percent" && m.percent === pct)) return mismatch(said, vault, vaults);
  if (pct <= 0 || pct > 100) return clarify("That percentage needs to be between 1 and 100.");
  return { decision: "ok", vault, percent_of_wallet: pct };
}

export function checkWithdraw(intent: WithdrawIntent, userMessages: string[], vaults: VaultRef[], pageVault?: string): Approved<{ percent?: number; amount_eth?: string }> | Clarify {
  const ctx = context(userMessages, vaults);
  const vault = checkVault(intent.vault, ctx, vaults, pageVault);
  if (typeof vault !== "string") return vault;
  const said = ctx.amounts;
  if (!said.length) return clarify(`How much of ${nameOf(vault, vaults)} should I withdraw?`, ["25%", "50%", "100%"]);
  if (distinct(said, false) > 1) return clarify(`I see more than one amount there. How much of ${nameOf(vault, vaults)} should I withdraw?`, [...new Set(said.map(describe))]);
  if (intent.percent !== undefined && intent.percent !== null) {
    const p = Number(intent.percent);
    if (!said.some((m) => (m.kind === "percent" && m.percent === p) || (m.kind === "bare" && Number(m.value) === p && p >= 1 && p <= 100 && /%|percent/.test(ctx.latest)))) return mismatch(said, vault, vaults, true);
    if (!Number.isInteger(p) || p < 1 || p > 100) return clarify("Withdrawals are in whole percents from 1 to 100. How much?", ["25%", "50%", "100%"]);
    return { decision: "ok", vault, percent: p };
  }
  if (intent.amount_eth !== undefined) {
    const eth = canonDecimal(String(intent.amount_eth));
    if (!eth || !said.some((m) => m.kind === "eth" && sameEth(m.eth, eth))) return mismatch(said, vault, vaults, true);
    return { decision: "ok", vault, amount_eth: eth };
  }
  return clarify(`How much of ${nameOf(vault, vaults)} should I withdraw?`, ["25%", "50%", "100%"]);
}

function describe(m: AmountMention) {
  return m.kind === "eth" ? `${m.eth} ETH` : m.kind === "usd" ? `$${m.usd}` : m.kind === "percent" ? `${m.percent}%` : `${m.value} ETH`;
}
function mismatch(said: AmountMention[], vault: string, vaults: VaultRef[], withdraw = false): Clarify {
  const opts = said.map((m) => (withdraw && m.kind === "bare" ? `${m.value}%` : describe(m)));
  return clarify(`Just to be sure: how much ${withdraw ? "should come out of" : "should go into"} ${nameOf(vault, vaults)}?`, [...new Set(opts)]);
}
