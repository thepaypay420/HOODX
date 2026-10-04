/* Curator tools for the HOODX MCP server: discover the approved asset universe, backtest a basket, launch an index, see
 * drift, rebalance atomically, and run the controller's admin actions. Like the holder tools, everything here reads chain
 * state or SIMULATES from the curator's own address and returns an UNSIGNED transaction. Nothing can sign. */
import { unstable_cache } from "next/cache";
import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, encodeFunctionData, formatEther, keccak256, parseAbi, parseEther, zeroAddress, type Address } from "viem";
import { SITE_URL } from "@/lib/config";
import { atomicFactoryAbi, atomicFactoryAddress } from "@/lib/atomicFactory";
import { proportionalAbi, quoteProportionalRebalance, readProportionalState, type ProportionalState } from "@/lib/proportionalQuote";
import { protectedRebalanceMinimum, rebalanceControllerV3Abi, resolveVaultAuthority } from "@/lib/rebalanceController";
import { productionV2Treasury } from "@/lib/v2";
import { okUserSlug } from "@/lib/format";
import { DEFAULT_VAULT_WALLET_IMAGE, walletImageUri } from "@/lib/tokenImage";
import universe from "../../public/universe.json";
import stocks from "../../public/rh_stocks.json";
import { checkAddress, client, explain, fmt, resolveAny } from "@/lib/mcp/hoodx";
import { FEATURED_VAULTS } from "@/lib/vaults";

const ZERO32 = `0x${"0".repeat(64)}` as const;
const controllerAdminAbi = parseAbi([
  "function pendingCurator() view returns (address)",
  "function setImageURI(string uri)",
  "function proposeCurator(address next)",
]);
const tokenAbi = parseAbi(["function symbol() view returns (string)", "function cashTargetBps() view returns (uint16)", "function targetBps(address) view returns (uint16)"]);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
function revertName(e: unknown): string {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? r.reason ?? "reverted" : e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e);
}
const tx = (from: Address, to: Address, data: `0x${string}`, value = 0n, expires?: bigint) => ({ chainId: 4663, from, to, data, value: value.toString(), valueEth: formatEther(value), ...(expires ? { expiresAt: new Date(Number(expires) * 1000).toISOString() } : {}) });
const SIGNING = "Unsigned. The curator wallet signs it on Robinhood Chain (chain 4663). Nothing has been sent.";

/* ------------------------------------------------------------------ the approved asset universe (10 minutes) */
type Asset = { symbol: string; name: string; token: Address; kind: "stock" | "crypto"; mcapUsd: number | null; poolLiquidityUsd: number | null };
export const approvedUniverse = unstable_cache(async (): Promise<Asset[]> => {
  const crypto = ((universe as { tokens: { symbol: string; name: string; token: string; mcapUsd?: number; buyTvlUsd?: number }[] }).tokens).map((t) => ({ symbol: t.symbol.toUpperCase(), name: t.name, token: t.token as Address, kind: "crypto" as const, mcapUsd: t.mcapUsd ?? null, poolLiquidityUsd: t.buyTvlUsd ?? null }));
  const equities = ((stocks as { tokens: { symbol: string; token: string }[] }).tokens).map((t) => ({ symbol: t.symbol.toUpperCase(), name: t.symbol.toUpperCase(), token: t.token as Address, kind: "stock" as const, mcapUsd: null, poolLiquidityUsd: null }));
  const c = client();
  // every asset the official vaults already hold, with its on-chain symbol (the static stock list is not complete)
  const held = (await Promise.all(FEATURED_VAULTS.filter((v) => v.address && v.status !== "pilot").map((v) =>
    c.readContract({ address: v.address!, abi: proportionalAbi, functionName: "constituents" }).catch(() => [] as readonly Address[])))).flat();
  const known = new Set([...equities, ...crypto].map((a) => a.token.toLowerCase()));
  const extra = [...new Set(held.map((t) => t.toLowerCase()))].filter((t) => !known.has(t)) as Address[];
  const extraSymbols = await Promise.all(extra.map((t) => c.readContract({ address: t, abi: tokenAbi, functionName: "symbol" }).catch(() => "")));
  const found = extra.map((t, i) => ({ symbol: extraSymbols[i].toUpperCase(), name: extraSymbols[i].toUpperCase(), token: t, kind: "stock" as const, mcapUsd: null, poolLiquidityUsd: null })).filter((a) => a.symbol);
  const all = [...equities, ...found, ...crypto.filter((x) => !equities.some((e) => e.token.toLowerCase() === x.token.toLowerCase()))];
  const ids = await Promise.all(all.map((a) => c.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "configIdByToken", args: [a.token] }).catch(() => ZERO32)));
  return all.filter((_, i) => ids[i] !== ZERO32);
}, ["mcp-approved-universe-v2"], { revalidate: 600 });

