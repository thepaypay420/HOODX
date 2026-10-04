"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { BOOST, BOOST_BACKTEST, regime } from "@/lib/boost";
import { useBoostStats } from "@/lib/useBoost";
import { fmtPct } from "@/lib/useAutoLp";

/** Explore card for Boosted ETH: same structure as the Automated LP card, orange "boost" styling and a mini gauge. */
export function BoostCard() {
  const { stats } = useBoostStats(120_000);
  const live = !!(BOOST.vault && stats?.live);
  const lev = live ? stats!.leverage : BOOST.vault ? undefined : stats?.target;
  const r = regime(lev ?? 0);
  return <Link href={`/${BOOST.slug}`} className="discovery-card is-featured is-boost" data-testid="boost-card" style={{ "--vault-accent": BOOST.accent } as CSSProperties}>
    <div className="discovery-card-top">
      <span className="boost-mark" aria-hidden><svg viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="21" fill="#1b1006" stroke="#ff9a3c" strokeOpacity=".5" /><path d="M24 7 13 25h8l-2 12 11-18h-8z" fill="#ff9a3c" /></svg></span>
      <div className="discovery-model">
        {live ? <><strong className={stats!.sinceLaunchUsdPct >= 0 ? "is-up" : "is-down"}>{fmtPct(stats!.sinceLaunchUsdPct)}</strong><span>Since launch</span></>
          : <><strong className="is-up">+{BOOST_BACKTEST.test.vault}%</strong><span>Backtest/yr</span></>}
      </div>
    </div>
    <div className="discovery-card-copy">
      <p><span className="boost-live"><i aria-hidden />{live ? "Live · Smart leverage" : "Launching soon · Smart leverage"}</span></p>
      <h3>ETH, boosted.</h3>
      <span>Up to 2x ETH while crypto trends up, dollars earning yield when it breaks. Every move computed on-chain.</span>
    </div>
    <div className="discovery-card-foot">
      <span className="boost-lev"><i style={{ width: `${((lev ?? 0) / 2) * 100}%` }} /></span>
      <span>{lev !== undefined ? `${lev.toFixed(2)}x · ${r.label}` : "0x-2x ETH"} <i aria-hidden>→</i></span>
    </div>
  </Link>;
}
