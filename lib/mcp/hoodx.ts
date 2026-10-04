/* The HOODX tool layer behind the MCP server (app/mcp/route.ts). Everything here reads public chain state or builds an
 * UNSIGNED transaction from a simulation of the user's own address. Nothing here can sign, hold keys or move funds: the
 * user signs in their own wallet, or opens the review link and signs on xhoodindex.com. */
import { BaseError, ContractFunctionRevertedError, createPublicClient, encodeFunctionData, formatEther, http, isAddress, parseAbi, parseEther, getAddress, type Address, type PublicClient } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL, SITE_URL } from "@/lib/config";
import { BOOST, boostSignalAbi, boostVaultAbi } from "@/lib/boost";
import { AUTO_LP, initialProbeShares, sizeShares, stockLpVaultAbi } from "@/lib/stockLp";
import { FEATURED_VAULTS, type VaultMeta } from "@/lib/vaults";
import { v2VaultAbi, verifiedV2Vaults } from "@/lib/v2";
import { launchReturnBps } from "@/lib/v2Performance";
import { vaultNav, readPositions } from "@/lib/myVaultsServer";
import { proportionalAbi, prepareProportionalBootstrap, prepareProportionalDeposit, prepareProportionalWithdrawal, quoteProportionalBootstrap, quoteProportionalDeposit, quoteProportionalWithdrawal, readProportionalState } from "@/lib/proportionalQuote";
import { withdrawalFloor } from "@/lib/withdrawMinimum";
import { protectedWithdrawalMinimum } from "@/lib/v2WithdrawalQuote";

export const CHAIN_ID = 4663;
const ETH_FEED = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as Address;
const BTC_FEED = "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251" as Address;
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const erc20 = parseAbi(["function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)"]);
export const BRIDGES = [
  { name: "Relay", url: "https://relay.link/bridge/robinhood", speed: "seconds" },
  { name: "Across", url: "https://across.to/?to=robinhood", speed: "seconds" },
  { name: "Official Robinhood Chain bridge (Arbitrum)", url: "https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum", speed: "about 10 minutes" },
];

export const client = (): PublicClient => createPublicClient({ chain: robinhood, batch: { multicall: true }, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 15_000, retryCount: 1 }) }) as PublicClient;

/* ------------------------------------------------------------------ the vault registry */
export type Kind = "boost" | "autolp" | "atomic" | "v2";
export type Entry = { slug: string; name: string; ticker: string; kind: Kind; type: "automated" | "index"; address: Address; url: string; summary: string; category?: string; meta?: VaultMeta };

export function registry(): Entry[] {
  const out: Entry[] = [];
  if (BOOST.vault) out.push({ slug: "boost", name: "Boosted ETH", ticker: "BOOSTX", kind: "boost", type: "automated", address: BOOST.vault, url: `${SITE_URL}/boost`,
    summary: "Smart ETH leverage from 0x to 2x. An on-chain trend signal (Chainlink ETH and BTC) holds up to 2x ETH while crypto trends up and steps aside into dollars earning yield when the trend breaks." });
  if (AUTO_LP.vault) out.push({ slug: "autolp", name: "Hands-free LP", ticker: "STKX", kind: "autolp", type: "automated", address: AUTO_LP.vault, url: `${SITE_URL}/autolp`,
    summary: "Deposit ETH once. Earns trading fees as Uniswap V4 liquidity on 8 tokenized stocks, rebalanced and compounded by on-chain rules every hour." });
  for (const v of FEATURED_VAULTS) {
    if (v.status === "pilot") continue;
    const address = (v.address ?? verifiedV2Vaults[v.slug]) as Address | undefined;
    if (!address) continue;
    out.push({ slug: v.slug, name: v.name, ticker: v.symbol, kind: v.address ? "atomic" : "v2", type: "index", address, url: `${SITE_URL}/i/${v.slug}`, summary: v.thesis, category: v.flair, meta: v });
  }
  return out;
}
export function resolve(query: string): Entry {
  const q = query.trim().toLowerCase().replace(/^\$/, "");
  const all = registry();
  const hit = all.find((e) => e.slug === q || e.ticker.toLowerCase() === q || e.name.toLowerCase() === q || e.address.toLowerCase() === q)
    ?? all.find((e) => e.name.toLowerCase().includes(q) || (q.length >= 3 && e.slug.includes(q)));
  if (!hit) throw new Error(`Unknown vault "${query}". Known: ${all.map((e) => `${e.slug} ($${e.ticker})`).join(", ")}.`);
  return hit;
}

