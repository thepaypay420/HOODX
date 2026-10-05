"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Shape of /api/autolp-stats (cached per vault share supply server-side; 30 s at the edge). */
export type AutoLpSleeveStat = {
  symbol: string; valueUsd: number; tick: number; tickLower: number; tickUpper: number;
  inRange: boolean; referenceAgrees: boolean; breachStart: number; rebandReady: boolean;
};
export type AutoLpStatsView = {
  updatedAt: number; block: number; navUsd: number; navEth: number; supply: number; perShareUsd: number;
  perShareEth: number; ethUsd: number; sinceLaunchUsdPct: number; sinceLaunchEthPct: number; capUsd: number;
  capacityPct: number; sleeves: AutoLpSleeveStat[];
};

/** Polls the cached stats endpoint (the CDN absorbs the traffic; the chain is read at most every 5 minutes). */
export function useAutoLpStats(pollMs = 60_000) {
  const [stats, setStats] = useState<AutoLpStatsView | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  // fresh=true skips the browser and edge copies (after the visitor's own deposit or withdrawal); the server keys its
  // cache by the vault's share supply, so it answers with figures that include that transaction
  const load = useCallback((fresh = false) => fetch(fresh ? `/api/autolp-stats?t=${Date.now()}` : "/api/autolp-stats", fresh ? { cache: "no-store" } : undefined)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d: AutoLpStatsView) => { if (alive.current) { setStats(d); setFailed(false); } })
    .catch(() => { if (alive.current) setFailed(true); }), []);
  useEffect(() => {
    alive.current = true;
    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [pollMs, load]);
  const refresh = useCallback(() => load(true), [load]);
  return { stats, failed, refresh };
}

/** Animated count-up toward `target` (respects reduced motion). */
export function useCountUp(target: number | undefined, ms = 1100) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (target === undefined || !Number.isFinite(target)) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setV(target); from.current = target; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Adds `is-in` when the element scrolls into view (once). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { el.classList.add("is-in"); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { el.classList.add("is-in"); io.disconnect(); } }), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export const fmtPct = (x: number | undefined, digits = 2) =>
  x === undefined || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
export const fmtUsd = (x: number | undefined, digits = 2) =>
  x === undefined || !Number.isFinite(x) ? "—" : `$${x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