export async function assetUniverse(query?: string, kind?: string) {
  const all = await approvedUniverse();
  const q = query?.trim().toUpperCase();
  const rows = all.filter((a) => (!kind || kind === "all" || a.kind === kind) && (!q || a.symbol.includes(q) || a.name.toUpperCase().includes(q)));
  return { approvedAssets: rows.map((a) => ({ symbol: a.symbol, kind: a.kind, token: a.token, ...(a.kind === "crypto" ? { name: a.name, mcapUsd: a.mcapUsd && Math.round(a.mcapUsd), poolLiquidityUsd: a.poolLiquidityUsd && Math.round(a.poolLiquidityUsd) } : {}) })),
    count: rows.length, note: "Only assets with an approved swap route on the HOODX factory can be included in an index (2 to 24 per index). Stocks are Robinhood tokenized equities." };
}
async function resolveAssets(symbols: string[]) {
  const all = await approvedUniverse();
  return symbols.map((s) => {
    const k = s.trim().replace(/^\$/, "").toUpperCase();
    const hit = all.find((a) => a.symbol === k || a.token.toLowerCase() === s.trim().toLowerCase());
    if (!hit) throw new Error(`"${s}" is not an approved HOODX asset. Use hoodx_asset_universe to see what can be included.`);
    return hit;
  });
}

/* ------------------------------------------------------------------ backtest (tokenized stocks, daily closes) */
async function dailySeries(symbol: string, from: number): Promise<{ t: number; c: number }[] | undefined> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.replace(".", "-"))}?period1=${from - 6 * 86_400}&period2=${Math.floor(Date.now() / 1000) + 86_400}&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HOODX)" }, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
  if (!r?.ok) return undefined;
  const d = (await r.json()) as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
  const res = d.chart?.result?.[0], ts = res?.timestamp ?? [], cl = res?.indicators?.quote?.[0]?.close ?? [];
  const out = ts.map((t, i) => ({ t: Math.floor(t / 86_400), c: cl[i] ?? NaN })).filter((p) => Number.isFinite(p.c) && p.c > 0);
  return out.length ? out : undefined;
}
const dayKey = (d: number) => d;
export async function backtestBasket(symbols: string[], weightsPct: number[] | undefined, cashPct: number, days: number) {
  if (symbols.length < 2 || symbols.length > 24) throw new Error("Choose 2 to 24 assets.");
  if (cashPct < 20 || cashPct > 50) throw new Error("The cash sleeve must be 20% to 50% (the factory's limit).");
  const assets = await resolveAssets(symbols);
  const crypto = assets.filter((a) => a.kind === "crypto");
  if (crypto.length) throw new Error(`No daily price history for on-chain tokens (${crypto.map((a) => a.symbol).join(", ")}). Backtests cover tokenized stocks only.`);
  const invested = 100 - cashPct;
  const w = weightsPct ?? assets.map(() => invested / assets.length);
  if (w.length !== assets.length || Math.abs(w.reduce((a, b) => a + b, 0) - invested) > 0.01) throw new Error(`Weights must have one value per asset and add up to ${invested}% (100% minus the ${cashPct}% cash sleeve).`);
  const from = Math.floor(Date.now() / 1000) - days * 86_400;
  const [series, eth, spy] = await Promise.all([Promise.all(assets.map((a) => dailySeries(a.symbol, from))), dailySeries("ETH-USD", from), dailySeries("SPY", from)]);
  const missing = assets.filter((_, i) => !series[i]).map((a) => a.symbol);
  if (missing.length || !eth) throw new Error(`Price history unavailable for ${[...missing, ...(eth ? [] : ["ETH"])].join(", ")}; try again shortly.`);
  // trading days common to every leg, from the start date
  const startDay = Math.floor(from / 86_400);
  const maps = series.map((s) => new Map(s!.filter((p) => p.t >= startDay).map((p) => [dayKey(p.t), p.c])));
  const ethMap = new Map(eth.map((p) => [p.t, p.c]));
  const daysCommon = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d)) && ethMap.has(d)).sort((a, b) => a - b);
  if (daysCommon.length < 3) throw new Error("Not enough overlapping trading days; choose a longer window.");
  const first = daysCommon[0];
  const value = daysCommon.map((d) => (cashPct * (ethMap.get(d)! / ethMap.get(first)!) + assets.reduce((s, _, i) => s + w[i] * (maps[i].get(d)! / maps[i].get(first)!), 0)) / 100);
  let peak = value[0], mdd = 0;
  for (const v of value) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const rets = value.slice(1).map((v, i) => v / value[i] - 1), mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(252);
  const last = daysCommon[daysCommon.length - 1];
  const legs = assets.map((a, i) => ({ symbol: a.symbol, weightPct: round(w[i]), returnPct: round((maps[i].get(last)! / maps[i].get(first)! - 1) * 100) }));
  const spyMap = spy ? new Map(spy.map((p) => [p.t, p.c])) : undefined;
  return {
    window: { from: new Date(first * 86_400_000).toISOString().slice(0, 10), to: new Date(last * 86_400_000).toISOString().slice(0, 10), tradingDays: daysCommon.length },
    basketReturnPct: round((value[value.length - 1] - 1) * 100), maxDrawdownPct: round(mdd * 100), annualizedVolatilityPct: round(vol * 100),
    benchmarks: { spyPct: spyMap?.get(first) && spyMap.get(last) ? round((spyMap.get(last)! / spyMap.get(first)! - 1) * 100) : null, ethPct: round((ethMap.get(last)! / ethMap.get(first)! - 1) * 100) },
    legs: legs.sort((a, b) => b.returnPct - a.returnPct), cashPct, cashNote: "The cash sleeve is held in WETH, so it moves with ETH.",
    caveats: "Buy and hold at these weights from the first common trading day, USD, daily closes, before fees, swaps and rebalancing. Past performance does not predict future results.",
  };
}

