"use client";

import Link from "next/link";
import { AUTO_LP } from "@/lib/stockLp";
import { fmtPct, useAutoLpStats } from "@/lib/useAutoLp";

/** Explore-page card for the HOODX Automated LP strategy (deliberately distinct from basket cards). */
export function AutoLpCard() {
  const { stats } = useAutoLpStats(120_000);
  const earning = stats?.sleeves.filter((s) => s.inRange && s.referenceAgrees).length;
  return <Link href={`/${AUTO_LP.slug}`} className="autolp-card" data-testid="autolp-card">
    <div className="autolp-card-glow" aria-hidden />
    <div className="autolp-card-head">
      <span className="autolp-badge"><i aria-hidden /> Autopilot</span>
      <span className="autolp-kind">Automated LP strategy</span>
      <div className="autolp-perf">
        <b className={stats ? (stats.sinceLaunchUsdPct >= 0 ? "is-up" : "is-down") : ""}>{stats ? fmtPct(stats.sinceLaunchUsdPct) : "—"}</b>
        <span>Since launch</span>
      </div>
    </div>
    <div className="autolp-card-body">
      <div>
        <h3>Stock LP, on autopilot.</h3>
        <p className="autolp-card-desc">Deposit ETH once. The vault provides liquidity on 8 tokenized stocks, earns trading fees, and rebalances
          and compounds itself under on-chain rules.</p>
      </div>
      <div className="autolp-card-side">
        <ul className="autolp-facts" aria-label="Strategy facts">
          <li><b>±1%</b><span>Uniswap V4 ranges</span></li>
          <li><b>24h</b><span>rule before any rebalance</span></li>
          <li><b>ETH</b><span>in and out, one click</span></li>
        </ul>
      </div>
    </div>
    <div className="autolp-card-foot">
      <div className="autolp-tickers" aria-label={`${AUTO_LP.stocks.length} stocks: ${AUTO_LP.stocks.join(", ")}`}>
        {AUTO_LP.stocks.map((s) => <b key={s}>{s}</b>)}
      </div>
      <span>{earning !== undefined ? `${earning} of 8 earning · ` : ""}Open vault <i aria-hidden>→</i></span>
    </div>
  </Link>;
}
