"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { TokenArt } from "@/components/TokenArt";
import { FEATURED_VAULTS, type VaultCategory, type VaultMeta } from "@/lib/vaults";
import { publicClient } from "@/lib/wallet";
import { verifiedV2Vaults, v2VaultAbi } from "@/lib/v2";
import { launchReturnBps } from "@/lib/v2Performance";

const FILTERS: { label: string; value: "all" | VaultCategory }[] = [
  { label: "All", value: "all" }, { label: "Technology", value: "technology" }, { label: "Markets", value: "markets" }, { label: "Culture", value: "culture" }, { label: "Defensive", value: "defensive" },
];
const styleFor = (vault: VaultMeta) => ({ "--vault-accent": vault.accent }) as CSSProperties;

function ThemeMark({ vault }: { vault: VaultMeta }) { return <span className="discovery-mark" style={styleFor(vault)} aria-hidden>{vault.mark}</span>; }
function Model({ vault, liveReturn }: { vault: VaultMeta; liveReturn?: number }) {
  const sinceLaunch=vault.slug === "696x";
  const value=sinceLaunch?liveReturn:vault.model7dUsd;
  if(value===undefined)return <span className="discovery-status is-live"><i /> Live</span>;
  return <div className="discovery-model"><strong className={value >= 0 ? "is-up" : "is-down"}>{value >= 0 ? "+" : ""}{value.toFixed(2)}%</strong><span>{sinceLaunch?'Since launch':'7D · USD'}</span></div>;
}
function Card({ vault, featured = false, liveReturn }: { vault: VaultMeta; featured?: boolean; liveReturn?: number }) {
  const href = vault.status === "live" ? `/i/${vault.slug}` : `/explore#${vault.slug}`;
  return <Link id={vault.slug} href={href} className={`discovery-card ${featured ? "is-featured" : ""}`} style={styleFor(vault)}>
    <div className="discovery-card-top">{vault.image ? <TokenArt slug={vault.slug} src={vault.image} size={featured ? "md" : "sm"} /> : <ThemeMark vault={vault} />}<Model vault={vault} liveReturn={liveReturn} /></div>
    <div className="discovery-card-copy"><p>{vault.flair}</p><h3>{vault.name}</h3><span>{vault.thesis}</span></div>
    <div className="discovery-card-foot"><div className="discovery-tokens" aria-label={`${vault.assets.length} assets: ${vault.assets.join(", ")}`}>{vault.assets.slice(0, 6).map((asset) => <b key={asset}>{asset.slice(0, 2)}</b>)}</div><span>{vault.status === "validated" ? `${vault.assets.length} assets · smart cap` : `${vault.assets.length} assets`} <i aria-hidden>→</i></span></div>
  </Link>;
}

export function OfficialVaultDiscovery() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [liveReturns,setLiveReturns]=useState<Record<string,number>>({});
  useEffect(()=>{let active=true;void Promise.all(Object.entries(verifiedV2Vaults).map(async([slug,vault])=>{
    const supply=await publicClient.readContract({address:vault,abi:v2VaultAbi,functionName:'totalSupply'});
    let assets=await publicClient.readContract({address:vault,abi:v2VaultAbi,functionName:'totalAssets'}).catch(()=>undefined);
    if(assets===undefined){const response=await fetch(`/api/vault-quote?vault=${vault}`);if(response.ok)assets=BigInt((await response.json()).assets);}
    const bps=assets===undefined?undefined:launchReturnBps(assets,supply);
    return [slug,bps===undefined?undefined:Number(bps)/100] as const;
  })).then(rows=>{if(active)setLiveReturns(Object.fromEntries(rows.filter((row):row is readonly[string,number]=>row[1]!==undefined)));}).catch(()=>{});return()=>{active=false;};},[]);
  const lead = FEATURED_VAULTS.find((vault) => vault.slug === "chainfin")!;
  const visible = useMemo(() => FEATURED_VAULTS.filter((vault) => vault.slug !== lead.slug && (filter === "all" || vault.category === filter)), [filter, lead.slug]);
  const showLead = filter === "all" || lead.category === filter;
  return <section className="discovery-shell" data-testid="official-vault-discovery">
    <div className="discovery-heading"><div><p className="landing-eyebrow">HOODX collections</p><h2>Choose a point of view.</h2></div><p>Curated themes. On-chain holdings. One token.</p></div>
    <div className="discovery-filters" role="group" aria-label="Filter collections">{FILTERS.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    {showLead && <Card vault={lead} featured liveReturn={liveReturns[lead.slug]} />}
    <div className="discovery-grid">{visible.map((vault) => <Card key={vault.slug} vault={vault} liveReturn={liveReturns[vault.slug]} />)}</div>
    <p className="discovery-footnote">696X shows live per-share return since launch. FAANGX and the new collections show their prior 7D smart-weight performance in USD terms.</p>
  </section>;
}
