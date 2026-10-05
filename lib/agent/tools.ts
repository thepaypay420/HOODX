/* The agent's tools. Read tools reuse the MCP server's code (lib/mcp/hoodx.ts). Action tools never trust the model:
 * guard.ts checks the request against the user's words, the existing quote builders simulate it from the user's own
 * address, verify.ts decodes the result, and the card is built from that decode. */
import { formatEther, parseEther, type Address } from "viem";
import { boostSignal, boostStats, checkAddress, client, getVault, overview, positions, quoteDeposit, quoteWithdraw, registry, type Entry } from "@/lib/mcp/hoodx";
import { checkDeposit, checkWatch, checkWithdraw, type Clarify } from "./guard";
import { describeRule, validRule } from "./watch";
import type { ToolDef } from "./model";
import type { Card, Row } from "./types";
import { verifyTx } from "./verify";
import { FEATURED_VAULTS } from "@/lib/vaults";
import { AUTO_LP } from "@/lib/stockLp";

export type ToolCtx = { origin: string; wallet?: Address; pageVault?: string; userMessages: string[]; dryRun: boolean };
export type ToolResult = { data: unknown; cards: Card[]; final?: { reply: string } };

export function vaultList(): Entry[] { return registry(); }

export function toolDefs(vaults: Entry[]): ToolDef[] {
  const slug = { type: "string", enum: vaults.map((v) => v.slug), description: "The vault's slug from the vault table." };
  const fn = (name: string, description: string, properties: object = {}, required: string[] = []): ToolDef =>
    ({ type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } });
  return [
    fn("get_overview", "Total value in HOODX and a summary of each product. Use for general questions about the platform."),
    fn("get_vault", "Live details for one vault: value, return since launch, holdings, rules.", { vault: slug }, ["vault"]),
    fn("get_boost_signal", "Boosted ETH's live trend signal: target leverage, which of its 16 trend flags are on, and the exact ETH prices that would change it. Use for any 'why is Boost at ...' or 'what would change the leverage' question."),
    fn("boost_what_if", "Exactly what Boosted ETH's target leverage would become if ETH (and BTC) moved by a given percent, using the vault's on-chain formula and its real trend thresholds. Use for any 'what if ETH drops/rises X%' question.",
      { eth_change_pct: { type: "number", description: "e.g. -10 for a 10% fall" }, btc_change_pct: { type: "number", description: "defaults to the same move as ETH" } }, ["eth_change_pct"]),
    fn("find_indexes", "Which HOODX vaults (the indexes and the Hands-free LP) hold a given stock, ETF or token (by ticker or company name), and what else they hold.", { asset: { type: "string", description: "e.g. NVDA or nvidia" } }, ["asset"]),
    fn("get_my_positions", "The connected wallet's positions in every HOODX vault and its ETH balance. Needs a connected wallet."),
    fn("prepare_deposit", "Prepare a deposit for the user to review and sign. Give exactly ONE of amount_eth, amount_usd or percent_of_wallet, copied from the user's words.",
      { vault: slug, amount_eth: { type: "string", description: "ETH amount exactly as the user said it, e.g. \"0.1\"." }, amount_usd: { type: "string", description: "Dollar amount exactly as said, e.g. \"50\"." }, percent_of_wallet: { type: "integer", description: "Share of the wallet's ETH, e.g. 50 for half." } }, ["vault"]),
    fn("prepare_withdraw", "Prepare a withdrawal for the user to review and sign. Give percent (whole number 1-100) or amount_eth.",
      { vault: slug, percent: { type: "integer", minimum: 1, maximum: 100 }, amount_eth: { type: "string" } }, ["vault"]),
    fn("create_watch", "Set up an alert the user asked for, e.g. 'tell me if ETH drops below 2500' (eth_price below 2500), 'let me know if Boost steps aside' (boost_event steps_aside), 'alert me if my LP position falls 10%' (position_change autolp -10). Numbers must be the user's own.",
      { kind: { type: "string", enum: ["eth_price", "boost_leverage", "boost_event", "position_value", "position_change"] }, op: { type: "string", enum: ["below", "above"] },
        usd: { type: "number", description: "dollar level for eth_price or position_value" }, x: { type: "number", description: "leverage level for boost_leverage, e.g. 1" },
        event: { type: "string", enum: ["steps_aside", "leaves_max", "any_change"] }, vault: slug, pct: { type: "number", description: "percent move for position_change; negative for a fall" } }, ["kind"]),
    fn("ask_user", "Ask the user a short clarifying question when the vault or the amount is unclear.", { question: { type: "string" }, options: { type: "array", items: { type: "string" }, maxItems: 4 } }, ["question"]),
  ];
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const refs = (vaults: Entry[]) => vaults.map((v) => ({ slug: v.slug, name: v.name, ticker: v.ticker }));
const clarifyResult = (c: Clarify): ToolResult => ({ data: c, cards: [{ type: "clarify", question: c.question, options: c.options }], final: { reply: c.question } });
const notice = (text: string, tone: "info" | "warn" = "warn", link?: { label: string; href: string }): ToolResult => ({ data: { error: text }, cards: [{ type: "notice", tone, text, link }], final: { reply: text } });
const needWallet = () => notice("Connect your wallet first, then ask again.", "info");

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx, vaults: Entry[]): Promise<ToolResult> {
  switch (name) {
    case "get_overview": {
      const o = await overview(ctx.origin);
      return { data: o, cards: [] };
    }
    case "get_vault": {
      const v = await getVault(ctx.origin, String(args.vault)) as Record<string, unknown>;
      const e = vaults.find((x) => x.slug === String(args.vault));
      const card: Card | null = e ? { type: "vault", slug: e.slug, name: e.name, ticker: e.ticker, valueUsd: typeof v.valueUsd === "number" ? v.valueUsd : null, sinceLaunchPct: typeof v.sinceLaunchPct === "number" ? v.sinceLaunchPct : null, summary: e.summary.split(". ")[0], url: e.url } : null;
      return { data: v, cards: card ? [card] : [] };
    }
    case "get_boost_signal": {
      const s = await boostSignal();
      type Flag = { trend: string; on: boolean; turnsOffBelow: number; turnsOnAbove: number };
      const eth = s.eth.flags as Flag[], btc = s.btc.flags as Flag[];
      const off = eth.filter((f) => !f.on), on = eth.filter((f) => f.on);
      const slowOn = eth.filter((f) => /slow/.test(f.trend));
      return { data: s, cards: [{ type: "signal", target: s.target, ethPrice: s.eth.price, eth: eth.map((f) => f.on), btc: btc.map((f) => f.on),
        fullAbove: off.length ? Math.min(...off.map((f) => f.turnsOnAbove)) : null, firstStepBelow: on.length ? Math.max(...on.map((f) => f.turnsOffBelow)) : null,
        asideBelowEth: slowOn.length ? Math.min(...slowOn.map((f) => f.turnsOffBelow)) : null }] };
    }
    case "boost_what_if": return boostWhatIf(Number(args.eth_change_pct), args.btc_change_pct === undefined ? undefined : Number(args.btc_change_pct), ctx);
    case "find_indexes": {
      const q = String(args.asset ?? "").trim();
      const sym = ASSET_NAMES[q.toLowerCase()] ?? q.toUpperCase().replace(/^\$/, "");
      const hits = FEATURED_VAULTS.filter((v) => v.status !== "pilot" && v.assets.includes(sym)).map((v) => ({ slug: v.slug, name: v.name, ticker: v.symbol, holds: v.assets.join(", ") }));
      // the Hands-free LP holds stocks too (as Uniswap V4 liquidity), so it counts as a vault holding them
      if (AUTO_LP.vault && (AUTO_LP.stocks as readonly string[]).includes(sym)) hits.push({ slug: AUTO_LP.slug, name: "Hands-free LP", ticker: AUTO_LP.symbol, holds: `${AUTO_LP.stocks.join(", ")} (as Uniswap V4 liquidity)` });
      return { data: { asset: sym, indexes: hits, note: hits.length ? undefined : `No HOODX vault holds ${sym} today.` }, cards: [] };
    }
    case "get_my_positions": {
      if (!ctx.wallet) return needWallet();
      const p = await positions(ctx.origin, ctx.wallet);
      return { data: p, cards: [{ type: "positions", totalUsd: p.totalValueUsd, walletEth: p.ethBalanceOnRobinhoodChain, rows: p.positions.map((r) => ({ name: r.vault, ticker: r.ticker, slug: r.slug, valueUsd: r.valueUsd, valueEth: r.valueEth })) }] };
    }
    case "ask_user": {
      const q = String(args.question ?? "Could you say a bit more?").slice(0, 200);
      const options = Array.isArray(args.options) ? args.options.map(String).slice(0, 4) : [];
      return { data: { asked: q }, cards: [{ type: "clarify", question: q, options }], final: { reply: q } };
    }
    case "create_watch": {
      // keep only the fields each kind uses: models sometimes add a stray one (a vault on a Boost event, an op on a move)
      const FIELDS: Record<string, string[]> = { eth_price: ["op", "usd"], boost_leverage: ["op", "x"], boost_event: ["event"], position_value: ["vault", "op", "usd"], position_change: ["vault", "pct"] };
      const num = (v: unknown) => (typeof v === "string" ? Number(v.replace(/[$,\s]|eth|usd/gi, "")) : v);
      // an event with no leverage level is a Boost event, whatever kind the model labelled it (events carry no numbers)
      const kind = args.event && (args.x === undefined || args.x === null) ? "boost_event" : String(args.kind);
      const rule = Object.fromEntries([["kind", kind], ...(FIELDS[kind] ?? []).map((k) => [k, ["usd", "x", "pct"].includes(k) ? num(args[k]) : args[k]])].filter(([, v]) => v !== undefined && v !== null));
      if (!validRule(rule, vaults.map((v) => v.slug))) { if (process.env.NODE_ENV !== "production") console.error("[agent] invalid watch", JSON.stringify(args)); return clarifyResult({ decision: "clarify", question: "What exactly should I watch for? For example: ETH below $2,500, or Boost stepping aside.", options: [] }); }
      const g = checkWatch(rule, ctx.userMessages, refs(vaults), ctx.pageVault);
      if (g.decision === "clarify") return clarifyResult(g);
      if (["position_value", "position_change"].includes(g.rule.kind) && !ctx.wallet) return needWallet();
      const label = describeRule(g.rule, (s) => vaults.find((v) => v.slug === s)?.name ?? s);
      return { data: { watch: label }, cards: [{ type: "watch", rule: g.rule, label }], final: { reply: `I'll watch for: ${label}. Tap Start watching to turn it on.` } };
    }
    case "prepare_deposit": return prepareDeposit(args, ctx, vaults);
    case "prepare_withdraw": return prepareWithdraw(args, ctx, vaults);
    default: return { data: { error: `Unknown tool ${name}` }, cards: [] };
  }
}