/* ------------------------------------------------------------------ launch an index */
export async function prepareLaunch(p: { curator: string; slug: string; name: string; ticker: string; assets: string[]; weightsPct?: number[]; cashPct: number; creatorFeePct: number; feeRecipient?: string; imageUrl?: string }) {
  const curator = checkAddress(p.curator), recipient = p.feeRecipient ? checkAddress(p.feeRecipient) : curator, c = client();
  const slug = p.slug.trim().toLowerCase(), name = p.name.trim(), symbol = p.ticker.trim().replace(/^\$/, "").toUpperCase();
  if (!okUserSlug(slug)) throw new Error("The slug must be 3 to 16 lowercase letters or digits, and not reserved.");
  if (name.length < 2 || name.length > 64) throw new Error("The name must be 2 to 64 characters.");
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new Error("The ticker must be 2 to 12 letters or digits.");
  if (p.assets.length < 2 || p.assets.length > 24) throw new Error("Choose 2 to 24 assets.");
  if (p.cashPct < 20 || p.cashPct > 50) throw new Error("The cash sleeve must be 20% to 50%.");
  if (!(p.creatorFeePct >= 0 && p.creatorFeePct <= 0.5)) throw new Error("The creator fee can be 0% to 0.5% of each deposit (HOODX adds 0.1%).");
  const assets = await resolveAssets(p.assets);
  if (new Set(assets.map((a) => a.token.toLowerCase())).size !== assets.length) throw new Error("Each asset can appear only once.");
  const existing = await c.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "bySlug", args: [slug] });
  if (existing !== zeroAddress) throw new Error(`The slug "${slug}" is taken (${existing}). Choose another.`);
  const cashBps = Math.round(p.cashPct * 100), invested = 10_000 - cashBps;
  let weights = (p.weightsPct ?? assets.map(() => (invested / 100) / assets.length)).map((x) => Math.floor(x * 100));
  if (weights.length !== assets.length) throw new Error("Give one weight per asset.");
  if (!p.weightsPct) { const rem = invested - weights.reduce((a, b) => a + b, 0); weights = weights.map((x, i) => x + (i < rem ? 1 : 0)); }
  if (cashBps + weights.reduce((a, b) => a + b, 0) !== 10_000) throw new Error(`Weights must add up to ${invested / 100}% (100% minus the cash sleeve).`);
  const configs = await Promise.all(assets.map((a) => c.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "configIdByToken", args: [a.token] })));
  const image = walletImageUri(p.imageUrl ?? "") || DEFAULT_VAULT_WALLET_IMAGE;
  if (new TextEncoder().encode(image).length > 256) throw new Error("Use an HTTPS or IPFS image URL of at most 256 bytes.");
  const init = { curator, creator: curator, recipient, treasury: productionV2Treasury, name, symbol, creatorFee: Math.round(p.creatorFeePct * 100), protocolFee: 10, cashBps, firstDeposit: parseEther("0.02"), imageURI: image };
  const args = [slug, init, configs, weights] as const;
  await c.simulateContract({ account: curator, address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "createAtomic", args }).catch((x) => { throw new Error(`Launch would fail: ${explain(revertName(x))}`); });
  const data = encodeFunctionData({ abi: atomicFactoryAbi, functionName: "createAtomic", args });
  return { ok: true, action: "launch index", slug, name, ticker: `$${symbol}`, url: `${SITE_URL}/i/${slug}`,
    allocation: [...assets.map((a, i) => ({ symbol: a.symbol, weightPct: weights[i] / 100 })), { symbol: "WETH cash", weightPct: cashBps / 100 }],
    fees: { creatorPct: init.creatorFee / 100, protocolPct: 0.1, paidTo: recipient }, curator,
    transaction: tx(curator, atomicFactoryAddress, data), signing: SIGNING,
    next: `After it confirms, make the first deposit from the curator wallet: hoodx_quote_deposit with vault "${slug}" (minimum 0.02 ETH). The index opens to everyone after that.` };
}

