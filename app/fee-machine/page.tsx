import Image from "next/image";
import Link from "next/link";
import { Hud } from "@/components/Hud";

const sleeves = [
  { pair: "DELTA / WETH", weight: "30%", role: "Persistent 1% flow", cadence: "±10% · 1h TWAP · no downside chase" },
  { pair: "PONGO / WETH", weight: "30%", role: "Persistent 1% flow", cadence: "±10% · 1h TWAP · no downside chase" },
  { pair: "GIWA / WETH", weight: "30%", role: "Persistent 1% flow", cadence: "±10% · 1h TWAP · no downside chase" },
  { pair: "WETH / USDG", weight: "10%", role: "Liquid core sleeve", cadence: "±22% · 30m TWAP · 7d cooldown" },
];

export const metadata = {
  title: "Fee Machine · HOODX",
  description: "The protocol-controlled HOODX active-liquidity pilot.",
};

export default function FeeMachinePage() {
  return <><Hud /><main className="lp-pilot-page">
    <section className="lp-pilot-hero">
      <div className="lp-pilot-copy">
        <Link href="/explore" className="lp-pilot-back">← Explore</Link>
        <p className="landing-eyebrow">Protocol pilot · Four LP sleeves</p>
        <h1>Fee<br/>machine.</h1>
        <p className="lp-pilot-thesis">A four-sleeve basket designed to keep the seed deployed across persistent PONS flow and a WETH / USDG core.</p>
        <div className="lp-pilot-status"><i/> Launch gated <span>Closed $200 canary. Public deposits remain disabled.</span></div>
      </div>
      <div className="lp-pilot-art" aria-hidden>
        <span className="lp-pilot-ring lp-ring-one"/><span className="lp-pilot-ring lp-ring-two"/>
        <Image src="/vaults/feex.png" alt="" width={360} height={360} priority />
      </div>
    </section>

    <section className="lp-pilot-allocation" aria-label="Target allocation">
      <div className="lp-pilot-section-head"><div><p className="landing-eyebrow">30 · 30 · 30 · 10</p><h2>Every dollar has a job.</h2></div><p>Three fee engines and one major-pair core. No idle ETH reserve and no leverage.</p></div>
      <div className="lp-sleeve-list">
        {sleeves.map((sleeve, index) => <article key={sleeve.pair}>
          <span>0{index + 1}</span><div><h3>{sleeve.pair}</h3><p>{sleeve.role}</p></div><strong>{sleeve.weight}</strong><small>{sleeve.cadence}</small>
        </article>)}
      </div>
    </section>

    <section className="lp-pilot-rules">
      <div><p className="landing-eyebrow">Management engine</p><h2>Earn the flow.<br/>Refuse the chase.</h2></div>
      <div className="lp-rule-grid">
        <article><b>01</b><h3>Verify</h3><p>Every pool, fee setting, and live TWAP must match the audited launch before capital moves.</p></article>
        <article><b>02</b><h3>Wait</h3><p>A range must remain at its TWAP edge for 24 hours. A one-block move cannot start the timer.</p></article>
        <article><b>03</b><h3>Protect</h3><p>PONS sleeves never re-center downward into a falling token. A seven-day cooldown caps churn.</p></article>
        <article><b>04</b><h3>Recover</h3><p>FEEX unwraps into four independent sleeve tokens. Recovery needs no router, keeper, or website.</p></article>
      </div>
    </section>
  </main></>;
}
