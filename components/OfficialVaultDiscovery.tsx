"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { TokenArt } from "@/components/TokenArt";
import { FEATURED_VAULTS, type VaultCategory, type VaultMeta } from "@/lib/vaults";

const FILTERS: { label: string; value: "all" | VaultCategory }[] = [
  { label: "All", value: "all" }, { label: "Technology", value: "technology" }, { label: "Markets", value: "markets" }, { label: "Culture", value: "culture" }, { label: "Defensive", value: "defensive" },
];
const styleFor = (vault: VaultMeta) => ({ "--vault-accent": vault.accent }) as CSSProperties;

function ThemeMark({ vault }: { vault: VaultMeta }) { return <span className="discovery-mark" style={styleFor(vault)} aria-hidden>{vault.mark}</span>; }
function Model({ vault }: { vault: VaultMeta }) {
  if (vault.status === "live") return <span className="discovery-status is-live"><i /> Live</span>;
  const value = vault.model7d ?? 0;
  return <div className="discovery-model"><strong className={value >= 0 ? "is-up" : "is-down"}>{value >= 0 ? "+" : ""}{value.toFixed(2)}%</strong><span>7D model · ETH</span></div>;
}
function Card({ vault, featured = false }: { vault: VaultMeta; featured?: boolean }) {
  const href = vault.status === "live" ? `/i/${vault.slug}` : `/explore#${vault.slug}`;
  return <Link id={vault.slug} href={href} className={`discovery-card ${featured ? "is-featured" : ""}`} style={styleFor(vault)}>
    <div className="discovery-card-top">{vault.image ? <TokenArt slug={vault.slug} src={vault.image} size={featured ? "md" : "sm"} /> : <ThemeMark vault={vault} />}<Model vault={vault} /></div>
    <div className="discovery-card-copy"><p>{vault.flair}</p><h3>{vault.name}</h3><span>{vault.thesis}</span></div>
    <div className="discovery-card-foot"><div className="discovery-tokens" aria-label={`${vault.assets.length} assets: ${vault.assets.join(", ")}`}>{vault.assets.slice(0, 6).map((asset) => <b key={asset}>{asset.slice(0, 2)}</b>)}</div><span>{vault.status === "validated" ? `${vault.assets.length} assets · smart cap` : `${vault.assets.length} assets`} <i aria-hidden>→</i></span></div>
  </Link>;
}

export function OfficialVaultDiscovery() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const lead = FEATURED_VAULTS.find((vault) => vault.slug === "chainfin")!;
  const visible = useMemo(() => FEATURED_VAULTS.filter((vault) => vault.slug !== lead.slug && (filter === "all" || vault.category === filter)), [filter, lead.slug]);
  const showLead = filter === "all" || lead.category === filter;
  return <section className="discovery-shell" data-testid="official-vault-discovery">
    <div className="discovery-heading"><div><p className="landing-eyebrow">HOODX collections</p><h2>Choose a point of view.</h2></div><p>Curated themes. On-chain holdings. One token.</p></div>
    <div className="discovery-filters" role="group" aria-label="Filter collections">{FILTERS.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    {showLead && <Card vault={lead} featured />}
    <div className="discovery-grid">{visible.map((vault) => <Card key={vault.slug} vault={vault} />)}</div>
    <p className="discovery-footnote">Before launch, 7D model uses square-root market-cap weights with concentration limits plus 25% WETH, measured in ETH. It is research, not realized vault performance.</p>
  </section>;
}
