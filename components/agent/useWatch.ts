"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { evaluate, reading, type SavedRule, type WatchRule, type WatchState } from "@/lib/agent/watch";

/* The companion's watch rules: saved in this browser, checked by plain code every two minutes while any HOODX tab is open
 * (no model, no cost). A rule fires once; it then shows as triggered until removed. */
const RULES = "hoodx-watch-v1", SEEN = "hoodx-last-visit-v1", EVERY_MS = 120_000;
export type LiveState = WatchState & { totalUsd: number | null; walletEth: string | null; boostLevels: { fullAbove: number | null; firstStepBelow: number | null } | null };
export type LastVisit = { at: number; totalUsd: number | null; target: number | null };

const load = <T,>(k: string, d: T): T => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export function useWatch(wallet: string | undefined, onFire: (text: string) => void) {
  const [rules, setRules] = useState<SavedRule[]>([]);
  const [state, setState] = useState<LiveState | null>(null);
  const [lastVisit, setLastVisit] = useState<LastVisit | null>(null);
  const fire = useRef(onFire); fire.current = onFire;
  const rulesRef = useRef(rules); rulesRef.current = rules;

  useEffect(() => { setRules(load<SavedRule[]>(RULES, [])); setLastVisit(load<LastVisit | null>(SEEN, null)); }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/agent/state${wallet ? `?wallet=${wallet}` : ""}`);
      if (!r.ok) return null;
      const s = (await r.json()) as LiveState;
      setState(s);
      // check every rule that has not fired yet
      let changed = false;
      const next = rulesRef.current.map((x) => {
        if (x.firedAt) return x;
        const hit = evaluate(x.rule, s, x.baseline);
        if (!hit) return x;
        changed = true;
        fire.current(hit);
        try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("HOODX", { body: hit, icon: "/icon.png", tag: x.id }); } catch { /* notifications unavailable */ }
        return { ...x, firedAt: Date.now(), firedText: hit };
      });
      if (changed) { setRules(next); save(RULES, next); }
      return s;
    } catch { return null; }
  }, [wallet]);

  // first reading now; then every two minutes while there is something to watch, and whenever the tab comes back
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const active = rules.some((r) => !r.firedAt);
    if (!active) return;
    const id = setInterval(() => { if (document.visibilityState === "visible" || "Notification" in window) void refresh(); }, EVERY_MS);
    const vis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [rules, refresh]);

  const add = useCallback(async (rule: WatchRule, label: string, notify: boolean) => {
    const s = state ?? (await refresh());
    const base = s ? reading(rule, s) ?? undefined : undefined;
    const r: SavedRule = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, rule, label, createdAt: Date.now(), baseline: base };
    const next = [...rulesRef.current.filter((x) => x.label !== label), r];
    rulesRef.current = next; setRules(next); save(RULES, next);
    if (notify && typeof Notification !== "undefined" && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* blocked */ } }
    void refresh();   // a rule that is already true fires now, not in two minutes
  }, [state, refresh]);

  const remove = useCallback((id: string) => { const next = rulesRef.current.filter((x) => x.id !== id); setRules(next); save(RULES, next); }, []);

  /** Remember this visit, for "since your last visit" next time (at most once an hour). */
  const markVisit = useCallback(() => {
    if (!state) return;
    const prev = load<LastVisit | null>(SEEN, null);
    if (prev && Date.now() - prev.at < 3_600_000) return;
    save(SEEN, { at: Date.now(), totalUsd: state.totalUsd, target: state.boost?.target ?? null } satisfies LastVisit);
  }, [state]);

  return { rules, state, lastVisit, add, remove, refresh, markVisit };
}