async function prepareDeposit(args: Record<string, unknown>, ctx: ToolCtx, vaults: Entry[]): Promise<ToolResult> {
  const intent = { vault: String(args.vault ?? ""), amount_eth: args.amount_eth as string | undefined, amount_usd: args.amount_usd as string | undefined, percent_of_wallet: args.percent_of_wallet as number | undefined };
  const g = checkDeposit(intent, ctx.userMessages, refs(vaults), ctx.pageVault);
  if (g.decision === "clarify") return clarifyResult(g);
  if (ctx.dryRun) return { data: g, cards: [{ type: "intent", action: "deposit", ...g, decision: undefined } as Card], final: { reply: "ok" } };
  if (!ctx.wallet) return needWallet();
  const e = vaults.find((v) => v.slug === g.vault)!;

  // the ETH to send, worked out by code from what the user said
  let eth = g.amount_eth, note: Row | null = null;
  if (g.amount_usd) {
    const stats = await boostStats(ctx.origin);
    if (!stats?.ethUsd) return notice("Couldn't read the ETH price just now; try again, or give the amount in ETH.");
    eth = (Number(g.amount_usd) / stats.ethUsd).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    note = ["You asked for", `$${g.amount_usd} ≈ ${eth} ETH at $${stats.ethUsd.toFixed(2)}`];
  }
  if (g.percent_of_wallet) {
    const bal = await client().getBalance({ address: ctx.wallet });
    const gas = parseEther("0.0005"), usable = bal > gas ? bal - gas : 0n;
    const wei = (usable * BigInt(g.percent_of_wallet)) / 100n;
    eth = Number(formatEther(wei)).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    note = ["You asked for", `${g.percent_of_wallet}% of your ETH ≈ ${eth} ETH (0.0005 kept for gas)`];
  }
  if (!eth || Number(eth) <= 0) return notice("That works out to nothing to deposit. Try an amount in ETH.");

  let q: Awaited<ReturnType<typeof quoteDeposit>>;
  try { q = await quoteDeposit(ctx.origin, e.slug, eth, ctx.wallet); } catch (x) { return notice(x instanceof Error ? x.message : "Couldn't prepare this deposit right now."); }
  if (!q.ok || !("transaction" in q)) {
    const reason = "reason" in q ? String(q.reason) : "This deposit can't be prepared right now.";
    return notice(reason, "warn", "funding" in q && q.funding ? { label: "Bridge ETH with Relay", href: "https://relay.link/bridge/robinhood" } : undefined);
  }
  const t = q.transaction;
  if (!t) return notice("This can't be prepared right now; try again in a moment.");
  verifyTx(t, e, ctx.wallet, "deposit", parseEther(eth));
  const receive = "expectedShares" in q ? `${q.expectedShares} ${e.ticker}` : "shares" in q ? `${q.shares} ${e.ticker}` : "sharesReceived" in q ? `${q.sharesReceived} ${e.ticker}` : "—";
  const rows: Row[] = [["You send", `${formatEther(BigInt(t.value))} ETH`], ["You receive", receive]];
  if (note) rows.unshift(note);
  if ("refundedToYou" in q && Number(q.refundedToYou) > 0) rows.push(["Refunded to you", `${q.refundedToYou} ETH`]);
  if ("unusedEthReturned" in q && Number(q.unusedEthReturned) > 0) rows.push(["Unused ETH returned", `${q.unusedEthReturned} ETH`]);
  return {
    data: { prepared: true },
    cards: [{ type: "proposal", action: "deposit", vault: { slug: e.slug, name: e.name, ticker: e.ticker, url: e.url }, headline: `${formatEther(BigInt(t.value))} ETH → ${e.name}`, rows, protection: String(q.protection ?? ""),
      tx: { chainId: t.chainId, from: t.from as `0x${string}`, to: t.to as `0x${string}`, data: t.data as `0x${string}`, value: t.value }, expiresAt: t.expiresAt, reviewUrl: q.reviewUrl }],
    final: { reply: `Ready: ${formatEther(BigInt(t.value))} ETH into ${e.name}, simulated from your wallet. Check the card, then sign.` },
  };
}

