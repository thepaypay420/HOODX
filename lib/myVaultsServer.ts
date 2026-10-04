import { unstable_cache } from "next/cache";
import { createPublicClient, decodeErrorResult, decodeFunctionResult, encodeFunctionData, http, parseAbi, parseAbiItem, zeroAddress, type Address, type PublicClient } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { atomicFactoryAddress, atomicFactoryStartBlock } from "@/lib/atomicFactory";
import { productionV2Factory } from "@/lib/v2";
import { rebalanceControllerV3Abi } from "@/lib/rebalanceController";
import { AUTO_LP } from "@/lib/stockLp";
import { BOOST, boostVaultAbi } from "@/lib/boost";
import { accountFor, type Accounting } from "@/lib/positionAccounting";
import { scanLogs } from "@/lib/logScan";

/* "My Vaults": which HOODX vaults a wallet holds, what its shares are worth, and how that compares with what it paid.
 * The RPC is read in a few batched Multicall3 requests, and every layer is cached so traffic never scales the chain reads:
 *   the vault list for 10 minutes, each vault's value for 60 seconds (shared by every visitor), a wallet's balances
 *   for 20 seconds and its cost basis for 30 seconds. */

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const V2_START = 67_761_602n;
const mc3 = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])"]);
const vaultAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function totalAssets() view returns (uint256)",
  "function symbol() view returns (string)", "function name() view returns (string)", "function constituents() view returns (address[])",
  "function weth() view returns (address)", "function freeBalance(address) view returns (uint256)", "function owner() view returns (address)",
]);
const created = parseAbiItem("event Created(address indexed vault, string slug, address curator, address creator)");

export type Kind = "v2" | "v3" | "autolp" | "boost";
export type VaultRef = { vault: Address; slug: string; kind: Kind; symbol: string; name: string };
type Call = { target: Address; data: `0x${string}` };

let _client: PublicClient | undefined;
const client = () => (_client ??= createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 12_000, retryCount: 1 }) }) as PublicClient);

/** one Multicall3 round trip; failed calls come back as `{ ok: false, data }` (data holds revert bytes, which quotes rely on) */
async function batch(calls: Call[]) {
  if (!calls.length) return [] as { ok: boolean; data: `0x${string}` }[];
  const out: { ok: boolean; data: `0x${string}` }[] = [];
  for (let i = 0; i < calls.length; i += 400) {
    const part = calls.slice(i, i + 400);
    const res = await client().readContract({ address: MULTICALL3, abi: mc3, functionName: "aggregate3", args: [part.map((c) => ({ target: c.target, allowFailure: true, callData: c.data }))] });
    for (const r of res) out.push({ ok: r.success, data: r.returnData });
  }
  return out;
}
const enc = (fn: string, args: readonly unknown[] = []) => encodeFunctionData({ abi: vaultAbi, functionName: fn as never, args: args as never });
const decodeResult = (fn: string, data: `0x${string}`) => decodeFunctionResult({ abi: vaultAbi, functionName: fn as never, data });
/* ------------------------------------------------------------------ every vault the protocol knows about (10 minutes) */
export const vaultUniverse = unstable_cache(async (): Promise<VaultRef[]> => {
  const [v2, v3] = await Promise.all([
    scanLogs(productionV2Factory, created, undefined, V2_START),
    scanLogs(atomicFactoryAddress, created, undefined, atomicFactoryStartBlock),
  ]);
  const refs = [...v2.map((l) => ({ vault: l.args.vault!, slug: l.args.slug!, kind: "v2" as Kind })), ...v3.map((l) => ({ vault: l.args.vault!, slug: l.args.slug!, kind: "v3" as Kind }))];
  if (AUTO_LP.vault) refs.push({ vault: AUTO_LP.vault, slug: AUTO_LP.slug, kind: "autolp" });
  if (BOOST.vault) refs.push({ vault: BOOST.vault, slug: BOOST.slug, kind: "boost" });
  const meta = await batch(refs.flatMap((r) => [{ target: r.vault, data: enc("symbol") }, { target: r.vault, data: enc("name") }]));
  return refs.map((r, i) => ({ ...r, symbol: meta[i * 2].ok ? decodeResult("symbol", meta[i * 2].data) as string : r.slug.toUpperCase(), name: meta[i * 2 + 1].ok ? decodeResult("name", meta[i * 2 + 1].data) as string : r.slug }));
}, ["my-vaults-universe-v2"], { revalidate: 600 });

