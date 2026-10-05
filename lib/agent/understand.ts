/* What the user literally asked for, read with plain code and no model: the vaults they named and the amounts they said.
 * The agent's model proposes an action; this file is the referee that checks the proposal against the user's own words
 * before any transaction is built (see guard.ts). Pure functions, no I/O, so every rule here is unit-tested. */

export type VaultRef = { slug: string; name: string; ticker: string };
export type AmountMention =
  | { kind: "eth"; eth: string }          // "0.1 eth", "a tenth of an eth", "1 ether"
  | { kind: "usd"; usd: string }          // "$50", "50 dollars", "50 usd"
  | { kind: "percent"; percent: number }  // "50%", "half", "all", "a quarter"
  | { kind: "bare"; value: string };      // "0.1" with no unit: an ETH amount when the action is a deposit

/** Extra names people use. Only unambiguous ones: "eth" alone never means Boosted ETH, "ai" alone is also a token. */
const NICKNAMES: Record<string, string[]> = {
  boost: ["boosted eth", "boosted", "boost vault", "boost", "boostx", "eth boost", "leverage vault", "leveraged eth"],
  autolp: ["hands-free lp", "hands free lp", "handsfree lp", "hands-free", "hands free", "auto lp", "autolp", "stkx", "stock lp", "the lp vault", "lp vault", "lp"],
  "696x": ["696x", "696", "conviction list", "the conviction list"],
  faangx: ["faangx", "faang", "big tech", "big tech conviction"],
  chainfin: ["chainx", "chainfin", "on-chain finance", "onchain finance", "on chain finance"],
  siliconx: ["chipx", "chips", "chip index", "silicon", "silicon stack", "siliconx", "semis", "semiconductors"],
  aistack: ["aix", "ai stack", "aistack", "ai index"],
  retailx: ["cultx", "retail pulse", "retailx", "retail"],
  healthx: ["hlthx", "health", "health frontier", "healthx"],
  cloudx: ["cloudx", "cloud", "cloud layer"],
  realx: ["realx", "real assets"],
  corex: ["corex", "core & carry", "core and carry", "core carry"],
  frontierx: ["edge", "frontier", "frontier systems", "frontierx"],
  consumerx: ["iconx", "consumer icons", "consumer", "consumerx"],
};
/** Words that name several vaults at once: hearing one of these alone means we must ask which. */
const AMBIGUOUS: Record<string, string[]> = {
  stack: ["aistack", "siliconx"],
  tech: ["faangx", "aistack", "siliconx", "cloudx"],
  index: [],
};

// "0,2" is a decimal comma; "1,000" is a thousands separator
const norm = (s: string) => ` ${s.toLowerCase().replace(/(\d),(\d{3})(?!\d)/g, "$1$2").replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2").replace(/[’']/g, "").replace(/[^a-z0-9$.%&\- ]+/g, " ").replace(/\s+/g, " ").trim()} `;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every alias for every vault we know, longest first, so "silicon stack" wins over "stack". */
export function aliasTable(vaults: VaultRef[]): { alias: string; slug: string }[] {
  const rows: { alias: string; slug: string }[] = [];
  for (const v of vaults) {
    const names = new Set([v.slug, v.ticker, `$${v.ticker}`, v.name, v.name.replace(/^the /i, ""), ...(NICKNAMES[v.slug] ?? [])].map((a) => a.toLowerCase().trim()).filter(Boolean));
    for (const alias of names) rows.push({ alias, slug: v.slug });
  }
  return rows.sort((a, b) => b.alias.length - a.alias.length);
}

/** The vaults named in `text` (distinct, in order of appearance) and any ambiguous words that name several. */
export function vaultMentions(text: string, vaults: VaultRef[]): { slugs: string[]; ambiguous: { word: string; candidates: string[] }[]; masked: string } {
  let t = norm(text);
  const found: { slug: string; at: number }[] = [];
  for (const { alias, slug } of aliasTable(vaults)) {
    const re = new RegExp(`(?<=[\\s$])${esc(alias.replace(/^\$/, ""))}(?=[\\s.,!?])`, "g");
    t = t.replace(re, (m, at: number) => { found.push({ slug, at }); return " ".repeat(m.length); });
  }
  const ambiguous: { word: string; candidates: string[] }[] = [];
  for (const [word, candidates] of Object.entries(AMBIGUOUS)) {
    if (candidates.length && new RegExp(`\\s${word}\\s`).test(t)) ambiguous.push({ word, candidates: candidates.filter((c) => vaults.some((v) => v.slug === c)) });
  }
  const slugs = [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.slug))];
  return { slugs, ambiguous, masked: t };
}

