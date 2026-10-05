"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import type { Card, ChatMessage } from "@/lib/agent/types";
import { useWallet } from "@/lib/wallet";
import { AgentCard } from "./AgentCards";

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

  // the conversation survives navigation within the tab, and only within it
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const s = sessionStorage.getItem(STORE); if (s) setTurns(JSON.parse(s)); } catch { /* storage unavailable */ } setReady(true); }, []);
  // save only once the restore above has landed, or the first empty render would overwrite the saved conversation
  useEffect(() => { if (!ready) return; try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20))); } catch { /* storage unavailable */ } }, [turns, ready]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);

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
        <button type="button" className="agent-launch" onClick={() => setOpen(true)} aria-label="Ask HOODX">
          <Core size={40} />
          <span className="agent-launch-text"><b>Ask HOODX</b><span>Your vaults, explained</span></span>
          <kbd className="agent-kbd">Ctrl K</kbd>
        </button>
      )}
      {open && <div className="agent-scrim" onClick={() => setOpen(false)} aria-hidden />}
      <section className={`agent-panel${open ? " open" : ""}`} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-hidden={!open}>
        <i className="agent-grabber" aria-hidden />
        <header className="agent-head">
          <Core size={40} />
          <span className="agent-head-text"><b id={titleId}>HOODX</b><span>Reads · Proposes · <em>You sign</em></span></span>
          {turns.length > 0 && <button type="button" className="agent-icon-btn" onClick={() => setTurns([])} aria-label="Start a new conversation"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" /></svg></button>}
          <button type="button" className="agent-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>

        <div className="agent-list" ref={listRef} aria-live="polite">
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
              {t.cards?.map((c, k) => <AgentCard key={k} card={c} onAsk={(q) => void send(q)} />)}
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