/* ------------------------------------------------------------------ shared helpers */
export const fmt = (wei: bigint, digits = 6) => Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: digits });
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const deadline = (seconds = 240) => BigInt(Math.floor(Date.now() / 1000) + seconds);
export function checkAddress(a: string): Address {
  if (!isAddress(a)) throw new Error(`"${a}" is not a valid EVM address.`);
  return getAddress(a);
}
function revertName(e: unknown): string {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? r.reason ?? "reverted" : e instanceof BaseError ? e.shortMessage : String(e);
}
async function json<T>(origin: string, path: string): Promise<T | undefined> {
  return fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? (r.json() as Promise<T>) : undefined)).catch(() => undefined);
}
type BoostStats = { navUsd: number; navEth: number; ethUsd: number; leverage: number; target: number; sigma: number; capUsd: number; capacityPct: number; sinceLaunchUsdPct: number; sinceLaunchEthPct: number; depositsPaused: boolean; fresh: boolean; lastRebalance: number };
type LpStats = { navUsd: number; navEth: number; ethUsd: number; supply: number; perShareEth: number; perShareUsd: number; sinceLaunchUsdPct: number; capUsd: number; capacityPct: number; sleeves?: { symbol: string; inRange: boolean; referenceAgrees: boolean }[] };
type Sim = { pct: number; since: number };
export const boostStats = (o: string) => json<BoostStats>(o, "/api/boost-stats");
export const lpStats = (o: string) => json<LpStats>(o, "/api/autolp-stats");
const regime = (lev: number) => lev < 0.05 ? "in dollars (stepped aside, earning yield)" : lev < 0.95 ? "partly in dollars" : lev < 1.5 ? "about 1x ETH" : "boosted";
function fundingHint(balance: bigint) {
  return balance < parseEther("0.003") ? { note: "This wallet has almost no ETH on Robinhood Chain. Bridge ETH from Ethereum, Base or Arbitrum first.", bridges: BRIDGES } : undefined;
}
function txOut(from: Address, to: Address, data: `0x${string}`, value: bigint, expires: bigint) {
  return { chainId: CHAIN_ID, from, to, data, value: value.toString(), valueEth: formatEther(value), expiresAt: new Date(Number(expires) * 1000).toISOString() };
}
const SIGNING = "Unsigned. Sign it in your own wallet on Robinhood Chain (chain 4663) before it expires, or open reviewUrl to review and sign on xhoodindex.com. HOODX never asks for keys.";

/* ------------------------------------------------------------------ read tools */
export async function overview(origin: string) {
  const [tvl, boost, lp] = await Promise.all([json<{ usd: number; eth: number; vaults: number }>(origin, "/api/platform-tvl"), boostStats(origin), lpStats(origin)]);
  return {
    protocol: "HOODX, on-chain vaults on Robinhood Chain (chain 4663). Deposit ETH, receive an ERC-20 share token, withdraw ETH. Rules run on-chain; nobody can move holder funds.",
    totalValueUsd: tvl ? round(tvl.usd) : null, totalValueEth: tvl ? round(tvl.eth, 4) : null, fundedVaults: tvl?.vaults ?? null,
    products: [
      { name: "Boosted ETH", slug: "boost", valueUsd: boost ? round(boost.navUsd) : null, leverage: boost ? round(boost.leverage) : null, sinceLaunchPct: boost ? round(boost.sinceLaunchUsdPct) : null, url: `${SITE_URL}/boost` },
      { name: "Hands-free LP", slug: "autolp", valueUsd: lp ? round(lp.navUsd) : null, sinceLaunchPct: lp ? round(lp.sinceLaunchUsdPct) : null, url: `${SITE_URL}/autolp` },
      { name: "Index collections", count: registry().filter((e) => e.type === "index").length, url: `${SITE_URL}/explore` },
    ],
    site: SITE_URL, agentReference: `${SITE_URL}/llms.txt`,
  };
}

