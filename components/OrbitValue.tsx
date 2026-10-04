"use client";

import { useEffect, useRef, useState } from "react";

/** Under $100k the whole number reads best ($12,480); above it, compact ($1.24M). */
const fmt = (usd: number) => usd < 100_000
  ? "$" + Math.round(usd).toLocaleString("en-US")
  : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(usd);

/** Total value in HOODX vaults, on the reverse of the home orbit's coin: the coin turns over every few seconds to show
 *  what it holds. One cached request (the CDN serves it for two minutes), a gentle count-up the first time, and a quiet
 *  refresh every two minutes while the tab is visible. */
export function OrbitValue() {
  const [usd, setUsd] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    let live = true;
    const load = () => void fetch("/api/platform-tvl").then((r) => r.ok ? r.json() as Promise<{ usd?: number }> : undefined).then((d) => { if (live && typeof d?.usd === "number") setUsd(d.usd); }).catch(() => {});
    load();
    // refreshes only while someone is looking
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 120_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (usd === null) return;
    const start = performance.now(), a = from.current, b = usd, ms = a === 0 ? 1400 : 600;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { from.current = b; setShown(b); return; }
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * e);
      if (t < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [usd]);

  return (
    <div className="coin-reverse" aria-live="polite">
      <span className="coin-reverse-label">Total value</span>
      {usd === null ? <span className="coin-reverse-skeleton" aria-label="Loading" /> : <strong>{fmt(shown)}</strong>}
      <span className="coin-reverse-sub"><i aria-hidden />Live on-chain</span>
    </div>
  );
}
