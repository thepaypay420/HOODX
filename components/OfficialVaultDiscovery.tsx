"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AssetChips } from "@/components/AssetChips";
import { AutoLpCard } from "@/components/AutoLpCard";
import { BoostCard } from "@/components/BoostCard";
import { MyVaults, holdings, useMyVaults } from "@/components/MyVaults";
import { useAutoLpStats } from "@/lib/useAutoLp";
import { useWallet } from "@/lib/wallet";
import { BrandMark } from "@/components/BrandMark";
import { TokenArt } from "@/components/TokenArt";
import { FEATURED_VAULTS, type VaultCategory, type VaultMeta } from "@/lib/vaults";
import { publicClient } from "@/lib/publicClient";
import { verifiedV2Vaults, v2VaultAbi } from "@/lib/v2";
import { launchReturnBps } from "@/lib/v2Performance";
import { zeroAddress, type Address } from "viem";
import { atomicFactoryAbi, atomicFactoryAddress } from "@/lib/atomicFactory";
import { quoteProportionalRebalance, readProportionalState } from "@/lib/proportionalQuote";
import { resolveVaultAuthority } from "@/lib/rebalanceController";

/** An oracle-free vault has no on-chain NAV, so its return is measured the way its own page does it:
 *  live quotes to sell every holding, plus cash, per share against the launch price. */
async function proportionalReturn(slug: string): Promise<number | undefined> {
  if (!atomicFactoryAddress) return undefined;
  const vault: Address = await publicClient.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "bySlug", args: [slug] });
  if (vault === zeroAddress) return undefined;
  // The shared 60-second server valuation first; the full live quote only if it is unavailable.
  const nav = await fetch(`/api/vault-nav?vault=${vault}`).then(r => r.ok ? r.json() as Promise<{ supply: string; assetsWei: string }> : undefined).catch(() => undefined);
  if (nav) { const bps = launchReturnBps(BigInt(nav.assetsWei), BigInt(nav.supply)); if (bps !== undefined) return Number(bps) / 100; }
  const state = await readProportionalState(publicClient, vault, zeroAddress);
  const { controller } = await resolveVaultAuthority(publicClient, vault, state.owner, state.blockNumber);
  if (!controller) return undefined;
  const values = await Promise.all(state.tokens.map((token, i) => state.balances[i] === 0n ? Promise.resolve(0n) : quoteProportionalRebalance(publicClient, state, controller, token, false, state.balances[i])));
  const bps = launchReturnBps(state.cash + values.reduce((sum, v) => sum + v, 0n), state.supply);
  return bps === undefined ? undefined : Number(bps) / 100;
}

type Category = "all" | VaultCategory;
const CATEGORIES: { label: string; value: Category }[] = [
  { label: "All", value: "all" }, { label: "Technology", value: "technology" }, { label: "Markets", value: "markets" }, { label: "Culture", value: "culture" }, { label: "Defensive", value: "defensive" },
];
const styleFor = (vault: VaultMeta) => ({ "--vault-accent": vault.accent }) as CSSProperties;
const hrefFor = (vault: VaultMeta) => vault.status === "pilot" ? `/${vault.slug}` : `/i/${vault.slug}`;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

/** A vault's since-launch return from the shared 60-second valuation, once it has holders. */
async function navReturn(vault: Address): Promise<number | undefined> {
  const nav = await fetch(`/api/vault-nav?vault=${vault}`).then(r => r.ok ? r.json() as Promise<{ supply: string; assetsWei: string }> : undefined).catch(() => undefined);
  if (!nav) return undefined;
  const bps = launchReturnBps(BigInt(nav.assetsWei), BigInt(nav.supply));
  return bps === undefined ? undefined : Number(bps) / 100;
}

/** One line per vault: what it is, what it holds, and a return only where real money has a real track record. */
type Sim = { pct: number; since: number };
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function VaultRow({ vault, liveReturn, sim }: { vault: VaultMeta; liveReturn?: number; sim?: Sim }) {
  return <Link id={vault.slug} href={hrefFor(vault)} className="ex-row" style={styleFor(vault)}>
    <TokenArt slug={vault.slug} src={vault.image} size="sm" />
    <span className="ex-row-name"><b>{vault.name}</b><small><em>${vault.symbol}</em> · {vault.flair}</small></span>
    <span className="ex-row-thesis">{vault.thesis}</span>
    <span className="ex-row-assets"><AssetChips assets={vault.assets} max={5} /></span>
    <span className="ex-row-metric">
      {vault.status === "pilot" ? <i className="ex-tag is-pilot">Pilot</i>
        : liveReturn !== undefined ? <><strong className={liveReturn >= 0 ? "is-up" : "is-down"}>{pct(liveReturn)}</strong><small>Since launch</small></>
        : sim ? <span title={`What this basket would have returned since launch (${day(sim.since)}), from its on-chain weights and cash sleeve, in USD, before fees and swap costs.`}>
            <strong className={sim.pct >= 0 ? "is-up" : "is-down"}>{pct(sim.pct)}</strong><small>If funded<span className="ex-since"> · since {day(sim.since)}</span></small></span>
        : <i className="ex-tag">New</i>}
    </span>
    <span className="ex-row-go" aria-hidden>→</span>
  </Link>;
}

