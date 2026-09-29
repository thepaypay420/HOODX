import Image from "next/image";
import Link from "next/link";
import { Hud } from "@/components/Hud";

const sleeves = [
  { pair: "Uniswap WETH / USDG", weight: "50%", capital: "$100", role: "Deep core range", cadence: "±30% · 24h edge dwell · 30d cooldown" },
  { pair: "Up WETH / USDG", weight: "40%", capital: "$80", role: "Higher-fee satellite", cadence: "±20% default · guarded ±7.5% mode" },
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
        <p className="lp-pilot-thesis">Two complementary WETH / USDG ranges, a liquid reserve, and management rules designed for a $200 first pilot.</p>
        <div className="lp-pilot-status"><i/> Research locked <span>Public deposits remain closed until the Up adapter and full canary pass.</span></div>
      </div>
      <div className="lp-pilot-art" aria-hidden>
        <span className="lp-pilot-ring lp-ring-one"/><span className="lp-pilot-ring lp-ring-two"/>
        <Image src="/vaults/liquidity-prime.png" alt="" width={360} height={360} priority />
      </div>
    </section>

    <section className="lp-pilot-allocation" aria-label="Target allocation">
      <div className="lp-pilot-section-head"><div><p className="landing-eyebrow">$200 canary</p><h2>Depth, yield, and a cash sleeve.</h2></div><p>Weights stay fixed through the pilot. No sleeve is promoted from headline APR alone.</p></div>
      <div className="lp-allocation-bar" aria-hidden><i/><i/><i/></div>
      <div className="lp-sleeve-list">
        {sleeves.map((sleeve, index) => <article key={sleeve.pair}>
          <span>0{index + 1}</span><div><h3>{sleeve.pair}</h3><p>{sleeve.role} · {sleeve.capital}</p></div><strong>{sleeve.weight}</strong><small>{sleeve.cadence}</small>
        </article>)}
        <article className="is-reserve"><span>03</span><div><h3>USDG reserve</h3><p>Always liquid · $20</p></div><strong>10%</strong><small>No range · direct recovery</small></article>
      </div>
    </section>

    <section className="lp-pilot-rules">
      <div><p className="landing-eyebrow">Management engine</p><h2>Rules execute.<br/>AI can advise.</h2></div>
      <div className="lp-rule-grid">
        <article><b>01</b><h3>Observe</h3><p>Anyone can record an edge condition. The signal cannot move funds or restart a valid cooldown.</p></article>
        <article><b>02</b><h3>Confirm</h3><p>Price must agree with TWAP and remain near the edge for 24 hours. Short spikes do nothing.</p></article>
        <article><b>03</b><h3>Re-band</h3><p>At most one move per month. The tighter Up range is allowed only when its measured fee edge covers the full action cost.</p></article>
        <article><b>04</b><h3>Compound</h3><p>No standalone compounding transaction. Fees compound only with a required re-band or user flow.</p></article>
      </div>
    </section>
  </main></>;
}
