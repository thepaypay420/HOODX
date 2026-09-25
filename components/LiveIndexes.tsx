"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther, parseAbi, parseAbiItem, type Address } from "viem";
import { TokenArt } from "@/components/TokenArt";
import { publicClient } from "@/lib/wallet";
import { productionV2Factory, verifiedV2Vaults } from "@/lib/v2";
import { atomicFactoryAddress, atomicFactoryStartBlock } from "@/lib/atomicFactory";
import { LIVE_OFFICIAL_VAULTS } from "@/lib/vaults";

const identityAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function totalAssets() view returns (uint256)",
]);

type Row = { vault: Address; slug: string; name: string; symbol: string; curator: Address; assets?: bigint; official: boolean };
let rowsCache: { at: number; rows: Row[] } | undefined;
const factoryStartBlock = 67761602n;
const createdEvent = parseAbiItem("event Created(address indexed vault,string slug,address curator,address creator)");

async function loadFactoryCreated(address: Address, start: bigint) {
  const latest = await publicClient.getBlockNumber();
  try {
    return await publicClient.getLogs({ address, event: createdEvent, fromBlock: start, toBlock: latest });
  } catch {
    const logs = [];
    for (let from = start; from <= latest; from += 10_000n) {
      logs.push(...await publicClient.getLogs({ address, event: createdEvent, fromBlock: from, toBlock: from + 9_999n > latest ? latest : from + 9_999n }));
    }
    return logs;
  }
}

async function loadCreated() {
  const legacy = await loadFactoryCreated(productionV2Factory, factoryStartBlock);
  if (!atomicFactoryAddress) return legacy;
  const atomic = await loadFactoryCreated(atomicFactoryAddress, atomicFactoryStartBlock);
  return [...legacy, ...atomic];
}

async function loadRows(): Promise<Row[]> {
  if (rowsCache && Date.now() - rowsCache.at < 60_000) return rowsCache.rows;
  const created = await loadCreated();
  const createdByAddress = new Map(created.flatMap((log) => log.args.vault && log.args.slug && log.args.curator ? [[log.args.vault.toLowerCase(), { slug: log.args.slug, curator: log.args.curator }] as const] : []));
  const addresses = [...new Set(created.flatMap((log) => log.args.vault ? [log.args.vault] : []))];
  if (!addresses.length) throw new Error("Factory history unavailable");
  const officialByAddress = new Map(Object.entries({ ...verifiedV2Vaults, ...LIVE_OFFICIAL_VAULTS }).map(([slug, address]) => [address.toLowerCase(), slug]));
  const rows = await Promise.all(addresses.map(async (vault) => {
    const createdIdentity = createdByAddress.get(vault.toLowerCase());
    const [name, symbol, curator, assets] = await Promise.all([
      publicClient.readContract({ address: vault, abi: identityAbi, functionName: "name" }).catch(() => "Untitled index"),
      publicClient.readContract({ address: vault, abi: identityAbi, functionName: "symbol" }).catch(() => "INDEX"),
      createdIdentity ? Promise.resolve(createdIdentity.curator) : publicClient.readContract({ address: vault, abi: identityAbi, functionName: "owner" }),
      publicClient.readContract({ address: vault, abi: identityAbi, functionName: "totalAssets" }).catch(() => undefined),
    ]);
    const knownSlug = officialByAddress.get(vault.toLowerCase());
    return { vault, slug: knownSlug || createdIdentity?.slug || vault.toLowerCase(), name, symbol, curator, assets, official: Boolean(knownSlug) };
  }));
  rows.sort((a, b) => Number(b.official) - Number(a.official) || Number((b.assets || 0n) - (a.assets || 0n)));
  rowsCache = { at: Date.now(), rows };
  return rows;
}

export function LiveIndexes() {
  const [rows, setRows] = useState<Row[]>(() => Object.entries(verifiedV2Vaults).map(([slug, vault]) => ({ vault, slug, name: slug.toUpperCase(), symbol: slug.toUpperCase(), curator: "0x0000000000000000000000000000000000000000" as Address, official: true })));
  useEffect(() => { let active = true; void loadRows().then((next) => { if (active) setRows(next); }).catch(() => {}); return () => { active = false; }; }, []);
  const community = rows.filter((row) => !row.official);
  if (!community.length) return null;
  return <section className="mt-14">
    <p className="text-[13px] text-[var(--dim)]">Community</p>
    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Built on HOODX</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {community.map((row) => <Link key={row.vault} href={`/i/${row.slug}`} data-testid={`live-${row.slug}`} className="holo rounded-xl p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-[12px] text-[var(--dim)]">{row.official ? "HOODX official" : "Community index"}</p><span className="text-[11px] text-[var(--cyan)]">Live on-chain</span></div>
        <div className="mt-2 flex items-center gap-3"><TokenArt slug={row.slug} size="sm" /><div className="min-w-0"><h3 className="truncate text-xl font-semibold tracking-[-0.03em]">${row.symbol}</h3><p className="truncate text-[12px] text-[var(--dim)]">{row.name}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3 text-[12px] text-[var(--dim)]"><span>{row.assets === undefined ? "Reading on-chain value…" : `${Number(formatEther(row.assets)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`}</span><span>{row.curator === "0x0000000000000000000000000000000000000000" ? "Reading curator…" : `${row.curator.slice(0, 6)}…${row.curator.slice(-4)}`}</span></div>
      </Link>)}
    </div>
  </section>;
}
