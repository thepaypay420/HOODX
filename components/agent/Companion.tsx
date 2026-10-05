"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import type { Card, ChatMessage } from "@/lib/agent/types";
import { useWallet } from "@/lib/wallet";
import { AgentCard } from "./AgentCards";
import { useWatch, type LastVisit, type LiveState } from "./useWatch";
import type { SavedRule } from "@/lib/agent/watch";

/** Ask the companion from anywhere: a "Why?" chip calls askHoodx("Why is …?"). */
export function askHoodx(question: string) { window.dispatchEvent(new CustomEvent("hoodx:ask", { detail: question })); }

type Turn = { role: "user" | "assistant"; text: string; cards?: Card[] };
const STORE = "hoodx-agent-v1";

function vaultFromPath(path: string): string | undefined {
  if (path.startsWith("/boost")) return "boost";
  if (path.startsWith("/autolp")) return "autolp";
  const m = path.match(/^\/i\/([a-z0-9-]+)/); return m?.[1];
}
function suggestions(vault?: string): string[] {
  if (vault === "boost") return ["Why is Boosted ETH at its current leverage?", "What would make it step aside?", "Put 0.01 ETH into Boosted ETH"];
  if (vault === "autolp") return ["How does Hands-free LP earn?", "What's my position worth?", "Put 0.01 ETH into Hands-free LP"];
  if (vault) return ["What's in this index?", "How has it done since launch?", "What are my positions?"];
  return ["What's in my vaults?", "Why is Boosted ETH at its current leverage?", "Which indexes hold NVIDIA?"];
}

export function Core({ size = 40 }: { size?: number }) {
  return (
    <span className="agent-core" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="15" ry="6" /><ellipse cx="20" cy="20" rx="6" ry="15" /></svg>
      <BrandMark size={Math.round(size * 0.5)} />
    </span>
  );
}

export function Companion() {
  const path = usePathname() || "/";
  const { address } = useWallet();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const vault = vaultFromPath(path);
  const [unread, setUnread] = useState(false);
  const openRef = useRef(open); openRef.current = open;
  // a watch rule fired: it lands in the conversation as an alert, and the launcher shows a dot until opened
  const onFire = useCallback((text: string) => {
    setTurns((t) => [...t, { role: "assistant", text: `Alert: ${text}` }]);
    if (!openRef.current) setUnread(true);
  }, []);
  const watch = useWatch(address, onFire);
  const { markVisit } = watch;
  useEffect(() => { if (open) { setUnread(false); markVisit(); } }, [open, markVisit]);

  // the conversation survives navigation within the tab, and only within it
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const s = sessionStorage.getItem(STORE); if (s) setTurns(JSON.parse(s)); } catch { /* storage unavailable */ } setReady(true); }, []);
  // save only once the restore above has landed, or the first empty render would overwrite the saved conversation
  useEffect(() => { if (!ready) return; try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20))); } catch { /* storage unavailable */ } }, [turns, ready]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);

  // Phones: the keyboard shrinks only the *visible* area, so a sheet pinned to the page bottom gets pushed out of view.
  // While the panel is open, lock the page and track the visible area: with the keyboard up the sheet fills exactly the
  // space above it (header on top, input on the keyboard), like a messaging app.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 767px)").matches) return;
    const vv = window.visualViewport, html = document.documentElement, body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow, touch: body.style.overscrollBehavior };
    html.style.overflow = "hidden"; body.style.overflow = "hidden"; body.style.overscrollBehavior = "none";
    const apply = () => {
      const el = panelRef.current; if (!el || !vv) return;
      const typing = window.innerHeight - vv.height > 120;
      el.style.setProperty("--vv-top", `${vv.offsetTop}px`);
      el.style.setProperty("--vv-h", `${vv.height}px`);
      if (typing !== el.classList.contains("typing")) {
        el.classList.toggle("typing", typing);
        if (typing) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
      }
    };
    apply();
    vv?.addEventListener("resize", apply); vv?.addEventListener("scroll", apply);
    return () => {
      vv?.removeEventListener("resize", apply); vv?.removeEventListener("scroll", apply);
      html.style.overflow = prev.html; body.style.overflow = prev.body; body.style.overscrollBehavior = prev.touch;
      panelRef.current?.classList.remove("typing");
    };
  }, [open]);

  const send = useCallback(async (text: string) => {
    const q = text.trim(); if (!q || busy) return;
    setOpen(true); setInput(""); setBusy(true);
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    const messages: ChatMessage[] = next.slice(-12).map((t) => ({ role: t.role, content: t.text }));
    try {
      const r = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, wallet: address, page: { path, vault } }) });
      const j = await r.json().catch(() => null) as { reply?: string; cards?: Card[]; error?: string } | null;
      if (r.status === 429) setTurns((t) => [...t, { role: "assistant", text: "HOODX is busy for a moment. Try again in a minute." }]);
      else if (!r.ok || !j?.reply) setTurns((t) => [...t, { role: "assistant", text: "I couldn't answer that just now. Please try again." }]);
      else setTurns((t) => [...t, { role: "assistant", text: j.reply!, cards: j.cards }]);
    } catch {
      setTurns((t) => [...t, { role: "assistant", text: "You seem to be offline. Try again in a moment." }]);
    } finally { setBusy(false); }
  }, [turns, busy, address, path, vault]);

  useEffect(() => {
    const onAsk = (e: Event) => { const q = (e as CustomEvent<string>).detail; if (q) void send(q); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("hoodx:ask", onAsk); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("hoodx:ask", onAsk); window.removeEventListener("keydown", onKey); };
  }, [send]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);

  return (
    <>
      {!open && (
        <button type="button" className={`agent-launch${unread ? " has-alert" : ""}`} onClick={() => setOpen(true)} aria-label={unread ? "Ask HOODX, new alert" : "Ask HOODX"}>
          <Core size={40} />
          {unread && <i className="agent-dot" aria-hidden />}
          <span className="agent-launch-text"><b>Ask HOODX</b><span>Your vaults, explained</span></span>
          <kbd className="agent-kbd">Ctrl K</kbd>
        </button>
      )}
      {open && <div className="agent-scrim" onClick={() => setOpen(false)} aria-hidden />}
      <section ref={panelRef} className={`agent-panel${open ? " open" : ""}`} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-hidden={!open}>
        <i className="agent-grabber" aria-hidden />
        <header className="agent-head">
          <Core size={40} />
          <span className="agent-head-text"><b id={titleId}>HOODX</b><span>Reads · Proposes · <em>You sign</em></span></span>
          {turns.length > 0 && <button type="button" className="agent-icon-btn" onClick={() => setTurns([])} aria-label="Start a new conversation"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" /></svg></button>}
          <button type="button" className="agent-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>

        <div className="agent-list" ref={listRef} aria-live="polite">
          <Briefing state={watch.state} last={watch.lastVisit} rules={watch.rules} onRemove={watch.remove} connected={!!address} />
          {turns.length === 0 && (
            <div className="agent-empty">
              <p>Ask about any vault, your positions, or say what you&apos;d like to do. I prepare it, you check it and sign.</p>
              <div className="agent-suggest">{suggestions(vault).map((s) => <button key={s} type="button" onClick={() => void send(s)}>{s}</button>)}</div>
            </div>
          )}
          {turns.map((t, i) => t.role === "user" ? (
            <div key={i} className="agent-msg-user">{t.text}</div>
          ) : (
            <div key={i} className="agent-msg-bot">
              <p>{t.text}</p>
              {t.cards?.map((c, k) => <AgentCard key={k} card={c} onAsk={(q) => void send(q)} onWatch={watch.add} watching={(label) => watch.rules.some((r) => r.label === label)} />)}
            </div>
          ))}
          {busy && <div className="agent-thinking" aria-label="Thinking"><i /><i /><i /></div>}
        </div>

        <form className="agent-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <label htmlFor="agent-ask" className="sr-only">Ask about your vaults</label>
          <input id="agent-ask" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your vaults…" maxLength={600} autoComplete="off" />
          <button type="submit" aria-label="Send" disabled={!input.trim() || busy}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
        </form>
        <p className="agent-foot">AI can make mistakes. Every transaction is checked against your words and simulated before you sign.</p>
      </section>
    </>
  );
}