export async function listVaults(origin: string, type?: string) {
  const entries = registry().filter((e) => !type || type === "all" || e.type === type);
  const [boost, lp, sims] = await Promise.all([boostStats(origin), lpStats(origin), json<Record<string, Sim>>(origin, "/api/collection-returns")]);
  const ethUsd = boost?.ethUsd ?? lp?.ethUsd ?? 0;
  const rows = await Promise.all(entries.map(async (e) => {
    let valueUsd: number | null = null, ret: number | null = null, basis = "", holders = true;
    if (e.kind === "boost" && boost) { valueUsd = boost.navUsd; ret = boost.sinceLaunchUsdPct; basis = "live, USD"; }
    else if (e.kind === "autolp" && lp) { valueUsd = lp.navUsd; ret = lp.sinceLaunchUsdPct; basis = "live, USD"; }
    else {
      const nav = await vaultNav(e.address).catch(() => null);
      const supply = nav ? BigInt(nav.supply) : 0n, assets = nav?.assetsWei ? BigInt(nav.assetsWei) : 0n;
      holders = supply > 0n;
      if (holders) {
        valueUsd = Number(formatEther(assets)) * ethUsd;
        const bps = launchReturnBps(assets, supply);
        if (bps !== undefined) { ret = Number(bps) / 100; basis = "live, per share in ETH"; }
      } else if (sims?.[e.slug]) { valueUsd = 0; ret = sims[e.slug].pct; basis = `simulated: what its on-chain basket would have returned since launch (${new Date(sims[e.slug].since * 1000).toISOString().slice(0, 10)}), USD, before fees; no holders yet`; }
      else valueUsd = 0;
    }
    return { name: e.name, slug: e.slug, ticker: `$${e.ticker}`, type: e.type, category: e.category, address: e.address, valueUsd: valueUsd === null ? null : round(valueUsd), sinceLaunchPct: ret === null ? null : round(ret), returnBasis: basis || null, acceptingDeposits: e.type === "automated" || holders, summary: e.summary, url: e.url };
  }));
  return { vaults: rows, note: "Index collections without holders accept their first deposit from their curator only (bootstrap); after that anyone can join." };
}

