"use client";

import { regime } from "@/lib/boost";

/** 0x-2x leverage dial: dollars (0), ETH (1), boosted (2). Needle = vault now; ghost tick = the signal's target. */
export function BoostGauge({ leverage, target, live }: { leverage?: number; target?: number; live: boolean }) {
  const R = 118, C = 140, START = 200, SWEEP = 140; // degrees, an arc opening upward
  const angle = (x: number) => START + (Math.max(0, Math.min(2, x)) / 2) * SWEEP;
  const pt = (deg: number, r = R) => { const a = (deg * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)] as const; };
  const arc = (from: number, to: number, r = R) => {
    const [x1, y1] = pt(angle(from), r), [x2, y2] = pt(angle(to), r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const shown = live ? leverage : target;
  const [nx, ny] = pt(angle(shown ?? 0), R - 26);
  const [tx1, ty1] = pt(angle(target ?? 0), R + 10), [tx2, ty2] = pt(angle(target ?? 0), R - 10);
  const r = regime(shown ?? 0);
  return <figure className={`bx-gauge is-${r.key}`} aria-label={`Leverage ${shown?.toFixed(2) ?? "unknown"}x, ${r.label}`}>
    <svg viewBox="0 0 280 200" role="img">
      <defs>
        <linearGradient id="bx-arc" x1="0" x2="1">
          <stop offset="0" stopColor="#4fd7cb" /><stop offset=".5" stopColor="#b98cff" /><stop offset="1" stopColor="#ff9a3c" />
        </linearGradient>
        <filter id="bx-glow"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <path d={arc(0, 2)} className="bx-gauge-track" />
      <path d={arc(0, 2)} className="bx-gauge-arc" stroke="url(#bx-arc)" />
      <path d={arc(0, Math.max(0.001, shown ?? 0))} className="bx-gauge-fill" stroke="url(#bx-arc)" filter="url(#bx-glow)" />
      {[0, 0.5, 1, 1.5, 2].map((x) => { const [a, b] = pt(angle(x), R + 16); return <text key={x} x={a} y={b} className="bx-gauge-label">{x}x</text>; })}
      {target !== undefined && <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} className="bx-gauge-target" />}
      <line x1={C} y1={C} x2={nx} y2={ny} className="bx-gauge-needle" />
      <circle cx={C} cy={C} r="7" className="bx-gauge-hub" />
    </svg>
    <figcaption>
      <strong>{shown !== undefined ? `${shown.toFixed(2)}x` : "—"}</strong>
      <span>{r.label}{live ? "" : " · if launched now"}</span>
      {live && target !== undefined && <small>Signal target {target.toFixed(2)}x</small>}
    </figcaption>
  </figure>;
}
