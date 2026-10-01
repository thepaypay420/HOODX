"use client";

import { useState, type CSSProperties } from "react";
import { BrandMark } from "@/components/BrandMark";
import { STOCK_LOGOS, stockLogoSrc } from "@/lib/stockLogos";
import type { AutoLpSleeveStat } from "@/lib/useAutoLp";

const R = 38; // orbit radius, % of the square

function Rocket() {
  return <svg viewBox="0 0 64 64" className="ao-mark" aria-hidden>
    <defs><linearGradient id="ao-rk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f4f1ff" /><stop offset="1" stopColor="#b9c7ff" /></linearGradient></defs>
    <path d="M32 6c9 7 13 17 12 30l-5 6H25l-5-6C19 23 23 13 32 6z" fill="url(#ao-rk)" />
    <circle cx="32" cy="25" r="5" fill="#0d1020" />
    <path d="M20 36l-7 9 9-2zM44 36l7 9-9-2z" fill="#9fb0ff" />
    <path d="M27 44h10l-2 9h-6z" fill="#ff9d5c" />
  </svg>;
}

function Logo({ symbol }: { symbol: string }) {
  const src = stockLogoSrc(symbol);
  const [failed, setFailed] = useState(false);
  const meta = STOCK_LOGOS[symbol];
  if (!src) return <span className="ao-tile is-mark"><Rocket /></span>;
  if (failed) return <span className="ao-tile is-mono">{symbol.slice(0, 2)}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- edge-cached proxy route; next/image adds no value here
  return <span className={`ao-tile${meta?.light ? " is-light" : ""}`}><img src={src} alt="" width={128} height={128} decoding="async" onError={() => setFailed(true)} /></span>;
}

export function AutoLpOrbit({ sleeves, symbols, now }: { sleeves: AutoLpSleeveStat[] | undefined; symbols: readonly string[]; now: number }) {
  const n = symbols.length;
  const earning = sleeves?.filter((s) => s.inRange && s.referenceAgrees).length;
  const nodes = symbols.map((sym, i) => {
    const a = ((i * 360) / n - 90) * (Math.PI / 180);
    const s = sleeves?.[i];
    const tone = !s ? "idle" : !s.referenceAgrees ? "warn" : s.inRange ? "good" : "wait";
    const hoursLeft = s && !s.inRange && s.breachStart > 0 ? Math.max(0, 24 - Math.floor((now - s.breachStart) / 3600)) : undefined;
    return { sym, i, x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a), tone, s, hoursLeft };
  });
  return <div className="ao" aria-label={`Autopilot orbit: ${earning ?? "…"} of ${n} stocks earning`} role="img">
    <div className="ao-bg" aria-hidden><span className="ao-ring r1" /><span className="ao-ring r2" /><span className="ao-ring r3" /></div>
    <div className="ao-spin">
      <svg className="ao-flows" viewBox="0 0 100 100" aria-hidden>
        <defs>
          <linearGradient id="ao-flow-good" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100"><stop offset="0" stopColor="#4fd7cb" /><stop offset="1" stopColor="#b98cff" /></linearGradient>
        </defs>
        {nodes.map((p) => <g key={p.sym} className={`ao-flow is-${p.tone}`}>
          <line x1="50" y1="50" x2={p.x} y2={p.y} className="ao-flow-base" vectorEffect="non-scaling-stroke" />
          {p.tone === "good" && <line x1={p.x} y1={p.y} x2="50" y2="50" className="ao-flow-pulse" pathLength={100}
            style={{ animationDelay: `${-p.i * 0.37}s` }} />}
        </g>)}
      </svg>
      {nodes.map((p) => <div key={p.sym} className={`ao-node is-${p.tone}`} style={{ left: `${p.x}%`, top: `${p.y}%`, "--k": p.i } as CSSProperties} tabIndex={0}>
        <div className="ao-upright">
          <div className="ao-float">
            <Logo symbol={p.sym} />
            <span className="ao-dot" aria-hidden />
          </div>
          <span className="ao-chip">{p.sym}{p.hoursLeft !== undefined ? ` · ${p.hoursLeft}h` : ""}</span>
          <div className="ao-tip" role="tooltip">
            <b>{STOCK_LOGOS[p.sym]?.name ?? p.sym}</b>
            <span className={`is-${p.tone}`}>{p.tone === "good" ? "Earning in range" : p.tone === "wait" ? `Out of range${p.hoursLeft !== undefined ? ` · ${p.hoursLeft}h to rebalance` : ""}` : p.tone === "warn" ? "Price check paused" : "Loading"}</span>
            {p.s && <small>${p.s.valueUsd.toFixed(2)} in this position</small>}
          </div>
        </div>
      </div>)}
    </div>
    <div className="ao-core" aria-hidden>
      <span className="ao-halo" /><span className="ao-halo h2" />
      <div className="ao-core-inner">
        <BrandMark size={192} className="ao-brand" priority />
        <span className="ao-core-count"><b>{earning ?? "–"}</b>/{n} earning</span>
      </div>
    </div>
  </div>;
}