async function prepareWithdraw(args: Record<string, unknown>, ctx: ToolCtx, vaults: Entry[]): Promise<ToolResult> {
  const intent = { vault: String(args.vault ?? ""), percent: args.percent as number | undefined, amount_eth: args.amount_eth as string | undefined };
  const g = checkWithdraw(intent, ctx.userMessages, refs(vaults), ctx.pageVault);
  if (g.decision === "clarify") return clarifyResult(g);
  if (ctx.dryRun) return { data: g, cards: [{ type: "intent", action: "withdraw", ...g, decision: undefined } as Card], final: { reply: "ok" } };
  if (!ctx.wallet) return needWallet();
  const e = vaults.find((v) => v.slug === g.vault)!;

  let percent = g.percent, note: Row | null = null;
  if (g.amount_eth) {
    const p = await positions(ctx.origin, ctx.wallet);
    const held = p.positions.find((r) => r.slug === e.slug)?.valueEth ?? 0;
    if (!held) return notice(`This wallet holds no ${e.name}.`, "info");
    percent = Math.min(100, Math.max(1, Math.round((Number(g.amount_eth) / held) * 100)));
    note = ["You asked for", `${g.amount_eth} ETH ≈ ${percent}% of your ${round(held, 5)} ETH position`];
  }
  let q: Awaited<ReturnType<typeof quoteWithdraw>>;
  try { q = await quoteWithdraw(ctx.origin, e.slug, ctx.wallet, percent!); } catch (x) { return notice(x instanceof Error ? x.message : "Couldn't prepare this withdrawal right now."); }
  if (!q.ok || !("transaction" in q)) return notice("reason" in q ? String(q.reason) : "This withdrawal can't be prepared right now.", "info");
  const t = q.transaction;
  if (!t) return notice("This can't be prepared right now; try again in a moment.");
  verifyTx(t, e, ctx.wallet, "withdraw", 0n);
  const rows: Row[] = [["Shares", `${q.shares} ${e.ticker}`]];
  if ("expectedEth" in q && q.expectedEth) rows.push(["Expected", `${q.expectedEth} ETH`]);
  if ("minimumEth" in q && q.minimumEth) rows.push(["At least", `${q.minimumEth} ETH`]);
  if (note) rows.unshift(note);
  return {
    data: { prepared: true },
    cards: [{ type: "proposal", action: "withdraw", vault: { slug: e.slug, name: e.name, ticker: e.ticker, url: e.url }, headline: `Withdraw ${percent}% of ${e.name}`, rows, protection: String(q.protection ?? ""),
      tx: { chainId: t.chainId, from: t.from as `0x${string}`, to: t.to as `0x${string}`, data: t.data as `0x${string}`, value: t.value }, expiresAt: t.expiresAt, reviewUrl: q.reviewUrl }],
    final: { reply: `Ready: ${percent}% out of ${e.name}, simulated from your wallet. Check the card, then sign.` },
  };
}

