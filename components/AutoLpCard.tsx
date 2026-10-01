"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { AssetChips } from "@/components/AssetChips";
import { BrandMark } from "@/components/BrandMark";
import { AUTO_LP } from "@/lib/stockLp";
import { fmtPct, useAutoLpStats } from "@/lib/useAutoLp";

/** Explore card for the Automated LP: same structure and size as the featured index card, autopilot styling. */
export function AutoLpCard() {
  const { stats } = useAutoLpStats(120_000);
  const earning = stats?.sleeves.filter((s) => s.inRange && s.referenceAgrees).length;
  return <Link href={`/${AUTO_LP.slug}`} className="discovery-card is-featured is-autolp" data-testid="autolp-card" style={{ "--vault-accent": "#b98cff" } as CSSProperties}>
    <div className="discovery-card-top">
      <span className="autolp-mark" aria-hidden><BrandMark size={44} /></span>
      <div className="discovery-model">
        <strong className={stats ? (stats.sinceLaunchUsdPct >= 0 ? "is-up" : "is-down") : ""}>{stats ? fmtPct(stats.sinceLaunchUsdPct) : "—"}</strong>
        <span>Since launch</span>
      </div>
    </div>
    <div className="discovery-card-copy">
      <p><span className="autolp-live"><i aria-hidden />Autopilot · Automated LP</span></p>
      <h3>Hands-free LP.</h3>
      <span>Deposit ETH once. It earns trading fees on 8 tokenized stocks, rebalanced and compounded by on-chain rules.</span>
    </div>
    <div className="discovery-card-foot">
      <AssetChips assets={AUTO_LP.stocks} max={8} />
      <span>{earning !== undefined ? `${earning} of 8 earning` : "8 stocks"} <i aria-hidden>→</i></span>
    </div>
  </Link>;
}
