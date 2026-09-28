import Image from "next/image";
import Link from "next/link";
import { Hud } from "@/components/Hud";

const sleeves = [
  { pair: "WETH / USDG", weight: "30%", role: "Core depth", cadence: "30m TWAP · 1h dwell · 12h cooldown" },
  { pair: "WETH / SPY", weight: "25%", role: "Real-world markets", cadence: "1h TWAP · 4h dwell · 24h cooldown" },
  { pair: "WETH / PONS", weight: "20%", role: "Culture liquidity", cadence: "30m TWAP · 30m dwell · 6h cooldown" },
  { pair: "CASHCAT / WETH", weight: "10%", role: "Growth liquidity", cadence: "30m TWAP · 30m dwell · 6h cooldown" },
];

export const metadata = {
  title: "Liquidity Prime · HOODX",
  description: "The protocol-controlled HOODX concentrated-liquidity index pilot.",
};

export default function LiquidityPrimePage() {
  return <><Hud /><main className="lp-pilot-page">
    <section className="lp-pilot-hero">
      <div className="lp-pilot-copy">
        <Link href="/explore" className="lp-pilot-back">← Explore</Link>
        <p className="landing-eyebrow">Protocol pilot · Uniswap V3</p>
        <h1>Liquidity<br/>prime.</h1>
        <p className="lp-pilot-thesis">Four concentrated-liquidity sleeves managed by transparent rules and held in one recoverable index.</p>
        <div className="lp-pilot-status"><i/> Fork rehearsal passed <span>Public deposits stay closed through canary testing.</span></div>
      </div>
      <div className="lp-pilot-art" aria-hidden>
        <span className="lp-pilot-ring lp-ring-one"/><span className="lp-pilot-ring lp-ring-two"/>
        <Image src="/vaults/liquidity-prime.png" alt="" width={360} height={360} priority />
      </div>
    </section>

    <section className="lp-pilot-allocation" aria-label="Target allocation">
      <div className="lp-pilot-section-head"><div><p className="landing-eyebrow">First basket</p><h2>Depth, yield, and a cash sleeve.</h2></div><p>Weights are fixed for the pilot. APR never decides allocation.</p></div>
      <div className="lp-allocation-bar" aria-hidden><i/><i/><i/><i/><i/></div>
      <div className="lp-sleeve-list">
        {sleeves.map((sleeve, index) => <article key={sleeve.pair}>
          <span>0{index + 1}</span><div><h3>{sleeve.pair}</h3><p>{sleeve.role}</p></div><strong>{sleeve.weight}</strong><small>{sleeve.cadence}</small>
        </article>)}
        <article className="is-reserve"><span>05</span><div><h3>WETH reserve</h3><p>Always liquid</p></div><strong>15%</strong><small>No range · direct recovery</small></article>
      </div>
    </section>

    <section className="lp-pilot-rules">
      <div><p className="landing-eyebrow">Management engine</p><h2>Rules execute.<br/>AI can advise.</h2></div>
      <div className="lp-rule-grid">
        <article><b>01</b><h3>Observe</h3><p>Anyone can record a range-edge condition. Calling it cannot move funds or restart a valid cooldown.</p></article>
        <article><b>02</b><h3>Confirm</h3><p>Spot must agree with the pool TWAP, then remain near the edge for the sleeve’s full dwell period.</p></article>
        <article><b>03</b><h3>Re-band</h3><p>The curator can move liquidity only inside the fixed width, movement limit, deadline, and cooldown.</p></article>
        <article><b>04</b><h3>Recover</h3><p>Index shares unwrap to WETH and separate sleeve shares. Each sleeve redeems directly without prices or swaps.</p></article>
      </div>
    </section>
  </main></>;
}