/* ------------------------------------------------------------------ curator status: live weights, drift, roles */
async function liveBook(vault: Address, account: Address) {
  const c = client();
  const state = await readProportionalState(c, vault, account);
  const { controller, curator } = await resolveVaultAuthority(c, vault, state.owner, state.blockNumber);
  if (!controller) throw new Error("This vault has no rebalance controller; it cannot be managed through these tools.");
  const [symbols, cashBps, values, pending] = await Promise.all([
    Promise.all(state.tokens.map((t) => c.readContract({ address: t, abi: tokenAbi, functionName: "symbol" }).catch(() => `${t.slice(0, 6)}…`))),
    c.readContract({ address: vault, abi: tokenAbi, functionName: "cashTargetBps", blockNumber: state.blockNumber }),
    Promise.all(state.tokens.map((t, i) => state.balances[i] === 0n ? Promise.resolve(0n) : quoteProportionalRebalance(c, state, controller, t, false, state.balances[i]).catch(() => 0n))),
    c.readContract({ address: controller, abi: controllerAdminAbi, functionName: "pendingCurator" }).catch(() => zeroAddress),
  ]);
  return { c, state, controller, curator, symbols, cashBps: Number(cashBps), values, pending };
}
export async function curatorStatus(query: string, wallet?: string) {
  const e = await resolveAny(query);
  if (e.kind !== "atomic") throw new Error(`${e.name} is not a curated index vault (curator tools cover atomic index vaults).`);
  const who = wallet ? checkAddress(wallet) : zeroAddress;
  const b = await liveBook(e.address, who);
  const total = b.state.cash + b.values.reduce((s, v) => s + v, 0n);
  const pct = (x: bigint) => (total > 0n ? Number((x * 1_000_000n) / total) / 10_000 : 0);
  const rows = b.state.tokens.map((t, i) => ({ symbol: b.symbols[i], token: t, targetPct: b.state.targetBps[i] / 100, livePct: round(pct(b.values[i])), driftPts: round(pct(b.values[i]) - b.state.targetBps[i] / 100), valueEth: Number(formatEther(b.values[i])) }));
  const cashLive = round(pct(b.state.cash)), maxDrift = Math.max(0, ...rows.map((r) => Math.abs(r.driftPts)), Math.abs(cashLive - b.cashBps / 100));
  return { vault: e.name, slug: e.slug, address: e.address, controller: b.controller, curator: b.curator, pendingCurator: b.pending === zeroAddress ? null : b.pending,
    youAreCurator: wallet ? b.curator.toLowerCase() === who.toLowerCase() : undefined,
    holders: b.state.supply > 0n, totalValueEth: round(Number(formatEther(total)), 6), depositsPaused: b.state.paused,
    fees: { creatorPct: b.state.creatorFeeBps / 100, protocolPct: b.state.protocolFeeBps / 100 },
    cash: { targetPct: b.cashBps / 100, livePct: cashLive },
    holdings: rows.sort((a, z) => Math.abs(z.driftPts) - Math.abs(a.driftPts)),
    maxDriftPts: round(maxDrift),
    suggestion: b.state.supply === 0n ? "No holders yet: the curator's first deposit (hoodx_quote_deposit) buys the basket at its targets." : maxDrift >= 3 ? "Drift is 3 points or more: hoodx_prepare_rebalance can restore the targets in one protected transaction." : "Within 3 points of target: no rebalance needed.",
    valuation: "Live: each holding valued at what it would sell for right now through its approved route." };
}