export async function getVault(origin: string, query: string) {
  const e = resolve(query), c = client();
  if (e.kind === "boost") {
    const s = await boostStats(origin);
    return { ...base(e), strategy: e.summary, state: s && { valueUsd: round(s.navUsd), valueEth: round(s.navEth, 5), leverage: round(s.leverage, 3), signalTarget: round(s.target, 3), regime: regime(s.leverage), ethVolatility: round(s.sigma, 3), sinceLaunchUsdPct: round(s.sinceLaunchUsdPct), sinceLaunchEthPct: round(s.sinceLaunchEthPct), capacityUsed: `${round(s.capacityPct)}% of $${s.capUsd.toLocaleString("en-US")}`, depositsPaused: s.depositsPaused, signalFresh: s.fresh, lastRebalance: s.lastRebalance ? new Date(s.lastRebalance * 1000).toISOString() : null },
      terms: { minimumDeposit: "0.005 ETH", performanceFee: "10% of gains above the high-water mark", exits: "never paused; swap-free in-kind exit always available", legos: "Morpho Blue (WETH/USDG, 77% LLTV), Uniswap V3 USDG/WETH 0.01%, steakUSDG, Chainlink" },
      risks: ["At 2x a 30% ETH fall costs about 60% before the vault can cut.", "Trend following lags sharp reversals.", "No sequencer-uptime feed on Robinhood Chain."],
      explainSignal: "Call hoodx_boost_signal for the exact ETH and BTC price levels that would change the leverage." };
  }
  if (e.kind === "autolp") {
    const s = await lpStats(origin);
    return { ...base(e), strategy: e.summary, state: s && { valueUsd: round(s.navUsd), valueEth: round(s.navEth, 5), perShareUsd: round(s.perShareUsd, 4), sinceLaunchUsdPct: round(s.sinceLaunchUsdPct), capacityUsed: `${round(s.capacityPct)}% of $${s.capUsd.toLocaleString("en-US")}`,
      sleeves: s.sleeves?.map((x) => ({ stock: x.symbol, earningFees: x.inRange && x.referenceAgrees, inRange: x.inRange })) },
      terms: { minimumDeposit: "about $10", exits: "withdrawEth any time; exitToSleeveShares is the swap-free emergency exit", management: "public keeper rebalances and compounds every hour" } };
  }
  // index vaults: holdings and weights straight from the chain
  const abi = e.kind === "atomic" ? proportionalAbi : v2VaultAbi;
  const tokens = (await c.readContract({ address: e.address, abi: proportionalAbi, functionName: "constituents" })) as readonly Address[];
  const [cash, supply, creatorFee, protocolFee, paused, weights, symbols, nav] = await Promise.all([
    c.readContract({ address: e.address, abi: parseAbi(["function cashTargetBps() view returns (uint16)"]), functionName: "cashTargetBps" }).catch(() => null),
    c.readContract({ address: e.address, abi: proportionalAbi, functionName: "totalSupply" }),
    c.readContract({ address: e.address, abi: proportionalAbi, functionName: "creatorFeeBps" }).catch(() => null),
    c.readContract({ address: e.address, abi: proportionalAbi, functionName: "protocolFeeBps" }).catch(() => null),
    c.readContract({ address: e.address, abi: proportionalAbi, functionName: "paused" }).catch(() => null),
    Promise.all(tokens.map((t) => c.readContract({ address: e.address, abi: proportionalAbi, functionName: "targetBps", args: [t] }).catch(() => null))),
    Promise.all(tokens.map((t) => c.readContract({ address: t, abi: erc20, functionName: "symbol" }).catch(() => "?"))),
    vaultNav(e.address).catch(() => null),
  ]);
  void abi;
  const [sims, boost] = await Promise.all([json<Record<string, Sim>>(origin, "/api/collection-returns"), boostStats(origin)]);
  const assets = nav?.assetsWei ? BigInt(nav.assetsWei) : 0n, bps = launchReturnBps(assets, supply);
  return { ...base(e), thesis: e.summary, category: e.category,
    holdings: tokens.map((t, i) => ({ token: t, symbol: symbols[i], targetWeightPct: weights[i] === null ? null : Number(weights[i]) / 100 })),
    cashSleevePct: cash === null ? null : Number(cash) / 100,
    fees: { creatorPct: creatorFee === null ? null : Number(creatorFee) / 100, protocolPct: protocolFee === null ? null : Number(protocolFee) / 100, charged: "on deposits; withdrawals are free" },
    state: { holders: supply > 0n, valueEth: round(Number(formatEther(assets)), 5), valueUsd: boost ? round(Number(formatEther(assets)) * boost.ethUsd) : null, depositsPaused: paused,
      sinceLaunchPct: bps !== undefined ? round(Number(bps) / 100) : sims?.[e.slug] ? round(sims[e.slug].pct) : null,
      returnBasis: bps !== undefined ? "live, per share in ETH" : sims?.[e.slug] ? "simulated since launch from on-chain weights, USD, before fees (no holders yet)" : null },
    howToJoin: supply > 0n ? "hoodx_quote_deposit (minimum 0.02 ETH)" : "Awaiting its first deposit, which only the curator can make. Not yet open to others." };
}
function base(e: Entry) { return { name: e.name, slug: e.slug, ticker: `$${e.ticker}`, type: e.type, vault: e.address, url: e.url, chainId: CHAIN_ID }; }

