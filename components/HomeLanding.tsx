import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { GEN0_SLUG } from "@/lib/curators";

/** Basket chips around the HOODX coin — x/y are % of the stage (0–100). */
const FLOAT_TOKENS = [
  { label: "PONS", x: 4, y: 8, delay: "0s" },
  { label: "UP", x: 22, y: 4, delay: "0.5s" },
  { label: "website", x: 46, y: 2, delay: "1.1s" },
  { label: "MEME", x: 68, y: 6, delay: "0.8s" },
  { label: "AI", x: 88, y: 14, delay: "1.4s" },
  { label: "CASHCAT", x: 94, y: 32, delay: "1.7s" },
  { label: "STONKBROKER", x: 90, y: 50, delay: "2s" },
  { label: "HOOKR", x: 84, y: 68, delay: "1.2s" },
  { label: "696X", x: 72, y: 84, delay: "1s" },
  { label: "DELTA", x: 48, y: 92, delay: "0.6s" },
  { label: "WALLET", x: 24, y: 88, delay: "1.9s" },
  { label: "ETH", x: 2, y: 70, delay: "0.4s" },
  { label: "Index", x: 0, y: 46, delay: "1.5s" },
  { label: "SHROOM", x: 8, y: 24, delay: "2.2s" },
];

const BASKET_CENTER = { x: 50, y: 46 };

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
    <div className="landing">
      <section className="landing-hero mx-auto max-w-6xl px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:pb-16 lg:pt-14">
        <div className="landing-hero-grid">
          <div className="landing-hero-copy rise">
            <p className="landing-eyebrow">Robinhood Chain · On-chain index tokens</p>
            <h1 className="landing-headline">
              One token.
              <br />
              A whole basket.
            </h1>
            <p className="landing-lede">
              Permissionless index funds on Robinhood Chain. Buy one token for exposure to a curated basket of RH
              assets — with a WETH cash sleeve, all on-chain.
            </p>
            <div className="landing-cta-row">
              <Link href={`/i/${GEN0_SLUG}`} className="landing-btn-primary">
                Explore indexes
                <span aria-hidden>→</span>
              </Link>
              <Link href="#create" className="landing-btn-secondary">
                Create an index
              </Link>
            </div>
          </div>

          <div className="landing-stage rise" style={{ animationDelay: "80ms" }}>
            <div className="landing-stage-glow" aria-hidden />
            <svg className="landing-basket-web" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {FLOAT_TOKENS.map((t) => (
                <line
                  key={t.label}
                  x1={BASKET_CENTER.x}
                  y1={BASKET_CENTER.y}
                  x2={t.x}
                  y2={t.y}
                  className="landing-basket-line"
                />
              ))}
            </svg>
            <div className="landing-orbit landing-orbit-a" aria-hidden />
            <div className="landing-orbit landing-orbit-b" aria-hidden />
            <div className="landing-orbit landing-orbit-c" aria-hidden />
            {FLOAT_TOKENS.map((t) => (
              <div
                key={t.label}
                className="landing-float-chip"
                style={{ left: `${t.x}%`, top: `${t.y}%`, animationDelay: t.delay }}
              >
                {t.label}
              </div>
            ))}
            <div className="landing-coin">
              <div className="landing-coin-rim" aria-hidden />
              <BrandMark size={112} priority className="landing-coin-mark" />
            </div>
            <p className="landing-script">More together.</p>
          </div>
        </div>
      </section>

      <section className="landing-values mx-auto max-w-6xl px-4 sm:px-6">
        <div className="landing-values-grid">
          {VALUE_PROPS.map((v, i) => (
            <div key={v.title} className="landing-value-tile rise" style={{ animationDelay: `${120 + i * 60}ms` }}>
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
          <Link href={`/i/${GEN0_SLUG}`} className="landing-path-card landing-path-holders rise">
            <div className="landing-path-bg landing-path-chart" aria-hidden>
              <svg viewBox="0 0 200 80" preserveAspectRatio="none" className="h-full w-full">
                <defs>
                  <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(31,212,198,0.35)" />
                    <stop offset="100%" stopColor="rgba(31,212,198,0)" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 58 C30 52, 45 68, 70 44 S120 22, 200 36 L200 80 L0 80 Z"
                  fill="url(#chartFill)"
                />
                <path
                  d="M0 58 C30 52, 45 68, 70 44 S120 22, 200 36"
                  fill="none"
                  stroke="rgba(31,212,198,0.85)"
                  strokeWidth="2"
                />
              </svg>
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

          <Link href="#create" className="landing-path-card landing-path-curators rise" style={{ animationDelay: "90ms" }}>
            <div className="landing-path-bg landing-path-stack" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
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

      <section className="landing-opportunity">
        <div className="landing-earth-wrap" aria-hidden>
          <div className="landing-earth-glow" />
          <div className="landing-earth-arc" />
          <div className="landing-earth-body" />
          <div className="landing-earth-atmo" />
        </div>
        <div className="landing-opportunity-inner mx-auto max-w-6xl px-4 pb-16 pt-28 text-center sm:px-6 sm:pb-24 sm:pt-36">
          <p className="landing-opportunity-eyebrow">The opportunity</p>
          <h2 className="landing-opportunity-title">A new era of index investing on Robinhood Chain.</h2>
          <p className="landing-opportunity-sub">Real assets. Real communities. Fully on-chain.</p>
          <p className="landing-opportunity-tag">Same people. Bigger possibilities.</p>
        </div>
      </section>
    </div>
  );
}