const WORD_NUMBERS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
const FRACTION_ETH: [RegExp, string][] = [
  [/\b(a|one)\s+tenth\s+of\s+(an?\s+)?(eth|ether)\b/, "0.1"],
  [/\bhalf\s+(an?\s+)?(eth|ether)\b/, "0.5"],
  [/\b(a|one)\s+quarter\s+of\s+(an?\s+)?(eth|ether)\b/, "0.25"],
  [/\b(a|one)\s+hundredth\s+of\s+(an?\s+)?(eth|ether)\b/, "0.01"],
];
const FRACTION_PCT: [RegExp, number][] = [
  [/\b(all|everything|entire|entirely|whole|max|full amount|all of it|fully|completely)\b/, 100],
  [/\b(half|50 ?percent)\b/, 50],
  [/\b(a |one )?quarter\b/, 25],
  [/\b(a |one )?third\b/, 33],
  [/\b(three quarters|three-quarters)\b/, 75],
];

/** Canonical decimal string ("0.10" -> "0.1", ".5" -> "0.5", "1,5" -> "1.5"); null when it is not a plain decimal. */
export function canonDecimal(raw: string): string | null {
  const s = raw.trim().replace(",", ".");
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  const int = (i || "0").replace(/^0+(?=\d)/, ""), frac = f.replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Every amount the user said. Vault names are masked out first, so "696x" or "2x" never reads as an amount. */
export function amountMentions(text: string, vaults: VaultRef[]): AmountMention[] {
  let t = vaultMentions(text, vaults).masked;
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*x\b/g, " ");                       // leverage figures like 1.87x
  for (const [w, n] of Object.entries(WORD_NUMBERS)) t = t.replace(new RegExp(`\\b${w}\\s+(eth|ether)\\b`, "g"), `${n} eth`);
  const out: AmountMention[] = [];
  for (const [re, eth] of FRACTION_ETH) if (re.test(t)) { out.push({ kind: "eth", eth }); t = t.replace(re, " "); }
  t = t.replace(/\$\s*(\d[\d,]*(?:\.\d+)?|\.\d+)/g, (_, n: string) => { const v = canonDecimal(n.replace(/,(?=\d{3}\b)/g, "")); if (v) out.push({ kind: "usd", usd: v }); return " "; });
  t = t.replace(/(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(usd|dollars?|bucks)\b/g, (_, n: string) => { const v = canonDecimal(n.replace(/,(?=\d{3}\b)/g, "")); if (v) out.push({ kind: "usd", usd: v }); return " "; });
  t = t.replace(/(\d+(?:\.\d+)?)\s*(%|percent|pct)/g, (_, n: string) => { const p = Number(n); if (Number.isFinite(p)) out.push({ kind: "percent", percent: p }); return " "; });
  t = t.replace(/(\d+(?:[.,]\d+)?|\.\d+)\s*(eth|ether|weth)\b/g, (_, n: string) => { const v = canonDecimal(n); if (v) out.push({ kind: "eth", eth: v }); return " "; });
  for (const [re, p] of FRACTION_PCT) if (re.test(t)) { out.push({ kind: "percent", percent: p }); t = t.replace(re, " "); }
  for (const m of t.matchAll(/(?<![\w.])(\d+(?:\.\d+)?|\.\d+)(?![\w.])/g)) { const v = canonDecimal(m[1]); if (v) out.push({ kind: "bare", value: v }); }
  return out;
}

/** "this", "here", "it", "this vault": the user means the vault on screen. */
export const meansCurrentVault = (text: string) => /\b(this|here|it|this vault|this one|this index|current)\b/i.test(text);
