"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AssetChips } from "@/components/AssetChips";
import { AutoLpCard } from "@/components/AutoLpCard";
import { BoostCard } from "@/components/BoostCard";
import { MyVaults, holdings, useMyVaults } from "@/components/MyVaults";
import { useAutoLpStats } from "@/lib/useAutoLp";
import { useWallet } from "@/lib/wallet";
import { BrandMark } from "@/components/BrandMark";
import { TokenArt } from "@/components/TokenArt";
import { FEATURED_VAULTS, type VaultCategory, type VaultMeta } from "@/lib/vaults";
import { publicClient } from "@/lib/wallet";
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

type Filter = "all" | "mine" | "automated" | VaultCategory;
const FILTERS: { label: string; value: Filter }[] = [
  { label: "All", value: "all" }, { label: "Automated", value: "automated" }, { label: "Technology", value: "technology" }, { label: "Markets", value: "markets" }, { label: "Culture", value: "culture" }, { label: "Defensive", value: "defensive" },
];
const styleFor = (vault: VaultMeta) => ({ "--vault-accent": vault.accent }) as CSSProperties;

function ThemeMark({ vault }: { vault: VaultMeta }) { return <span className="discovery-mark" style={styleFor(vault)} aria-hidden>{vault.mark}</span>; }
function Model({ vault, liveReturn }: { vault: VaultMeta; liveReturn?: number }) {
  if(vault.status === "pilot") return <span className="discovery-status is-pilot"><i /> Pilot</span>;
  const sinceLaunch=vault.slug === "696x";
  const value=sinceLaunch?liveReturn:vault.model7dUsd;
  if(value===undefined)return <span className="discovery-status is-live"><i /> Live</span>;
  return <div className="discovery-model"><strong className={value >= 0 ? "is-up" : "is-down"}>{value >= 0 ? "+" : ""}{value.toFixed(2)}%</strong><span>{sinceLaunch?'Since launch':'7D · USD'}</span></div>;
}
function Card({ vault, featured = false, liveReturn }: { vault: VaultMeta; featured?: boolean; liveReturn?: number }) {
  const href = vault.status === "pilot" ? `/${vault.slug}` : vault.status === "live" ? `/i/${vault.slug}` : `/explore#${vault.slug}`;
  return <Link id={vault.slug} href={href} className={`discovery-card ${featured ? "is-featured" : ""}`} style={styleFor(vault)}>
    <div className="discovery-card-top">{vault.image ? <TokenArt slug={vault.slug} src={vault.image} size={featured ? "md" : "sm"} /> : <ThemeMark vault={vault} />}<Model vault={vault} liveReturn={liveReturn} /></div>
    <div className="discovery-card-copy"><p>{vault.flair}</p><h3>{vault.name}</h3><span>{vault.thesis}</span></div>
    <div className="discovery-card-foot"><AssetChips assets={vault.assets} /><span>{vault.status === "validated" ? `${vault.assets.length} assets · smart cap` : vault.status === "pilot" ? `${vault.assets.length} LP sleeves` : `${vault.assets.length} assets`} <i aria-hidden>→</i></span></div>
  </Link>;
}
function CreateCard() {
  return <Link href="/create" className="discovery-card is-create" style={{"--vault-accent":"#4fd7cb"} as CSSProperties}>
    <div className="discovery-card-top"><span className="discovery-create-mark"><BrandMark size={48}/></span><span className="discovery-create-note">Your idea</span></div>
    <div className="discovery-card-copy"><p>Create · Curate</p><h3>Make your own index</h3><span>Choose 2–24 assets, set your weights and launch one token for your thesis.</span></div>
    <div className="discovery-card-foot"><span className="discovery-create-caption">Built on Robinhood Chain</span><span>Start building <i aria-hidden>→</i></span></div>
  </Link>;
}

export function OfficialVaultDiscovery() {
  const [filter, setFilter] = useState<Filter>("all");
  // "My Vaults" appears beside "All" once a connected wallet is found to hold any HOODX vault token
  const { address } = useWallet();
  const mine = useMyVaults(address);
  const { stats } = useAutoLpStats(120_000);
  const myList = useMemo(() => holdings(mine.data, stats), [mine.data, stats]);
  const hasMine = !!address && myList.length > 0;
  useEffect(() => { if (filter === "mine" && !hasMine) setFilter("all"); }, [filter, hasMine]);
  const [liveReturns,setLiveReturns]=useState<Record<string,number>>({});
  useEffect(()=>{let active=true;
    void proportionalReturn('696x').then(value=>{if(active&&value!==undefined)setLiveReturns(old=>({...old,'696x':value}));}).catch(()=>{});
    void Promise.all(Object.entries(verifiedV2Vaults).filter(([slug])=>slug!=='696x'/* 696X moved to a proportional vault, valued above */).map(async([slug,vault])=>{
    const supply=await publicClient.readContract({address:vault,abi:v2VaultAbi,functionName:'totalSupply'});
    let assets=await publicClient.readContract({address:vault,abi:v2VaultAbi,functionName:'totalAssets'}).catch(()=>undefined);
    if(assets===undefined){const response=await fetch(`/api/vault-quote?vault=${vault}`);if(response.ok)assets=BigInt((await response.json()).assets);}
    const bps=assets===undefined?undefined:launchReturnBps(assets,supply);
    return [slug,bps===undefined?undefined:Number(bps)/100] as const;
  })).then(rows=>{if(active)setLiveReturns(old=>({...old,...Object.fromEntries(rows.filter((row):row is readonly[string,number]=>row[1]!==undefined))}));}).catch(()=>{});return()=>{active=false;};},[]);
  const lead = FEATURED_VAULTS.find((vault) => vault.slug === "chainfin")!;
  const visible = useMemo(() => FEATURED_VAULTS.filter((vault) => vault.slug !== lead.slug && (filter === "all" || vault.category === filter)), [filter, lead.slug]);
  const showAuto = filter === "all" || filter === "automated";
  const showLead = filter === "all" || lead.category === filter;
  return <section className="discovery-shell" data-testid="official-vault-discovery">
    <div className="discovery-heading"><div><p className="landing-eyebrow">HOODX collections</p><h2>Choose a point of view.</h2></div><p>Curated themes. On-chain holdings. One token.</p></div>
    <div className="discovery-filters" role="group" aria-label="Filter collections">{FILTERS.flatMap((item) => {
      const chip = <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>;
      return item.value === "all" && hasMine ? [chip, <button key="mine" type="button" className="mv-chip" aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>My Vaults<span>{myList.length}</span></button>] : [chip];
    })}</div>
    {filter === "mine" && hasMine && <MyVaults list={myList} loading={mine.loading} updatedAt={mine.data?.updatedAt} onRefresh={mine.refresh} ethUsd={stats?.ethUsd} />}
    {filter !== "mine" && (showAuto || showLead) && <div className="discovery-leads">
      {showAuto && <AutoLpCard />}
      {showAuto && <BoostCard />}
      {showLead && <Card vault={lead} featured liveReturn={liveReturns[lead.slug]} />}
    </div>}
    {filter !== "mine" && <div className="discovery-grid">{visible.map((vault) => <Card key={vault.slug} vault={vault} liveReturn={liveReturns[vault.slug]} />)}{filter === "all"&&<CreateCard/>}</div>}
    {filter !== "mine" && <p className="discovery-footnote">FAANGX and the new collections show their prior 7D smart-weight performance in USD terms.</p>}
  </section>;
}