/* ------------------------------------------------------------------ atomic rebalance (the curator desk's planner, server-side) */
export async function prepareRebalance(query: string, wallet: string, targets?: Record<string, number>, cashPct?: number) {
  // a route can move between the quote block and the simulation; re-plan from fresh quotes up to twice before giving up,
  // but only while a re-plan still fits inside an AI client's ~60s request timeout
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try { return await planRebalance(query, wallet, targets, cashPct); }
    catch (e) { if (attempt >= 2 || Date.now() - t0 > 20_000 || !(e instanceof Error) || !e.message.startsWith("Rebalance would fail now")) throw e; }
  }
}
async function planRebalance(query: string, wallet: string, targets?: Record<string, number>, cashPct?: number) {
  const e = await resolveAny(query);
  if (e.kind !== "atomic") throw new Error(`${e.name} is not an atomic index vault.`);
  const curator = checkAddress(wallet);
  const b = await liveBook(e.address, curator);
  if (b.curator.toLowerCase() !== curator.toLowerCase()) throw new Error(`Only the curator (${b.curator}) can rebalance ${e.name}.`);
  // targets: the vault's own (restore) unless new ones are given, by symbol, in percent of the whole vault
  const cashBps = cashPct === undefined ? b.cashBps : Math.round(cashPct * 100);
  if (cashBps < 2000 || cashBps > 5000) throw new Error("The cash sleeve must be 20% to 50%.");
  let weights = [...b.state.targetBps];
  if (targets) {
    const keys = Object.keys(targets).map((k) => k.replace(/^\$/, "").toUpperCase());
    const unknown = keys.filter((k) => !b.symbols.some((s) => s.toUpperCase() === k));
    if (unknown.length) throw new Error(`Not in this index: ${unknown.join(", ")}. Add an asset first with hoodx_prepare_curator_action.`);
    weights = b.symbols.map((s) => Math.round((Object.entries(targets).find(([k]) => k.replace(/^\$/, "").toUpperCase() === s.toUpperCase())?.[1] ?? 0) * 100));
  }
  if (cashBps + weights.reduce((a, x) => a + x, 0) !== 10_000) throw new Error(`Targets plus cash must total exactly 100% (now ${(cashBps + weights.reduce((a, x) => a + x, 0)) / 100}%).`);
  const s: ProportionalState = b.state, c = b.c;
  const total = s.cash + b.values.reduce((x, v) => x + v, 0n);
  if (total === 0n) throw new Error("The vault has no value to rebalance yet.");
  const minimumTrade = 100_000_000_000_000n;
  type Step = { token: Address; symbol: string; buy: boolean; amount: bigint; minOut: bigint; value: bigint };
  const sellInputs: { i: number; amount: bigint }[] = [], buyInputs: { i: number; amount: bigint }[] = [];
  for (let i = 0; i < s.tokens.length; i++) {
    const desired = (total * BigInt(weights[i])) / 10_000n, current = b.values[i];
    if (current > desired && current - desired >= minimumTrade && s.balances[i] > 0n) {
      const amount = (s.balances[i] * (current - desired)) / current; if (amount > 0n) sellInputs.push({ i, amount });
    } else if (desired > current && desired - current >= minimumTrade) buyInputs.push({ i, amount: desired - current });
  }
  // quotes are independent reads: run them side by side, so a 10-asset index plans in one round trip, not ten
  const sells: Step[] = await Promise.all(sellInputs.map(async ({ i, amount }) => {
    const out = await quoteProportionalRebalance(c, s, b.controller, s.tokens[i], false, amount);
    return { token: s.tokens[i], symbol: b.symbols[i], buy: false, amount, minOut: protectedRebalanceMinimum(out), value: out };
  }));
  const minCashAfter = (total * BigInt(cashBps)) / 10_000n;
  // size the buys from what the sells are guaranteed to return (their protected minimums), not the quote: if a sell lands
  // low, the vault must still end at or above its cash floor, or the whole move reverts
  const sellCash = sells.reduce((x, y) => x + y.minOut, 0n), available = s.cash + sellCash > minCashAfter ? s.cash + sellCash - minCashAfter : 0n;
  const requested = buyInputs.reduce((x, y) => x + y.amount, 0n);
  const sized = buyInputs.map((it) => ({ i: it.i, amount: requested > available && requested > 0n ? (it.amount * available) / requested : it.amount })).filter((it) => it.amount >= minimumTrade);
  const buys: Step[] = await Promise.all(sized.map(async ({ i, amount }) => {
    const out = await quoteProportionalRebalance(c, s, b.controller, s.tokens[i], true, amount);
    return { token: s.tokens[i], symbol: b.symbols[i], buy: true, amount, minOut: protectedRebalanceMinimum(out), value: amount };
  }));
  const steps = [...sells, ...buys];
  const basketHash = keccak256(encodeAbiParameters([{ type: "address[]" }], [s.tokens]));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const args = [cashBps, weights, steps.map(({ token, buy, amount, minOut }) => ({ token, buy, amount, minOut })), basketHash, s.nonce, minCashAfter, deadline] as const;
  await c.simulateContract({ account: curator, address: b.controller, abi: rebalanceControllerV3Abi, functionName: "atomicRebalance", args }).catch((x) => { throw new Error(`Rebalance would fail now: ${explain(revertName(x))}. A route moved during planning; try again in a minute, or rebalance in smaller steps.`); });
  const data = encodeFunctionData({ abi: rebalanceControllerV3Abi, functionName: "atomicRebalance", args });
  return { ok: true, vault: e.name, action: steps.length ? "atomic rebalance" : "set targets (no trades needed)",
    newTargets: [...b.symbols.map((sym, i) => ({ symbol: sym, targetPct: weights[i] / 100 })), { symbol: "WETH cash", targetPct: cashBps / 100 }],
    trades: steps.map((t) => ({ side: t.buy ? "buy" : "sell", symbol: t.symbol, ...(t.buy ? { spendEth: fmt(t.amount) } : { sellTokens: fmt(t.amount), receiveEthAtLeast: fmt(t.minOut) }) })),
    protection: "Sells run before buys; every leg has a minimum output, the vault keeps at least the new cash target, and the whole move reverts if the basket, its plan nonce or any route changes.",
    transaction: tx(curator, b.controller, data, 0n, deadline), quoteValidFor: "about 60 seconds; re-plan if it expires", signing: SIGNING };
}

