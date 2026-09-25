"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { HOODX_AGENT_PROMPT, HOODX_AGENT_REFERENCE } from "@/lib/llmConnect";

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

function ConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);

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

  async function copyPrompt() {
    await navigator.clipboard.writeText(HOODX_AGENT_PROMPT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!open) return null;
  return createPortal(
    <div className="llm-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="llm-terminal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="llm-terminal-bar">
          <span className="llm-terminal-lights" aria-hidden><i /><i /><i /></span>
          <span>hoodx://agent-link</span>
          <button type="button" onClick={onClose} aria-label="Close connection panel">×</button>
        </header>
        <div className="llm-terminal-body">
          <div className="llm-terminal-heading">
            <div>
              <p>AGENT CONNECTION KIT</p>
              <h2 id={titleId}>Give your AI the full interface.</h2>
              <span>Connect your Claude, Codex, Cursor, or any EVM-capable agent.</span>
            </div>
            <div className="llm-terminal-status"><i /> Robinhood Chain · 4663</div>
          </div>

          <div className="llm-command-preview" aria-label="Connection sequence">
            <p><b>$</b> fetch <span>{HOODX_AGENT_REFERENCE}</span></p>
            <p><b>✓</b> discover vault + accounting mode</p>
            <p><b>✓</b> quote → protect → simulate</p>
            <p><b>›</b> your wallet signs the final transaction</p>
          </div>

          <div className="llm-capability-grid">
            <div><strong>Hold</strong><span>Read, join, withdraw, redeem and claim.</span></div>
            <div><strong>Curate</strong><span>Weights, routes, pause, unwind and atomic rebalances.</span></div>
            <div><strong>Launch</strong><span>Create a 2–24 asset index with one factory call.</span></div>
          </div>

          <div className="llm-terminal-actions">
            <button type="button" className="llm-copy-button" onClick={() => void copyPrompt()}>
              {copied ? "Prompt copied ✓" : "Copy connection prompt"}<span aria-hidden>↗</span>
            </button>
            <a href="/llms.txt" target="_blank" rel="noreferrer">View every command <span aria-hidden>→</span></a>
          </div>
          <p className="llm-safety-note">Read and simulation are automatic. You review every write and sign with your own wallet. HOODX never asks for private keys.</p>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function LlmConnectButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className} onClick={() => setOpen(true)}>Connect your AI <span aria-hidden>↗</span></button><ConnectionDialog open={open} onClose={() => setOpen(false)} /></>;
}

export function LlmConnectMobileCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="landing-path-card landing-path-agents" data-motion onClick={() => setOpen(true)}>
        <AgentGlyph />
        <p className="landing-path-label">For agents</p>
        <h2 className="landing-path-title">Connect your AI.</h2>
        <p className="landing-path-copy">Claude, Codex, Cursor and more. Every vault command, ready to use.</p>
        <span className="landing-path-link">Connect agent <span aria-hidden>→</span></span>
      </button>
      <ConnectionDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