export { checkAddress };

/** Plain names people use for tickers in the indexes. */
const ASSET_NAMES: Record<string, string> = {
  nvidia: "NVDA", apple: "AAPL", microsoft: "MSFT", google: "GOOGL", alphabet: "GOOGL", amazon: "AMZN", meta: "META", facebook: "META", netflix: "NFLX",
  tesla: "TSLA", amd: "AMD", intel: "INTC", tsmc: "TSM", taiwan: "TSM", broadcom: "AVGO", micron: "MU", sandisk: "SNDK", dell: "DELL", palantir: "PLTR", coinbase: "COIN", microstrategy: "MSTR",
  strategy: "MSTR", circle: "CRCL", gamestop: "GME", reddit: "RDDT", roblox: "RBLX", moderna: "MRNA", lilly: "LLY", pfizer: "PFE", shopify: "SHOP", cloudflare: "NET",
  snowflake: "SNOW", oracle: "ORCL", gold: "GLD", silver: "SLV", oil: "USO", boeing: "BA", lockheed: "LMT", costco: "COST", lululemon: "LULU", spacex: "SPCX", "s&p 500": "SPY", "s&p": "SPY", nasdaq: "QQQ",
};

/** The vault's own formula applied to shocked prices: target = min(2, slow + (slow >= 0.75 ? fast * (min(2, 2.4/vol) - 1) : 0)),
 *  with each trend flag flipping only past its hysteresis band (off below EMA x 0.99, on above EMA x 1.01). */
