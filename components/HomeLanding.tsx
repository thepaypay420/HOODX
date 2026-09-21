import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { LandingMotion } from "@/components/LandingMotion";

/** Right-side chips zigzag on x (in/out) so labels don’t stack on one column. */
const FLOAT_TOKENS = [
  { label: "MEME", x: "56%", y: "8%", delay: "0.8s" },
  { label: "CASHCAT", right: "4%", y: "20%", delay: "1.1s" },
  { label: "AI", x: "81%", y: "36%", delay: "1.4s" },
  { label: "ETH", x: "4%", y: "52%", delay: "0.4s" },
  { label: "HOOKR", right: "2%", y: "50%", delay: "1.6s" },
  { label: "696X", x: "67%", y: "72%", delay: "1s" },
];

const VALUE_PROPS = [
  {
    title: "Permissionless",
    sub: "Open to everyone",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 11V8a4 4 0 118 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "On-chain",
    sub: "Transparent by design",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M14 11a5 5 0 00-7.07 0L5.52 12.41a5 5 0 007.07 7.07L14 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Redeem anytime",
    sub: "Your ETH, always",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M13 2L4 14h7l-1 8 10-14h-7l0-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function HomeLanding() {
  return (
    <LandingMotion>
      <section className="landing-hero mx-auto max-w-6xl px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:pb-16 lg:pt-14">
        <div className="landing-hero-grid">
          <div className="landing-hero-copy" data-motion>
            <p className="landing-eyebrow">Robinhood Chain · On-chain index tokens</p>
            <h1 className="landing-headline">
              <span className="studio-title-line">One token.</span>
              <span className="studio-title-line">A whole basket.</span>
            </h1>
            <p className="landing-lede">
              Permissionless index funds on Robinhood Chain. Buy one token for a curated basket of RH-chain tokens —
              with a WETH cash sleeve, all on-chain.
            </p>
            <div className="landing-cta-row">
              <Link href="/explore?from=home" className="landing-btn-primary">
                Explore indexes
                <span aria-hidden>→</span>
              </Link>
              <Link href="#create" className="landing-btn-secondary">
                Create an index
              </Link>
            </div>
          </div>

          <div className="landing-stage" data-motion>
            <div className="landing-stage-glow" aria-hidden />
            <div className="landing-orbit landing-orbit-a" aria-hidden />
            <div className="landing-orbit landing-orbit-b" aria-hidden /><div className="studio-orbit-third" aria-hidden /><span className="studio-stage-caption">MANY ASSETS. ONE CONVICTION.</span>
            {FLOAT_TOKENS.map((t) => (
              <div
                key={t.label}
                className="landing-float-chip"
                style={{
                  top: t.y,
                  animationDelay: t.delay,
                  ...(t.right ? { right: t.right, left: "auto" } : { left: t.x }),
                }}
              >
                {t.label}
              </div>
            ))}
            <div className="landing-coin">
              <div className="landing-coin-rim" aria-hidden /><div className="studio-coin-light" aria-hidden />
              <BrandMark size={112} priority className="landing-coin-mark" />
            </div>
            <p className="landing-script">More together.</p>
          </div>
        </div>
      </section>

      <section className="landing-values mx-auto max-w-6xl px-4 sm:px-6">
        <div className="landing-values-grid">
          {VALUE_PROPS.map((v, i) => (
            <div key={v.title} className="landing-value-tile" data-motion style={{ animationDelay: `${i * 100}ms` }}>
              <span className="landing-value-icon">{v.icon}</span>
              <div>
                <p className="landing-value-title">{v.title}</p>
                <p className="landing-value-sub">{v.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-paths mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="landing-paths-grid">
          <Link href="/explore?from=home" className="landing-path-card landing-path-holders" data-motion>
            <div className="studio-basket-art" aria-hidden>
              <svg viewBox="0 0 480 150" fill="none"><defs><linearGradient id="basketFlow"><stop stopColor="#4bcfc2" stopOpacity=".2"/><stop offset="1" stopColor="#80f9db"/></linearGradient></defs>{[30,75,120].map((y,i)=><g key={y}><path className="studio-flow-track" d={`M50 ${y} H135 C210 ${y} 210 75 285 75 H350`} /><path className={`studio-flow studio-flow-${i}`} pathLength="1" d={`M50 ${y} H135 C210 ${y} 210 75 285 75 H350`} /><circle cx="50" cy={y} r="13" className="studio-asset-node"/><circle cx="50" cy={y} r="3" fill="#8be9d5"/></g>)}<circle cx="380" cy="75" r="32" className="studio-index-node"/><path d="M368 75h24m-12-12v24" stroke="#bafded" strokeWidth="2"/><circle cx="380" cy="75" r="42" className="studio-index-ring"/></svg>
              <div className="studio-art-caption"><span>2–24 ASSETS</span><span>ONE INDEX</span></div>
            </div>
            <p className="landing-path-label">For holders</p>
            <h2 className="landing-path-title">Diversify in one token.</h2>
            <p className="landing-path-copy">
              Get exposure to 2–24 Uni V3/V4 memecoin names plus a WETH cash sleeve. NAV and every holding are visible
              on-chain.
            </p>
            <span className="landing-path-link">
              Explore indexes <span aria-hidden>→</span>
            </span>
          </Link>

          <Link href="#create" className="landing-path-card landing-path-curators" data-motion>
            <div className="studio-steps" aria-hidden>{[{title:"Build",sub:"Choose your basket"},{title:"Share",sub:"Grow your audience"},{title:"Earn",sub:"Fees on deposits"}].map((step,i)=><div className={`studio-step studio-step-${i}`} key={step.title}><span className="studio-step-number">0{i+1}</span><div className="studio-step-column"/><b>{step.title}</b><small>{step.sub}</small></div>)}</div>
            <p className="landing-path-label">For curators</p>
            <h2 className="landing-path-title">Build. Share. Earn.</h2>
            <p className="landing-path-copy">
              Create and manage on-chain indexes. Set your allocation, grow a following, and earn management fees on
              every join.
            </p>
            <span className="landing-path-link">
              Create an index <span aria-hidden>→</span>
            </span>
          </Link>
        </div>
      </section>

      <section className="landing-opportunity" data-motion>
        <div className="landing-earth-wrap" aria-hidden>
          <div className="landing-earth-glow" />
          <div className="landing-earth-arc" />
          <div className="landing-earth-body" />
          <div className="landing-earth-atmo" />
        </div>
        <div className="landing-opportunity-inner mx-auto max-w-6xl px-4 pb-16 pt-28 text-center sm:px-6 sm:pb-24 sm:pt-36">
          <p className="landing-opportunity-eyebrow">The opportunity</p>
          <h2 className="landing-opportunity-title">On-chain baskets for Robinhood Chain.</h2>
          <p className="landing-opportunity-sub">Curated tokens. Transparent vaults. Redeem anytime.</p>
          <p className="landing-opportunity-tag">Same people. Bigger possibilities.</p>
        </div>
      </section>
    </LandingMotion>
  );
}
