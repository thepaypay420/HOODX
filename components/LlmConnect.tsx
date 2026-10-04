"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { HOODX_AGENT_PROMPT } from "@/lib/llmConnect";

const MCP_URL = "https://www.xhoodindex.com/mcp";
const CURSOR_INSTALL = `cursor://anysphere.cursor-deeplink/mcp/install?name=hoodx&config=${typeof btoa === "function" ? btoa(JSON.stringify({ url: MCP_URL })) : ""}`;
const CLAUDE_CODE = `claude mcp add --transport http hoodx ${MCP_URL}`;

type Client = "claude" | "chatgpt" | "cursor" | "code";
const CLIENTS: { id: Client; label: string; steps: React.ReactNode[]; action?: { label: string; href: string } }[] = [
  { id: "claude", label: "Claude", steps: [<>Open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</>, <>Name it <b>HOODX</b> and paste the server URL.</>, <>In any chat, switch HOODX on from the tools menu.</>],
    action: { label: "Open Claude connectors", href: "https://claude.ai/settings/connectors" } },
  { id: "chatgpt", label: "ChatGPT", steps: [<>Open <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.</>, <>Choose <b>Create</b>, name it <b>HOODX</b>, paste the server URL and pick <b>No authentication</b>.</>, <>Select HOODX in a chat to use its tools.</>] },
  { id: "cursor", label: "Cursor", steps: [<>Click <b>Add to Cursor</b> and confirm.</>, <>Or add the server URL under <b>Settings → MCP</b>.</>],
    action: { label: "Add to Cursor", href: CURSOR_INSTALL } },
  { id: "code", label: "Claude Code", steps: [<>Run this once in your terminal:</>, <code key="c">{CLAUDE_CODE}</code>, <>Any MCP client works the same way: point it at the server URL.</>] },
];
const ASK = [
  "What's in HOODX right now, and how has each vault done since launch?",
  "Why is Boosted ETH at its current leverage, and what ETH price would cut it?",
  "Prepare a 0.05 ETH deposit into Hands-free LP from my wallet 0x…",
  "Backtest NVDA, TSM and AVGO with 25% cash, then draft the launch of my own index.",
];

function RobotFace() {
  return (
    <svg className="llm-robot" viewBox="0 0 48 48" fill="none">
      <path className="llm-robot-antenna" d="M24 12V7M24 7l5-3" />
      <circle className="llm-robot-signal" cx="30" cy="3.5" r="2.5" />
      <rect x="8" y="13" width="32" height="25" rx="9" />
      <path d="M8 24H4M44 24h-4M16 32c5 3 11 3 16 0" />
      <circle className="llm-robot-eye eye-left" cx="18" cy="24" r="2.7" />
      <circle className="llm-robot-eye eye-right" cx="30" cy="24" r="2.7" />
    </svg>
  );
}

function AgentGlyph() {
  return (
    <div className="llm-agent-glyph" aria-hidden="true">
      <span className="llm-agent-core"><RobotFace /></span>
      <span className="llm-agent-orbit orbit-one"><i /></span>
      <span className="llm-agent-orbit orbit-two"><i /></span>
      <span className="llm-agent-packet packet-one">READ</span>
      <span className="llm-agent-packet packet-two">SIM</span>
      <span className="llm-agent-packet packet-three">SIGN</span>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState("");
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied((k) => (k === key ? "" : k)), 1800); } catch { /* clipboard blocked: the text stays selectable */ }
  };
  return { copied, copy };
}

function ConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const [client, setClient] = useState<Client>("claude");
  const { copied, copy } = useCopy();

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const active = CLIENTS.find((c) => c.id === client)!;
  return createPortal(
    <div className="llm-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="llm-terminal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="llm-terminal-bar">
          <span className="llm-terminal-lights" aria-hidden><i /><i /><i /></span>
          <span>hoodx://mcp</span>
          <button type="button" onClick={onClose} aria-label="Close connection panel">×</button>
        </header>
        <div className="llm-terminal-body">
          <div className="llm-terminal-heading">
            <div>
              <p>HOODX FOR AI</p>
              <h2 id={titleId}>Bring HOODX into your AI.</h2>
              <span>Ask Claude, ChatGPT or Cursor about every vault with live on-chain numbers, and have it prepare deposits, withdrawals and curator moves you sign yourself.</span>
            </div>
            <div className="llm-terminal-status"><i /> MCP server · live</div>
          </div>

          <div className="mcp-url">
            <span className="mcp-url-label">Server URL</span>
            <code>{MCP_URL}</code>
            <button type="button" className="llm-copy-button mcp-url-copy" onClick={() => void copy("url", MCP_URL)}>{copied === "url" ? "Copied ✓" : "Copy"}</button>
          </div>

          <div className="mcp-clients">
            <div className="mcp-tabs" role="tablist" aria-label="Your AI app">
              {CLIENTS.map((c) => <button key={c.id} type="button" role="tab" aria-selected={client === c.id} onClick={() => setClient(c.id)}>{c.label}</button>)}
            </div>
            <div className="mcp-steps" role="tabpanel">
              <ol>{active.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <div className="mcp-step-actions">
                {active.id === "code" && <button type="button" className="mcp-ghost" onClick={() => void copy("code", CLAUDE_CODE)}>{copied === "code" ? "Command copied ✓" : "Copy command"}</button>}
                {active.action && <a className="mcp-ghost" href={active.action.href} target={active.action.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{active.action.label} <span aria-hidden>↗</span></a>}
              </div>
            </div>
          </div>

          <div className="mcp-ask">
            <p>Then try asking</p>
            {ASK.map((q, i) => <button key={q} type="button" onClick={() => void copy(`ask${i}`, q)}><span>“{q}”</span><i>{copied === `ask${i}` ? "Copied ✓" : "Copy"}</i></button>)}
          </div>

          <div className="llm-capability-grid">
            <div><strong>Live data</strong><span>Every vault&apos;s value, holdings and return, plus the exact prices behind Boosted ETH&apos;s leverage.</span></div>
            <div><strong>Prepared transactions</strong><span>Deposits and withdrawals simulated from your address, with protection built in.</span></div>
            <div><strong>Curator desk</strong><span>Backtest a basket, launch your own index, and check drift, rebalance or retune the vaults you run.</span></div>
            <div><strong>You sign</strong><span>Your AI can&apos;t move funds. Sign in your wallet or open the review link on HOODX.</span></div>
          </div>

          <p className="llm-safety-note">
            Free to use: your own AI subscription does the thinking. HOODX never asks for keys or seed phrases.
            <span className="mcp-dev-links">
              <a href="/llms.txt" target="_blank" rel="noreferrer">Agent reference</a>
              <button type="button" onClick={() => void copy("prompt", HOODX_AGENT_PROMPT)}>{copied === "prompt" ? "Prompt copied ✓" : "Copy agent prompt"}</button>
            </span>
          </p>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Opens itself once when the page is reached with ?connect=ai (the MCP server's link). */
function useAutoOpen(setOpen: (v: boolean) => void) {
  useEffect(() => {
    const w = window as unknown as { __hoodxConnectOpened?: boolean };
    if (w.__hoodxConnectOpened || new URLSearchParams(window.location.search).get("connect") !== "ai") return;
    w.__hoodxConnectOpened = true;
    setOpen(true);
  }, [setOpen]);
}

export function LlmConnectButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useAutoOpen(setOpen);
  return <><button type="button" className={className} onClick={() => setOpen(true)}>Connect your AI <span aria-hidden>↗</span></button><ConnectionDialog open={open} onClose={() => setOpen(false)} /></>;
}

export function LlmConnectMobileCard() {
  const [open, setOpen] = useState(false);
  useAutoOpen(setOpen);
  return (
    <>
      <button type="button" className="landing-path-card landing-path-agents" data-motion onClick={() => setOpen(true)}>
        <AgentGlyph />
        <p className="landing-path-label">For AI</p>
        <h2 className="landing-path-title">Connect your AI.</h2>
        <p className="landing-path-copy">Use HOODX inside Claude, ChatGPT or Cursor: live vault data and deposits you sign yourself.</p>
        <span className="landing-path-link">Connect <span aria-hidden>→</span></span>
      </button>
      <ConnectionDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
