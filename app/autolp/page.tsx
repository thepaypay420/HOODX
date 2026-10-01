import Link from "next/link";
import { Hud } from "@/components/Hud";
import { AutoLpVault } from "@/components/AutoLpVault";

export const metadata = {
  title: "Automated LP",
  description: "Stock LP on autopilot: deposit ETH, earn Uniswap V4 trading fees on 8 tokenized stocks, rebalanced and compounded by on-chain rules.",
};

const rules = [
  { n: "01", h: "Provide", p: "Your ETH becomes ±1% Uniswap V4 liquidity on 8 tokenized stocks, quoted in USDG, earning every trade's fee." },
  { n: "02", h: "Wait", p: "If a stock leaves its range for 24 hours, and the pool agrees with an independent 30-minute TWAP, a rebalance is allowed." },
  { n: "03", h: "Rebalance", p: "The contracts move the position next to the price on the side it already holds. No swaps, no human choosing amounts." },
  { n: "04", h: "Compound", p: "Earned fees are reinvested daily. 10% of LP fees (never principal) goes to the HOODX treasury." },
];

export default function AutoLpPage() {
  return <><Hud /><main className="autolp-page">
    <section className="autolp-hero">
      <Link href="/explore" className="lp-pilot-back">← Explore</Link>
      <p className="landing-eyebrow"><span className="autolp-badge"><i aria-hidden /> Autopilot</span> Automated LP strategy</p>
      <h1>Stock LP,<br />on autopilot.</h1>
      <p className="autolp-thesis">One click in, one click out, both in ETH. Liquidity on eight tokenized stocks earns trading fees
        while on-chain rules handle every rebalance and compound.</p>
    </section>
    <AutoLpVault />
    <section className="lp-pilot-rules">
      <div><p className="landing-eyebrow">How the autopilot works</p><h2>Rules, not discretion.</h2></div>
      <div className="lp-rule-grid">
        {rules.map((r) => <article key={r.n}><b>{r.n}</b><h3>{r.h}</h3><p>{r.p}</p></article>)}
      </div>
    </section>
    <section className="autolp-risks">
      <p className="landing-eyebrow">Know the risks</p>
      <ul>
        <li>LP positions hold the stocks: prices can fall, and narrow ranges can lose value to arbitrage when prices move fast.</li>
        <li>Returns are not guaranteed. Past backtests are not a promise; no APR is quoted.</li>
        <li>Tokenized stocks are issuer-controlled tokens. If one is paused, ETH entry and exit pause; the emergency exit still works.</li>
        <li>Capacity is capped at $10,000 while the strategy is new. Minimum deposit $10.</li>
      </ul>
    </section>
  </main></>;
}