/* ------------------------------------------------------------------ controller admin actions */
export async function prepareCuratorAction(query: string, wallet: string, action: string, p: { paused?: boolean; asset?: string; imageUrl?: string; newCurator?: string; targets?: Record<string, number>; cashPct?: number }) {
  const e = await resolveAny(query);
  if (e.kind !== "atomic") throw new Error(`${e.name} is not an atomic index vault.`);
  const curator = checkAddress(wallet), c = client();
  const state = await readProportionalState(c, e.address, curator);
  const { controller, curator: current } = await resolveVaultAuthority(c, e.address, state.owner, state.blockNumber);
  if (!controller) throw new Error("This vault has no rebalance controller.");
  if (current.toLowerCase() !== curator.toLowerCase()) throw new Error(`Only the curator (${current}) can do this.`);
  let data: `0x${string}`, summary: string;
  if (action === "pause" || action === "resume") {
    data = encodeFunctionData({ abi: rebalanceControllerV3Abi, functionName: "setPaused", args: [action === "pause"] });
    summary = action === "pause" ? "Pause new deposits. Withdrawals and redemptions stay open." : "Resume deposits.";
  } else if (action === "set_targets") {
    if (!p.targets) throw new Error("Give targets as { SYMBOL: percent }.");
    const symbols = await Promise.all(state.tokens.map((t) => c.readContract({ address: t, abi: tokenAbi, functionName: "symbol" }).catch(() => t)));
    const cashBps = Math.round((p.cashPct ?? (await c.readContract({ address: e.address, abi: tokenAbi, functionName: "cashTargetBps" })) / 100) * 100);
    const weights = symbols.map((s) => Math.round((Object.entries(p.targets!).find(([k]) => k.replace(/^\$/, "").toUpperCase() === s.toUpperCase())?.[1] ?? 0) * 100));
    if (cashBps < 2000 || cashBps > 5000 || cashBps + weights.reduce((a, x) => a + x, 0) !== 10_000) throw new Error("Cash must be 20% to 50% and targets plus cash must total exactly 100%.");
    data = encodeFunctionData({ abi: rebalanceControllerV3Abi, functionName: "setTargets", args: [cashBps, weights] });
    summary = `Save new targets without trading (cash ${cashBps / 100}%). New deposits buy at these weights; use hoodx_prepare_rebalance to move existing holdings.`;
  } else if (action === "add_asset") {
    const [asset] = await resolveAssets([p.asset ?? ""]);
    if (state.tokens.some((t) => t.toLowerCase() === asset.token.toLowerCase())) throw new Error(`${asset.symbol} is already in the index.`);
    const id = await c.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "configIdByToken", args: [asset.token] });
    data = encodeFunctionData({ abi: rebalanceControllerV3Abi, functionName: "addConstituent", args: [id] });
    summary = `Add ${asset.symbol} at a 0% target. Then raise its weight with set_targets or hoodx_prepare_rebalance.`;
  } else if (action === "remove_asset") {
    const sym = (p.asset ?? "").replace(/^\$/, "").toUpperCase();
    const symbols = await Promise.all(state.tokens.map((t) => c.readContract({ address: t, abi: tokenAbi, functionName: "symbol" }).catch(() => t)));
    let i = symbols.findIndex((s) => s.toUpperCase() === sym);
    if (i < 0) i = state.tokens.findIndex((t) => t.toLowerCase() === (p.asset ?? "").trim().toLowerCase());
    if (i < 0) throw new Error(`${p.asset} is not in this index.`);
    if (state.balances[i] > 0n) throw new Error(`The vault still holds ${symbols[i]}. Set its target to 0% and rebalance first, then remove it.`);
    data = encodeFunctionData({ abi: rebalanceControllerV3Abi, functionName: "removeConstituent", args: [state.tokens[i]] });
    summary = `Remove ${symbols[i]} (zero balance) from the index.`;
  } else if (action === "set_image") {
    const uri = walletImageUri(p.imageUrl ?? "");
    if (!uri || new TextEncoder().encode(uri).length > 256) throw new Error("Use an HTTPS or IPFS image URL of at most 256 bytes.");
    data = encodeFunctionData({ abi: controllerAdminAbi, functionName: "setImageURI", args: [uri] });
    summary = "Update the index token image shown in wallets and on HOODX.";
  } else if (action === "propose_curator") {
    const next = checkAddress(p.newCurator ?? "");
    data = encodeFunctionData({ abi: controllerAdminAbi, functionName: "proposeCurator", args: [next] });
    summary = `Nominate ${next} as curator. Nothing changes until that wallet calls acceptCurator(); you stay curator until then.`;
  } else throw new Error("action must be one of: pause, resume, set_targets, add_asset, remove_asset, set_image, propose_curator.");
  await c.call({ account: curator, to: controller, data }).catch((x) => { throw new Error(`This would fail now: ${explain(revertName(x))}`); });
  return { ok: true, vault: e.name, action, summary, transaction: tx(curator, controller, data), signing: SIGNING };
}
