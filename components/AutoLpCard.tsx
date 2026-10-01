import Link from "next/link";
import { AUTO_LP } from "@/lib/stockLp";

/** Explore-page hero card for the HOODX Automated LP strategy (deliberately distinct from basket cards). */
export function AutoLpCard() {
  const live = AUTO_LP.vault !== null;
  return <Link href={`/${AUTO_LP.slug}`} className="autolp-card" data-testid="autolp-card">
    <div className="autolp-card-glow" aria-hidden />
    <div className="autolp-card-head">
      <span className="autolp-badge"><i aria-hidden /> Autopilot</span>
      <span className="autolp-kind">Automated LP strategy</span>
    </div>
    <div className="autolp-card-body">
      <div>
        <h3>Stock LP, on autopilot.</h3>
        <p>Deposit ETH once. The vault provides liquidity on 8 tokenized stocks, earns trading fees, and rebalances
          and compounds itself under on-chain rules.</p>
      </div>
      <ul className="autolp-facts" aria-label="Strategy facts">
        <li><b>±1%</b><span>Uniswap V4 ranges</span></li>
        <li><b>24h</b><span>rule before any rebalance</span></li>
        <li><b>ETH</b><span>in and out, one click</span></li>
      </ul>
    </div>
    <div className="autolp-card-foot">
      <div className="autolp-tickers" aria-label={`${AUTO_LP.stocks.length} stocks: ${AUTO_LP.stocks.join(", ")}`}>
        {AUTO_LP.stocks.map((s) => <b key={s}>{s}</b>)}
      </div>
      <span>{live ? "Open vault" : "Launching"} <i aria-hidden>→</i></span>
    </div>
  </Link>;
}