/* ------------------------------------------------------------------ what one share is worth, per vault (60 seconds, shared) */
export type Nav = { vault: Address; supply: string; assetsWei: string | null; estimated: boolean; at: number };
const navOne = unstable_cache(async (vault: Address, kind: Kind): Promise<Nav> => {
  if (kind === "boost") {
    // Boosted ETH values itself at its Morpho market oracle: NAV in USDG, converted to ETH at the same price
    const [st, supply] = await Promise.all([
      client().readContract({ address: vault, abi: boostVaultAbi, functionName: "state" }),
      client().readContract({ address: vault, abi: boostVaultAbi, functionName: "totalSupply" }),
    ]);
    return { vault, supply: String(supply), assetsWei: st.price > 0n ? String((st.nav * 10n ** 36n) / st.price) : null, estimated: false, at: Date.now() };
  }
  if (kind === "v2") {
    const r = await batch([{ target: vault, data: enc("totalSupply") }, { target: vault, data: enc("totalAssets") }]);
    return { vault, supply: String(decodeResult("totalSupply", r[0].data)), assetsWei: r[1].ok ? String(decodeResult("totalAssets", r[1].data)) : null, estimated: false, at: Date.now() };
  }
  // oracle-free vault: cash plus what every holding would sell for right now, quoted by its controller in one batch
  const a = await batch([{ target: vault, data: enc("totalSupply") }, { target: vault, data: enc("constituents") }, { target: vault, data: enc("weth") }, { target: vault, data: enc("owner") }]);
  const supply = decodeResult("totalSupply", a[0].data) as bigint, tokens = decodeResult("constituents", a[1].data) as Address[], weth = decodeResult("weth", a[2].data) as Address, controller = decodeResult("owner", a[3].data) as Address;
  const b = await batch([...tokens, weth, zeroAddress].map((tk) => ({ target: vault, data: enc("freeBalance", [tk]) })));
  const bal = b.map((x) => (x.ok ? (decodeResult("freeBalance", x.data) as bigint) : 0n));
  const held = tokens.map((tk, i) => ({ tk, amt: bal[i] })).filter((x) => x.amt > 0n);
  const q = await batch(held.map((h) => ({ target: controller, data: encodeFunctionData({ abi: rebalanceControllerV3Abi, functionName: "quoteRebalance", args: [h.tk, false, h.amt] }) })));
  let sum = bal[tokens.length] + bal[tokens.length + 1], complete = true;
  q.forEach((x) => { try { const e = decodeErrorResult({ abi: rebalanceControllerV3Abi, data: x.data }); if (e.errorName === "RebalanceQuote") sum += (e.args as readonly bigint[])[0]; else complete = false; } catch { complete = false; } });
  return { vault, supply: String(supply), assetsWei: complete ? String(sum) : null, estimated: true, at: Date.now() };
}, ["my-vaults-nav-v3"], { revalidate: 60 });
/** One vault's value from the same 60-second cache, for first paint on its page. Only vaults the protocol created. */
export async function vaultNav(vault: Address): Promise<Nav | null> {
  const ref = (await vaultUniverse()).find((v) => v.vault.toLowerCase() === vault.toLowerCase());
  return ref && ref.kind !== "autolp" ? navOne(ref.vault, ref.kind) : null;
}

/* ------------------------------------------------------------------ a wallet's balances (20 seconds) and cost basis (30 seconds) */
const balances = unstable_cache(async (wallet: Address) => {
  const u = await vaultUniverse();
  const r = await batch(u.map((v) => ({ target: v.vault, data: enc("balanceOf", [wallet]) })));
  return u.map((v, i) => ({ vault: v.vault, shares: r[i].ok ? String(decodeResult("balanceOf", r[i].data)) : "0" })).filter((x) => x.shares !== "0");
}, ["my-vaults-balances-v1"], { revalidate: 20 });
/** cost basis for each held vault, rebuilt from its events (30 seconds per wallet; see lib/positionAccounting.ts) */
const accounts = unstable_cache(async (wallet: Address, held: { vault: Address; kind: Kind; shares: string }[]) =>
  Object.fromEntries(await Promise.all(held.map(async (h) => [h.vault.toLowerCase(), await accountFor(wallet, h.vault, h.kind, BigInt(h.shares)).catch(() => null)] as const))),
["my-vaults-accounts-v2"], { revalidate: 30 });

export type Position = VaultRef & { shares: string; supply: string | null; valueWei: string | null; estimated: boolean; account: Accounting | null };
/** Positions for one wallet. Auto LP is valued on the client from its own cached figures; its cost basis comes from here. */
export async function readPositions(wallet: Address): Promise<{ updatedAt: number; positions: Position[] }> {
  const [u, held] = await Promise.all([vaultUniverse(), balances(wallet)]);
  const byVault = new Map(u.map((v) => [v.vault.toLowerCase(), v]));
  const mine = held.map((h) => ({ ref: byVault.get(h.vault.toLowerCase())!, shares: BigInt(h.shares) })).filter((x) => x.ref);
  const [navs, acct] = await Promise.all([
    Promise.all(mine.map((m) => (m.ref.kind === "autolp" ? Promise.resolve(null) : navOne(m.ref.vault, m.ref.kind).catch(() => null)))),
    accounts(wallet, mine.map((m) => ({ vault: m.ref.vault, kind: m.ref.kind, shares: String(m.shares) }))).catch(() => ({} as Record<string, Accounting | null>)),
  ]);
  return { updatedAt: Date.now(), positions: mine.map((m, i) => {
    const nav = navs[i], supply = nav ? BigInt(nav.supply) : 0n, value = nav?.assetsWei && supply > 0n ? (BigInt(nav.assetsWei) * m.shares) / supply : null;
    return { ...m.ref, shares: String(m.shares), supply: nav ? nav.supply : null, valueWei: value === null ? null : String(value), estimated: nav?.estimated ?? false, account: acct[m.ref.vault.toLowerCase()] ?? null };
  }) };
}