function Group({ label, count, note, side, children }: { label: string; count: number; note: string; side?: ReactNode; children: ReactNode }) {
  return <section className="ex-group">
    <header className="ex-group-head">
      <div><h3>{label}<span>{count}</span></h3><p>{note}</p></div>
      {side}
    </header>
    {children}
  </section>;
}

export function OfficialVaultDiscovery() {
  const [view, setView] = useState<"all" | "mine">("all");
  const [category, setCategory] = useState<Category>("all");
  // "My Vaults" appears once a connected wallet is found to hold any HOODX vault token
  const { address } = useWallet();
  const mine = useMyVaults(address);
  const { stats } = useAutoLpStats(120_000);
  const myList = useMemo(() => holdings(mine.data, stats), [mine.data, stats]);
  const hasMine = !!address && myList.length > 0;
  useEffect(() => { if (view === "mine" && !hasMine) setView("all"); }, [view, hasMine]);

  // Live since-launch returns: 696X is valued from live quotes; every other vault from the shared valuation, once it has holders.
  const [returns, setReturns] = useState<Record<string, number>>({});
  // collections without holders yet: what their basket would have returned since launch
  const [sims, setSims] = useState<Record<string, Sim>>({});
  useEffect(() => {
    let active = true;
    void fetch("/api/collection-returns").then(r => r.ok ? r.json() as Promise<Record<string, Sim>> : undefined).then(d => { if (active && d && !("error" in d)) setSims(d); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const put = (slug: string, value?: number) => { if (active && value !== undefined) setReturns(old => ({ ...old, [slug]: value })); };
    void proportionalReturn("696x").then(v => put("696x", v)).catch(() => {});
    const addresses: [string, Address][] = [
      ...FEATURED_VAULTS.flatMap((v): [string, Address][] => v.slug !== "696x" && v.status !== "pilot" && v.address ? [[v.slug, v.address]] : []),
      ...Object.entries(verifiedV2Vaults).filter(([slug]) => slug !== "696x" && !FEATURED_VAULTS.find(v => v.slug === slug)?.address),
    ];
    for (const [slug, vault] of addresses) void navReturn(vault).then(v => put(slug, v)).catch(() => {});
    return () => { active = false; };
  }, []);

  const collections = useMemo(() => {
    const list = FEATURED_VAULTS.filter(v => v.status !== "pilot");
    // vaults with a live record first, then the editorial order
    return [...list].sort((a, b) => Number(returns[b.slug] !== undefined) - Number(returns[a.slug] !== undefined));
  }, [returns]);
  const pilots = FEATURED_VAULTS.filter(v => v.status === "pilot");
  const shown = collections.filter(v => category === "all" || v.category === category);
  const countOf = (c: Category) => c === "all" ? collections.length : collections.filter(v => v.category === c).length;

  return <section className="discovery-shell ex" data-testid="official-vault-discovery">
    <div className="discovery-heading">
      <div><p className="landing-eyebrow">HOODX collections</p><h2>Choose a strategy.</h2></div>
      {hasMine
        ? <div className="ex-view" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>All vaults</button>
            <button type="button" role="tab" aria-selected={view === "mine"} onClick={() => setView("mine")}>My Vaults<span>{myList.length}</span></button>
          </div>
        : <p>Curated themes. On-chain holdings. One token.</p>}
    </div>

    {view === "mine" && hasMine ? <MyVaults list={myList} loading={mine.loading} updatedAt={mine.data?.updatedAt} onRefresh={mine.refresh} ethUsd={stats?.ethUsd} /> : <>
      <Group label="Automated" count={2} note="Deposit ETH once. The rules run on-chain, around the clock.">
        <div className="discovery-leads"><AutoLpCard /><BoostCard /></div>
      </Group>

      <Group label="Index collections" count={collections.length} note="One token for a whole theme, with a WETH cash sleeve."
        side={<div className="discovery-filters ex-filters" role="group" aria-label="Filter collections">{CATEGORIES.map(c =>
          <button key={c.value} type="button" aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>{c.label}<span>{countOf(c.value)}</span></button>)}</div>}>
        <div className="ex-list">{shown.map(v => <VaultRow key={v.slug} vault={v} liveReturn={returns[v.slug]} sim={sims[v.slug]} />)}</div>
      </Group>

      <Group label="Liquidity pilots" count={pilots.length} note="Managed liquidity strategies, running small while they prove out.">
        <div className="ex-list">{pilots.map(v => <VaultRow key={v.slug} vault={v} />)}</div>
      </Group>

      <Link href="/create" className="ex-create">
        <span className="ex-create-mark"><BrandMark size={30} /></span>
        <span className="ex-create-copy"><b>Have a thesis?</b><small>Choose 2–24 assets, set the weights and launch one token for it.</small></span>
        <span className="ex-create-go">Make your own <i aria-hidden>→</i></span>
      </Link>
      <p className="discovery-footnote">Since launch: per-share value on-chain for vaults with holders. If funded: what a collection without holders yet would have returned since launch, from its on-chain weights and WETH cash sleeve, in USD, before fees and swap costs. Past returns do not predict future ones.</p>
    </>}
  </section>;
}