async function boostWhatIf(ethPct: number, btcPctIn: number | undefined, ctx: ToolCtx): Promise<ToolResult> {
  if (!Number.isFinite(ethPct) || ethPct < -90 || ethPct > 300) return { data: { error: "Give a move between -90% and +300%." }, cards: [] };
  const btcPct = Number.isFinite(btcPctIn as number) ? (btcPctIn as number) : ethPct;
  const [s, stats] = await Promise.all([boostSignal(), boostStats(ctx.origin)]);
  type Flag = { trend: string; on: boolean; turnsOffBelow: number; turnsOnAbove: number };
  const shock = (flags: Flag[], px: number) => flags.map((f) => ({ ...f, after: f.on ? !(px < f.turnsOffBelow) : px > f.turnsOnAbove }));
  const ethPx = s.eth.price * (1 + ethPct / 100), btcPx = s.btc.price * (1 + btcPct / 100);
  const eth = shock(s.eth.flags as Flag[], ethPx), btc = shock(s.btc.flags as Flag[], btcPx);
  const share = (k: "on" | "after", slow: boolean) => [...eth, ...btc].filter((f) => /slow/.test(f.trend) === slow && f[k]).length / 8;
  const room = Math.max(0, Math.min(2, 2.4 / Math.max(s.ethVolatility, 1e-9)) - 1);
  const target = (k: "on" | "after") => { const sl = share(k, true), fa = share(k, false); return Math.min(2, sl + (sl >= 0.75 ? fa * room : 0)); };
  const lev = stats?.leverage ?? target("on");
  const flips = [...eth.map((f) => ({ ...f, a: "ETH" })), ...btc.map((f) => ({ ...f, a: "BTC" }))].filter((f) => f.on !== f.after).map((f) => `${f.a} ${f.trend} turns ${f.after ? "on" : "off"}`);
  const data = { assumption: `ETH ${ethPct > 0 ? "+" : ""}${ethPct}% to $${round(ethPx)}, BTC ${btcPct > 0 ? "+" : ""}${btcPct}% to $${round(btcPx)}, volatility unchanged`,
    targetNow: round(target("on"), 3), targetAfter: round(target("after"), 3), slowTrendsOn: `${share("on", true) * 8} of 8 now, ${share("after", true) * 8} of 8 after`, fastTrendsOn: `${share("on", false) * 8} of 8 now, ${share("after", false) * 8} of 8 after`, flagsFlipped: flips,
    vaultMoveBeforeRebalancePct: round(ethPct * lev, 1), note: "Leverage changes at the next hourly rebalance after the flags flip; until then the vault moves about leverage x ETH's move." };
  const card: Card = { type: "notice", tone: "info", text: `If ETH ${ethPct > 0 ? "rises" : "falls"} ${Math.abs(ethPct)}%: target leverage ${data.targetNow}× → ${data.targetAfter}×. ${flips.length ? `${flips.length} trend signal${flips.length > 1 ? "s" : ""} flip.` : "No trend signal flips."} Until it rebalances, the vault moves about ${data.vaultMoveBeforeRebalancePct}%.` };
  return { data, cards: [card] };
}