export async function boostSignal() {
  const c = client();
  if (!BOOST.signal) throw new Error("Boosted ETH signal is not configured.");
  const [snap, eth, btc] = await Promise.all([
    c.readContract({ address: BOOST.signal, abi: boostSignalAbi, functionName: "snapshot" }),
    c.readContract({ address: ETH_FEED, abi: feedAbi, functionName: "latestRoundData" }),
    c.readContract({ address: BTC_FEED, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const [target, sigma, ethFlags, btcFlags, ethEma, btcEma] = snap;
  const ethPx = Number(eth[1]) / 1e8, btcPx = Number(btc[1]) / 1e8;
  const spans = ["20-day (slow)", "50-day (slow)", "100-day (slow)", "200-day (slow)", "5-day (fast)", "10-day (fast)", "20-day (fast)", "50-day (fast)"];
  const lines = (flags: number, emas: readonly bigint[], px: number) => emas.map((raw, i) => {
    const ema = Number(raw) / 1e18, on = ((flags >> i) & 1) === 1;
    return { trend: spans[i], on, ema: round(ema, 2), turnsOffBelow: round(ema * 0.99, 2), turnsOnAbove: round(ema * 1.01, 2), priceVsTriggerPct: round(((on ? px / (ema * 0.99) : px / (ema * 1.01)) - 1) * 100) };
  });
  const count = (f: number, lo: number) => [0, 1, 2, 3].reduce((n, i) => n + ((f >> (i + lo)) & 1), 0);
  const slow = (count(ethFlags, 0) + count(btcFlags, 0)) / 8, fast = (count(ethFlags, 4) + count(btcFlags, 4)) / 8, s = Number(sigma) / 1e18;
  const room = Math.max(0, Math.min(2, 2.4 / Math.max(s, 1e-9)) - 1);
  return {
    target: round(Number(target) / 1e18, 3), slowTrend: slow, fastTrend: fast, ethVolatility: round(s, 3), boosterRoom: round(room, 3),
    formula: "target = min(2, slow + (slow >= 0.75 ? fast x (min(2, 2.4/vol) - 1) : 0)). slow and fast are the share of 8 trend flags on (ETH and BTC count 50/50). A flag turns off only below its EMA x 0.99 and on only above EMA x 1.01. All dollars (0x) only when every slow flag is off.",
    eth: { price: round(ethPx, 2), flags: lines(ethFlags, ethEma, ethPx) },
    btc: { price: round(btcPx, 2), flags: lines(btcFlags, btcEma, btcPx) },
    readHow: "priceVsTriggerPct is how far price must move to flip that flag (negative: a fall of that size turns an ON flag off). EMAs drift toward price every hour, so levels move over time.",
  };
}

export async function positions(origin: string, wallet: string) {
  const addr = checkAddress(wallet), c = client();
  const [pos, balance, lp, lpShares, boost] = await Promise.all([
    readPositions(addr), c.getBalance({ address: addr }), lpStats(origin),
    AUTO_LP.vault ? c.readContract({ address: AUTO_LP.vault, abi: stockLpVaultAbi, functionName: "balanceOf", args: [addr] }).catch(() => 0n) : Promise.resolve(0n),
    boostStats(origin),
  ]);
  const ethUsd = boost?.ethUsd ?? lp?.ethUsd ?? 0;
  const rows = pos.positions.filter((p) => p.kind !== "autolp").map((p) => {
    const value = p.valueWei ? Number(formatEther(BigInt(p.valueWei))) : null;
    const acct = p.account as { depositedWei?: string; withdrawnWei?: string } | null;
    return { vault: p.name, ticker: `$${p.symbol}`, slug: p.slug, shares: fmt(BigInt(p.shares)), valueEth: value === null ? null : round(value, 6), valueUsd: value === null ? null : round(value * ethUsd), estimated: p.estimated, depositedEth: acct?.depositedWei ? round(Number(formatEther(BigInt(acct.depositedWei))), 6) : null, withdrawnEth: acct?.withdrawnWei ? round(Number(formatEther(BigInt(acct.withdrawnWei))), 6) : null };
  });
  if (lpShares > 0n && lp) { const v = Number(formatEther(lpShares)) * lp.perShareEth; rows.push({ vault: "Hands-free LP", ticker: "$STKX", slug: "autolp", shares: fmt(lpShares), valueEth: round(v, 6), valueUsd: round(v * ethUsd), estimated: false, depositedEth: null, withdrawnEth: null }); }
  const total = rows.reduce((s, r) => s + (r.valueEth ?? 0), 0);
  return { wallet: addr, ethBalanceOnRobinhoodChain: fmt(balance), positions: rows, totalValueEth: round(total, 6), totalValueUsd: round(total * ethUsd), funding: fundingHint(balance), myVaultsUrl: `${SITE_URL}/explore` };
}

/* ------------------------------------------------------------------ transaction builders (simulate, never sign) */
export async function quoteDeposit(origin: string, query: string, amountEth: string, wallet: string) {
  const e = resolve(query), from = checkAddress(wallet), c = client();
  let value: bigint;
  try { value = parseEther(amountEth); } catch { throw new Error(`"${amountEth}" is not an ETH amount.`); }
  if (value <= 0n) throw new Error("Amount must be above zero.");
  const balance = await c.getBalance({ address: from });
  const review = `${e.url}?deposit=${encodeURIComponent(formatEther(value))}`;
  if (balance < value) return { ok: false, reason: `Wallet holds ${fmt(balance)} ETH on Robinhood Chain; this deposit needs ${formatEther(value)} ETH plus gas.`, funding: { bridges: BRIDGES }, reviewUrl: review };

  if (e.kind === "boost") {
    if (value < parseEther("0.005")) throw new Error("Boosted ETH minimum deposit is 0.005 ETH.");
    const dl = deadline();
    const sim = await c.simulateContract({ account: from, address: e.address, abi: boostVaultAbi, functionName: "deposit", args: [from, 1n, dl], value }).catch((x) => { throw new Error(`Deposit would fail now: ${explain(revertName(x))}`); });
    const minShares = (sim.result * 99n) / 100n;
    const data = encodeFunctionData({ abi: boostVaultAbi, functionName: "deposit", args: [from, minShares, dl] });
    await c.call({ account: from, to: e.address, data, value }).catch((x) => { throw new Error(`Protected deposit would fail: ${explain(revertName(x))}`); });
    return { ok: true, vault: e.name, action: "deposit", payEth: formatEther(value), expectedShares: fmt(sim.result), minimumShares: fmt(minShares), protection: "reverts if fewer than 99% of the quoted shares", transaction: txOut(from, e.address, data, value, dl), reviewUrl: review, signing: SIGNING };
  }
  if (e.kind === "autolp") {
    const s = await lpStats(origin);
    if (!s) throw new Error("Hands-free LP stats are unavailable; try again shortly.");
    const dl = deadline();
    const sim = (shares: bigint) => c.simulateContract({ account: from, address: e.address, abi: stockLpVaultAbi, functionName: "depositEth", args: [shares, from, dl], value }).then((r) => r.result);
    // size the exact share amount the ETH buys: probe, then bisect between too small and too large (as the site does)
    let probe = initialProbeShares(value, s.perShareEth), used = 0n, last = "", lo = 0n, hi = 0n;
    if (probe === 0n) probe = (BigInt(Math.floor(s.supply * 1e6)) * 10n ** 12n) / 50n;
    for (let k = 0; k < 12 && used === 0n && probe > 0n; k++) {
      try { used = await sim(probe); }
      catch (x) { last = revertName(x); if (last === "BelowMinimum") lo = probe; else hi = probe; probe = lo > 0n && hi > 0n ? (lo + hi) / 2n : last === "BelowMinimum" ? probe * 2n : probe / 2n; }
    }
    if (used === 0n) throw new Error(`Entry unavailable right now: ${explain(last)}`);
    const shares = sizeShares(probe, used, value);
    const ethUsed = await sim(shares).catch((x) => { throw new Error(`Deposit would fail now: ${explain(revertName(x))}`); });
    const data = encodeFunctionData({ abi: stockLpVaultAbi, functionName: "depositEth", args: [shares, from, dl] });
    return { ok: true, vault: e.name, action: "deposit", sendEth: formatEther(value), shares: fmt(shares), ethUsed: fmt(ethUsed), refundedToYou: fmt(value - ethUsed), protection: "mints exactly these shares; any ETH not needed is refunded in the same transaction", transaction: txOut(from, e.address, data, value, dl), reviewUrl: review, signing: SIGNING };
  }
  if (e.kind === "atomic") {
    const state = await readProportionalState(c, e.address, from);
    if (state.supply === 0n) {
      const isCurator = [state.owner, state.creator].some((a) => a.toLowerCase() === from.toLowerCase());
      if (!isCurator) return { ok: false, reason: `${e.name} has no holders yet. Its first deposit can only come from its curator; it opens to everyone after that.`, reviewUrl: e.url };
      const plan = await quoteProportionalBootstrap(c, state, value);
      await prepareProportionalBootstrap(c, state, plan);
      const data = encodeFunctionData({ abi: proportionalAbi, functionName: "bootstrap", args: [plan.floors, plan.nonce, plan.deadline] });
      return { ok: true, vault: e.name, action: "first deposit (bootstrap)", payEth: formatEther(plan.value), expectedShares: fmt(plan.shares), feeEth: fmt(plan.fee), protection: "every asset leg has a 3% minimum output", transaction: txOut(from, e.address, data, plan.value, plan.deadline), reviewUrl: review, signing: SIGNING };
    }
    if (value < parseEther("0.02")) throw new Error("Minimum deposit for an index collection is 0.02 ETH.");
    const plan = await quoteProportionalDeposit(c, state, value);
    await prepareProportionalDeposit(c, state, plan);
    const data = encodeFunctionData({ abi: proportionalAbi, functionName: "depositExactShares", args: [plan.shares, plan.budgets, plan.floors, plan.nonce, plan.deadline] });
    return { ok: true, vault: e.name, action: "deposit", sendEth: formatEther(plan.value), sharesReceived: fmt(plan.shares), estimatedCostEth: fmt(plan.grossSpent), feeIncludedEth: fmt(plan.fee), unusedEthReturned: fmt(plan.ethRefund), protection: "buys every holding in proportion with per-asset minimum outputs; bound to this block's plan nonce", transaction: txOut(from, e.address, data, plan.value, plan.deadline), quoteValidFor: "about 60 seconds; re-quote if it expires", reviewUrl: review, signing: SIGNING };
  }
  // V2
  const preview = await c.readContract({ address: e.address, abi: v2VaultAbi, functionName: "previewDeposit", args: [value] });
  const floor = (preview * 99n) / 100n, dl = deadline();
  const data = encodeFunctionData({ abi: v2VaultAbi, functionName: "deposit", args: [floor, dl] });
  await c.call({ account: from, to: e.address, data, value }).catch((x) => { throw new Error(`Deposit would fail now: ${explain(revertName(x))}`); });
  return { ok: true, vault: e.name, action: "deposit", payEth: formatEther(value), expectedShares: fmt(preview), minimumShares: fmt(floor), protection: "reverts if fewer than 99% of the previewed shares", transaction: txOut(from, e.address, data, value, dl), reviewUrl: review, signing: SIGNING };
}

export async function quoteWithdraw(origin: string, query: string, wallet: string, percent: number) {
  const e = resolve(query), from = checkAddress(wallet), c = client();
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error("percent must be a whole number from 1 to 100.");
  const review = `${e.url}?withdraw=${percent}`;
  const held = await c.readContract({ address: e.address, abi: erc20, functionName: "balanceOf", args: [from] });
  if (held === 0n) return { ok: false, reason: `This wallet holds no ${e.name} shares.`, reviewUrl: e.url };
  const shares = (held * BigInt(percent)) / 100n;
  if (e.kind === "boost") {
    const dl = deadline();
    const sim = await c.simulateContract({ account: from, address: e.address, abi: boostVaultAbi, functionName: "withdraw", args: [shares, from, 1n, dl] }).catch((x) => { throw new Error(`ETH exit cannot be simulated right now (${explain(revertName(x))}). Use the in-kind exit on the vault page instead; it needs no swap.`); });
    const minOut = (sim.result * 99n) / 100n;
    const data = encodeFunctionData({ abi: boostVaultAbi, functionName: "withdraw", args: [shares, from, minOut, dl] });
    const inKind = await c.readContract({ address: e.address, abi: boostVaultAbi, functionName: "previewExitInKind", args: [shares] }).catch(() => null);
    return { ok: true, vault: e.name, action: `withdraw ${percent}%`, shares: fmt(shares), expectedEth: fmt(sim.result), minimumEth: fmt(minOut), protection: "reverts if under 99% of the quoted ETH", transaction: txOut(from, e.address, data, 0n, dl),
      swapFreeAlternative: inKind && { how: "exitInKind(shares, receiver) after approving usdgToApprove USDG to the vault", wethOut: fmt(inKind[0]), usdgToApprove: (Number(inKind[1]) / 1e6).toFixed(2), steakUsdgSharesOut: fmt(inKind[2]) },
      reviewUrl: review, signing: SIGNING };
  }
  if (e.kind === "autolp") {
    const dl = deadline();
    const out = await c.simulateContract({ account: from, address: e.address, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, from, 1n, dl] }).then((r) => r.result).catch((x) => { throw new Error(`ETH exit cannot be simulated right now (${explain(revertName(x))}). The emergency exit exitToSleeveShares returns your share of each stock LP sleeve with no swap.`); });
    const minOut = (out * 9850n) / 10_000n;
    const data = encodeFunctionData({ abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, from, minOut, dl] });
    void origin;
    return { ok: true, vault: e.name, action: `withdraw ${percent}%`, shares: fmt(shares), expectedEth: fmt(out), minimumEth: fmt(minOut), protection: "reverts if under 98.5% of the quoted ETH", transaction: txOut(from, e.address, data, 0n, dl), swapFreeAlternative: "exitToSleeveShares(shares, receiver)", reviewUrl: review, signing: SIGNING };
  }
  if (e.kind === "atomic") {
    const state = await readProportionalState(c, e.address, from);
    const plan = await quoteProportionalWithdrawal(c, state, shares);
    await prepareProportionalWithdrawal(c, state, plan);
    const data = encodeFunctionData({ abi: proportionalAbi, functionName: "withdraw", args: [plan.shares, plan.minEthOut, plan.floors, plan.nonce, plan.deadline] });
    return { ok: true, vault: e.name, action: `withdraw ${percent}%`, shares: fmt(plan.shares), minimumEth: fmt(plan.minEthOut), protection: "sells your share of every holding with per-asset floors and an overall ETH minimum", transaction: txOut(from, e.address, data, 0n, plan.deadline), quoteValidFor: "about 60 seconds", swapFreeAlternative: "emergencyRedeemInKind(shares, recipient) returns your proportional tokens and cash with no swap", reviewUrl: review, signing: SIGNING };
  }
  const [supply, assets] = await Promise.all([
    c.readContract({ address: e.address, abi: v2VaultAbi, functionName: "totalSupply" }),
    c.readContract({ address: e.address, abi: v2VaultAbi, functionName: "totalAssets" }).catch(() => undefined),
  ]);
  const navFloor = assets === undefined ? 1n : withdrawalFloor(assets, held, supply, percent).floor;
  const dl = deadline();
  const out = await c.simulateContract({ account: from, address: e.address, abi: v2VaultAbi, functionName: "withdraw", args: [shares, navFloor, dl] }).then((r) => r.result).catch((x) => { throw new Error(`ETH exit cannot be simulated (${explain(revertName(x))}). emergencyRedeemInKind returns your proportional tokens and cash with no swap.`); });
  const { floor } = protectedWithdrawalMinimum(out, navFloor);
  const data = encodeFunctionData({ abi: v2VaultAbi, functionName: "withdraw", args: [shares, floor, dl] });
  return { ok: true, vault: e.name, action: `withdraw ${percent}%`, shares: fmt(shares), expectedEth: fmt(out), minimumEth: fmt(floor), protection: "reverts below 99% of the quote or the NAV floor, whichever is higher", transaction: txOut(from, e.address, data, 0n, dl), reviewUrl: review, signing: SIGNING };
}

/** Plain-language meaning of the vaults' custom errors. */
export function explain(name: string) {
  const m: Record<string, string> = {
    Divergence: "the pool and oracle prices are more than 1% apart; retry in a minute",
    CapExceeded: "the vault is at its deposit cap",
    BelowMinimum: "the amount is below the vault minimum",
    Paused: "deposits are paused (withdrawals stay open)",
    Slippage: "the price moved beyond the protection limit; re-quote",
    Stale: "a price feed is stale; retry shortly",
    Illiquid: "a pool cannot take this size right now; try a smaller amount",
  };
  return m[name] ? `${name}: ${m[name]}` : name;
}
