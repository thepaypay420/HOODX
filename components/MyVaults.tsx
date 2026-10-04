"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Address } from "viem";
import { BrandMark } from "@/components/BrandMark";
import { TokenArt } from "@/components/TokenArt";
import { useCountUp, type AutoLpStatsView } from "@/lib/useAutoLp";
import { vaultMeta } from "@/lib/vaults";

/* ------------------------------------------------------------------ data: one cached endpoint, plus the Auto LP figures already cached for Explore */
type Acct = { mode: "exact" | "average" | "none"; depositedWei: string; withdrawnWei: string; basisWei: string | null; seeded: boolean };
type Raw = { vault: Address; slug: string; kind: "v2" | "v3" | "autolp" | "boost"; symbol: string; name: string; shares: string; valueWei: string | null; estimated: boolean; account: Acct | null };
type Reply = { updatedAt: number; positions: Raw[] };
export type Holding = { key: string; slug: string; kind: Raw["kind"]; symbol: string; name: string; href: string; accent: string; shares: number; valueEth: number | null; estimated: boolean; costEth: number | null; pnlEth: number | null; pct: number | null; pctLabel: string };
const E = 1e18, LAUNCH_PRICE_ETH = 0.04;                                // the factories mint the first shares at 0.04 ETH
const num = (w: string | null) => (w === null ? null : Number(BigInt(w)) / E);
const store = (a: string) => `hoodx:myvaults:${a.toLowerCase()}`;

/** Polls the wallet's positions every minute while the page is visible; `refresh()` asks for fresh numbers (the server caches keep the RPC calm). */
export function useMyVaults(address?: Address) {
  const [data, setData] = useState<Reply | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async (fresh: boolean) => {
    if (!address) return;
    const ticket = ++seq.current; setLoading(true);
    try {
      const bucket = fresh ? Math.floor(Date.now() / 15000) : 0;           // a manual refresh skips the browser cache; the edge still coalesces it
      const r = await fetch(`/api/my-vaults?address=${address}${bucket ? `&r=${bucket}` : ""}`);
      if (!r.ok) throw new Error(String(r.status));
      const d: Reply = await r.json();
      if (ticket !== seq.current) return;
      setData(d); try { sessionStorage.setItem(store(address), JSON.stringify(d)); } catch { /* private mode */ }
    } catch { /* keep showing the last good numbers */ }
    finally { if (ticket === seq.current) setLoading(false); }
  }, [address]);
  useEffect(() => {
    setData(null);
    if (!address) return;
    try { const s = sessionStorage.getItem(store(address)); if (s) { const d = JSON.parse(s); if (d?.positions?.every((p: Raw) => "account" in p)) setData(d); } } catch { /* none */ }
    void load(false);
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(false); }, 60_000);
    const vis = () => { if (document.visibilityState === "visible") void load(false); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [address, load]);
  return { data, loading, refresh: () => load(true) };
}

/** Turns raw positions into display holdings, using the on-chain cost basis from the server:
 *  exact   - return = (value + ETH withdrawn - ETH deposited) / deposited
 *  average - shares also moved by transfer or in-kind exit: return = value / cost of the shares held now - 1
 *  none    - no deposit by this wallet: show how the vault itself has done since launch instead, labelled as such */
export function holdings(data: Reply | null, stats: AutoLpStatsView | null): Holding[] {
  if (!data) return [];
  return data.positions.map((p) => {
    const shares = Number(BigInt(p.shares)) / E, meta = vaultMeta(p.slug), auto = p.kind === "autolp", boost = p.kind === "boost", retired = p.kind === "v2" && p.slug === "696x", a = p.account;
    const valueEth = auto ? (stats ? shares * stats.perShareEth : null) : num(p.valueWei);
    let cost: number | null = null, pnl: number | null = null, label = "Since launch";
    if (a && valueEth !== null && a.mode === "exact") { cost = num(a.depositedWei); pnl = valueEth + (num(a.withdrawnWei) ?? 0) - (cost ?? 0); label = "Your return"; }
    else if (a && valueEth !== null && a.mode === "average" && a.basisWei) { cost = num(a.basisWei); pnl = valueEth - (cost ?? 0); label = "Return on cost"; }
    const launch = auto ? stats?.sinceLaunchEthPct ?? null : boost ? null : valueEth !== null && shares > 0 ? ((valueEth / shares) / LAUNCH_PRICE_ETH - 1) * 100 : null;
    const own = cost && pnl !== null ? (pnl / cost) * 100 : null;
    return { key: p.vault, slug: p.slug, kind: p.kind, symbol: p.symbol, name: auto ? "Hands-free LP" : boost ? "ETH, boosted" : retired ? `${meta?.name ?? p.name} · previous vault` : meta?.name ?? p.name,
      href: auto ? "/autolp" : boost ? "/boost" : `/i/${p.slug}`, accent: auto ? "#b98cff" : boost ? "#ff9a3c" : meta?.accent ?? "#4fd7cb", shares, valueEth, estimated: !auto && p.estimated,
      costEth: own !== null ? cost : null, pnlEth: own !== null ? pnl : null, pct: own ?? launch, pctLabel: own !== null ? label : "Since launch" };
  }).sort((a, b) => (b.valueEth ?? 0) - (a.valueEth ?? 0));
}