/** A small "Why?" next to a number: opens the companion with the question already asked. */
export function WhyChip({ question, label = "Why?" }: { question: string; label?: string }) {
  return <button type="button" className="agent-why" onClick={() => askHoodx(question)}>{label}</button>;
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Today": the three lines worth knowing, from live data, plus what is being watched. No model involved. */
function Briefing({ state, last, rules, onRemove, connected }: { state: LiveState | null; last: LastVisit | null; rules: SavedRule[]; onRemove: (id: string) => void; connected: boolean }) {
  if (!state) return null;
  const lines: { dot: string; text: React.ReactNode }[] = [];
  if (state.boost) {
    const t = state.boost.target, lv = state.boostLevels;
    lines.push({ dot: "#ff9a3c", text: t >= 1.99 ? <>Boost is at full <b>2×</b>{lv?.firstStepBelow ? <>; it steps down below <b>{usd(lv.firstStepBelow)}</b></> : null}.</>
      : t <= 0.05 ? <>Boost is <b>aside in dollars</b>{lv?.fullAbove ? <>; it leans back in above <b>{usd(lv.fullAbove)}</b></> : null}.</>
      : <>Boost is at <b>{t.toFixed(2)}×</b>{lv?.fullAbove ? <>; full 2× above <b>{usd(lv.fullAbove)}</b></> : null}.</> });
  }
  if (connected && state.totalUsd !== null) {
    const d = last?.totalUsd ? state.totalUsd - last.totalUsd : null;
    lines.push({ dot: "#4fd7cb", text: <>Your vaults hold <b>{usd(state.totalUsd)}</b>{d !== null && Math.abs(d) >= 0.01 ? <> · <span className={d >= 0 ? "up" : "down"}>{d >= 0 ? "+" : "−"}{usd(Math.abs(d))}</span> since your last visit</> : null}.</> });
  }
  if (state.ethUsd) lines.push({ dot: "#b98cff", text: <>ETH is <b>{usd(state.ethUsd)}</b>.</> });
  return (
    <div className="agent-card agent-brief">
      <div className="agent-brief-top"><span className="agent-eyebrow agent-eyebrow-teal">Today</span><span className="agent-fine">Live from the chain</span></div>
      <div className="agent-brief-lines">{lines.map((l, i) => <div key={i}><i style={{ background: l.dot }} /><span>{l.text}</span></div>)}</div>
      {rules.length > 0 && (
        <div className="agent-watching">
          <span className="agent-eyebrow">Watching for you</span>
          <div className="agent-watch-chips">{rules.map((r) => (
            <span key={r.id} className={`agent-watch-chip${r.firedAt ? " fired" : ""}`} title={r.firedText}>
              {r.firedAt ? "Triggered: " : ""}{r.label}
              <button type="button" onClick={() => onRemove(r.id)} aria-label={`Stop watching ${r.label}`}>×</button>
            </span>
          ))}</div>
        </div>
      )}
    </div>
  );
}
