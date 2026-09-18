import { type Coin, byAddress, rememberCoin } from "@/lib/catalog";
import { isAddress, shortAddr } from "@/lib/format";
import { lookupIndexCoin } from "@/lib/lookup";
import { publicClient } from "@/lib/wallet";

const STASH_PREFIX = "hoodx-vault-coins:";

const metaAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

function cleanSymbol(raw: string) {
  return raw.replace(/[^\w$]/g, "").slice(0, 16);
}

export function stashVaultCoin(vault: string, coin: Coin) {
  if (typeof window === "undefined" || !isAddress(vault)) return;
  const key = STASH_PREFIX + vault.toLowerCase();
  try {
    const prev: Coin[] = JSON.parse(localStorage.getItem(key) || "[]");
    const token = coin.token.toLowerCase();
    if (prev.some((c) => c.token === token)) return;
    localStorage.setItem(key, JSON.stringify([...prev, { ...coin, token }]));
  } catch {
    /* quota / private mode */
  }
}

export function readStashedVaultCoins(vault: string): Coin[] {
  if (typeof window === "undefined" || !isAddress(vault)) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(STASH_PREFIX + vault.toLowerCase()) || "[]") as Coin[];
    return rows.map((c) => ({ ...c, token: c.token.toLowerCase() }));
  } catch {
    return [];
  }
}

async function readOnChainMeta(token: string) {
  let symbol = "";
  let name = "";
  try {
    const on = await publicClient.readContract({
      address: token as `0x${string}`,
      abi: metaAbi,
      functionName: "symbol",
    });
    symbol = cleanSymbol(String(on));
  } catch {
    /* */
  }
  try {
    const on = await publicClient.readContract({
      address: token as `0x${string}`,
      abi: metaAbi,
      functionName: "name",
    });
    name = String(on).trim();
  } catch {
    /* */
  }
  return { symbol, name };
}

function looksResolved(coin: Coin | undefined, token: string) {
  if (!coin?.symbol) return false;
  return coin.symbol.toLowerCase() !== shortAddr(token).toLowerCase();
}

/** Resolve a vault constituent to a display/bind coin — catalog, stash, Dex, then ERC-20 meta. */
export async function resolveVaultCoin(token: string): Promise<Coin | undefined> {
  const k = token.toLowerCase();
  if (!isAddress(k)) return undefined;

  const cached = byAddress(k);
  if (looksResolved(cached, k)) return cached;

  try {
    const full = await lookupIndexCoin(k);
    rememberCoin(full);
    return full;
  } catch {
    /* pool lookup optional for display */
  }

  const { symbol, name } = await readOnChainMeta(k);
  if (!symbol && !name) return cached;

  const coin: Coin = {
    id: symbol || k.slice(2, 8).toUpperCase(),
    symbol: symbol || cached?.symbol || shortAddr(k),
    name: name || symbol || cached?.name || shortAddr(k),
    token: k,
    ...(cached?.buyPool ? { buyPool: cached.buyPool, buyLabels: cached.buyLabels, buyQuote: cached.buyQuote } : {}),
  };
  rememberCoin(coin);
  return coin;
}

export async function hydrateVaultCoins(vault: string, addrs: string[]): Promise<Coin[]> {
  for (const c of readStashedVaultCoins(vault)) rememberCoin(c);
  const out: Coin[] = [];
  for (const addr of addrs) {
    const coin = await resolveVaultCoin(addr);
    if (coin) out.push(coin);
  }
  return out;
}

export function targetPct(onChainBps: number, policyWeight = 0) {
  if (onChainBps > 0) return onChainBps / 100;
  if (policyWeight > 0) return policyWeight * 100;
  return 0;
}

export type TargetDisplayOpts = {
  cash?: boolean;
  /** Held sleeve with no on-chain / policy target — show live NAV weight. */
  liveWeight?: number;
  held?: boolean;
  /** Name is skipped from the 696 book (e.g. dead volume). */
  legacy?: boolean;
};

export function formatTargetPct(onChainBps: number, policyWeight = 0, opts: TargetDisplayOpts = {}) {
  if (opts.cash) return "≥25%";
  const pct = targetPct(onChainBps, policyWeight);
  if (pct > 0) return `${pct.toFixed(2)}%`;
  if (opts.held && opts.liveWeight != null && opts.liveWeight > 0.0001) {
    const live = (opts.liveWeight * 100).toFixed(2);
    return opts.legacy ? `${live}% · park` : `${live}% live`;
  }
  return "unset";
}