/* ------------------------------------------------------------------ view */
const eth = (v: number | null, d = 4) => (v === null ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const usd = (v: number | null) => (v === null ? "" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: v < 100 ? 2 : 0 }));
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`);
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };

function Mark({ h, size }: { h: Holding; size: number }) {
  if (h.kind === "autolp") return <span className="mv-autolp-mark" style={{ width: size, height: size }}><BrandMark size={size * 0.62} /></span>;
  if (h.kind === "boost") return <span className="boost-mark" style={{ width: size, height: size }}><svg viewBox="0 0 44 44" width={size} height={size}><circle cx="22" cy="22" r="21" fill="#1b1006" stroke="#ff9a3c" strokeOpacity=".5" /><path d="M24 7 13 25h8l-2 12 11-18h-8z" fill="#ff9a3c" /></svg></span>;
  return <TokenArt slug={h.slug} src={vaultMeta(h.slug)?.image} size="sm" />;
}

export function MyVaults({ list, loading, updatedAt, onRefresh, ethUsd }: { list: Holding[]; loading: boolean; updatedAt?: number; onRefresh: () => void; ethUsd?: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(id); }, []);
  const total = list.reduce((a, h) => a + (h.valueEth ?? 0), 0);
  const withCost = list.filter((h) => h.costEth !== null && h.pnlEth !== null);
  const cost = withCost.reduce((a, h) => a + (h.costEth ?? 0), 0), pnl = withCost.reduce((a, h) => a + (h.pnlEth ?? 0), 0);
  const ret = cost > 0 ? (pnl / cost) * 100 : null;
  // with no deposits on record (seeded or transferred shares), show how the holdings themselves have done, weighted by value
  const valued = list.filter((h) => h.valueEth !== null && h.pct !== null), weight = valued.reduce((a, h) => a + (h.valueEth ?? 0), 0);
  const launch = weight > 0 ? valued.reduce((a, h) => a + (h.valueEth ?? 0) * (h.pct ?? 0), 0) / weight : null;
  const shown = useCountUp(total, 900);
  const [spin, setSpin] = useState(0);
  const allocation = useMemo(() => list.filter((h) => (h.valueEth ?? 0) > 0), [list]);
  return (
    <section className="mv" aria-label="My vaults">
      <div className="mv-summary">
        <div className="mv-total">
          <p className="mv-label">Total value</p>
          <p className="mv-big">{eth(shown)}<span>ETH</span></p>
          <p className="mv-sub">{ethUsd ? usd(total * ethUsd) : " "}</p>
        </div>
        <div className="mv-perf">
          <p className="mv-label">{ret !== null ? "Your return" : "Since launch"}</p>
          <p className={`mv-big ${(ret ?? launch) === null ? "" : (ret ?? launch)! >= 0 ? "is-up" : "is-down"}`}>{pct(ret ?? launch)}</p>
          <p className="mv-sub">{ret !== null ? `${pnl >= 0 ? "+" : "−"}${eth(Math.abs(pnl))} ETH all time` : "Your holdings, weighted by value"}</p>
        </div>
        <button type="button" className="mv-refresh" onClick={() => { setSpin((n) => n + 1); onRefresh(); }} disabled={loading} aria-label="Refresh balances">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden style={{ transform: `rotate(${spin * 360}deg)` }}><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{loading ? "Updating…" : updatedAt ? `Updated ${ago(Date.now() - updatedAt)}` : "Refresh"}</span>
        </button>
        {allocation.length > 1 && <div className="mv-alloc" aria-hidden>{allocation.map((h) => <i key={h.key} style={{ flexGrow: h.valueEth ?? 0, background: h.accent }} />)}</div>}
      </div>
      <div className="mv-grid">
        {list.map((h) => { const share = total > 0 && h.valueEth !== null ? (h.valueEth / total) * 100 : null;
          return <Link key={h.key} href={h.href} className="mv-card" style={{ "--vault-accent": h.accent } as CSSProperties}>
            <div className="mv-card-head"><Mark h={h} size={40} /><div><p className="mv-name">{h.name}</p><p className="mv-ticker">${h.symbol}</p></div>{share !== null && <span className="mv-share">{share.toFixed(0)}%</span>}</div>
            <div className="mv-card-value"><p className="mv-label">{h.estimated ? "Value · live quotes" : "Value"}</p><p className="mv-val">{eth(h.valueEth)}<span>ETH</span></p><p className="mv-sub">{ethUsd && h.valueEth !== null ? usd(h.valueEth * ethUsd) : " "}</p></div>
            <div className="mv-card-stats">
              <div><p className="mv-label">{h.pctLabel}</p><p className={`mv-stat ${h.pct === null ? "" : h.pct >= 0 ? "is-up" : "is-down"}`}>{pct(h.pct)}</p></div>
              <div><p className="mv-label">{h.pnlEth !== null ? "Profit" : "Shares"}</p><p className="mv-stat">{h.pnlEth !== null ? `${h.pnlEth >= 0 ? "+" : "−"}${eth(Math.abs(h.pnlEth))}` : h.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p></div>
              <span className="mv-open" aria-hidden>→</span>
            </div>
          </Link>; })}
      </div>
      <p className="mv-note">Values are what your shares would fetch at current prices, before gas. Oracle-free vaults are valued from live quotes to sell every holding.</p>
    </section>
  );
}
