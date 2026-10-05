"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { Card } from "@/lib/agent/types";
import { robinhood } from "@/lib/chain";
import { EXPLORER } from "@/lib/config";
import { publicClient, useWallet } from "@/lib/wallet";

const usd = (v: number | null) => (v === null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const price = (v: number | null) => (v === null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function Check() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12l5 5 9-10" /></svg>;
}

/** A prepared transaction. Everything on it was decoded from the transaction itself; "Review & sign" opens the wallet. */
function Proposal({ card, onAsk }: { card: Extract<Card, { type: "proposal" }>; onAsk: (q: string) => void }) {
  const { address, chainId, walletClient, connect, switchToRobinhood } = useWallet();
  const [state, setState] = useState<"idle" | "signing" | "pending" | "done" | "failed">("idle");
  const [hash, setHash] = useState<string>();
  const [err, setErr] = useState("");
  const expired = Date.now() > Date.parse(card.expiresAt);
  const sameWallet = address && address.toLowerCase() === card.tx.from.toLowerCase();

  const sign = async () => {
    setErr("");
    if (!address || !walletClient) { await connect(); return; }
    if (!sameWallet) { setErr("Your wallet changed since this was prepared. Ask again to refresh it."); return; }
    if (chainId !== robinhood.id) { await switchToRobinhood(); return; }
    try {
      setState("signing");
      const h = await walletClient.sendTransaction({ account: address as Address, to: card.tx.to, data: card.tx.data, value: BigInt(card.tx.value), chain: robinhood });
      setHash(h); setState("pending");
      const r = await publicClient.waitForTransactionReceipt({ hash: h });
      setState(r.status === "success" ? "done" : "failed");
      if (r.status !== "success") setErr("The transaction reverted on-chain. Nothing was taken except gas.");
    } catch (e) {
      setState("idle");
      const m = e instanceof Error ? e.message : "";
      setErr(/reject|denied|cancel/i.test(m) ? "Cancelled in your wallet." : "Your wallet couldn't send it. Try again, or use the vault page.");
    }
  };

  return (
    <div className="agent-card agent-proposal">
      <div className="agent-proposal-top">
        <span className="agent-eyebrow">{card.action === "deposit" ? "Deposit" : "Withdrawal"}</span>
        <span className="agent-badge"><Check />Simulated</span>
      </div>
      <p className="agent-proposal-head">{card.headline}</p>
      <dl className="agent-rows">
        {card.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {card.protection && <p className="agent-fine">{card.protection}</p>}
      {state === "done" ? (
        <a className="agent-done" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer"><Check />Confirmed · view transaction ↗</a>
      ) : expired ? (
        <button type="button" className="agent-btn agent-btn-ghost" onClick={() => onAsk("Please prepare that again, the quote expired.")}>Quote expired · refresh</button>
      ) : (
        <div className="agent-actions">
          <a className="agent-btn agent-btn-ghost" href={card.reviewUrl}>Open page</a>
          <button type="button" className="agent-btn agent-btn-primary" onClick={sign} disabled={state === "signing" || state === "pending"}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            {state === "signing" ? "Confirm in wallet…" : state === "pending" ? "Confirming…" : !address ? "Connect to sign" : chainId !== robinhood.id ? "Switch network" : "Review & sign"}
          </button>
        </div>
      )}
      {hash && state === "pending" && <a className="agent-fine" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">Sent · view on explorer ↗</a>}
      {err && <p className="agent-err" role="alert">{err}</p>}
      <p className="agent-fine">Opens your wallet. HOODX never holds your keys.</p>
    </div>
  );
}

function Signal({ card }: { card: Extract<Card, { type: "signal" }> }) {
  const lights = (row: boolean[]) => <span className="agent-lights">{row.map((on, i) => <i key={i} className={`${on ? "on" : ""} ${i < 4 ? "slow" : "fast"}`} />)}</span>;
  return (
    <div className="agent-card">
      <div className="agent-signal-head"><span className="agent-lev">{card.target % 1 ? String(+card.target.toFixed(3)) : card.target.toFixed(1)}×</span><span className="agent-fine">target · ETH {price(card.ethPrice)}</span></div>
      <div className="agent-light-row"><b>ETH</b>{lights(card.eth)}</div>
      <div className="agent-light-row"><b>BTC</b>{lights(card.btc)}</div>
      <p className="agent-fine">Slow trends · fast trends · {[...card.eth, ...card.btc].filter(Boolean).length} of 16 on</p>
      <div className="agent-thresholds">
        {card.fullAbove !== null && <div className="up"><span>Full 2.0× above</span><b>{price(card.fullAbove)}</b></div>}
        {card.firstStepBelow !== null && <div className="mid"><span>First step down below</span><b>{price(card.firstStepBelow)}</b></div>}
        {card.asideBelowEth !== null && <div className="down"><span>Fully aside once ETH is below</span><b>{price(card.asideBelowEth)}</b></div>}
      </div>
    </div>
  );
}

export function AgentCard({ card, onAsk }: { card: Card; onAsk: (q: string) => void }) {
  switch (card.type) {
    case "proposal": return <Proposal card={card} onAsk={onAsk} />;
    case "signal": return <Signal card={card} />;
    case "clarify":
      return card.options.length ? <div className="agent-chips">{card.options.map((o) => <button key={o} type="button" onClick={() => onAsk(o)}>{o}</button>)}</div> : null;
    case "positions":
      return (
        <div className="agent-card">
          <div className="agent-eyebrow">Your vaults</div>
          <p className="agent-total">{usd(card.totalUsd)}</p>
          <dl className="agent-rows">
            {card.rows.length ? card.rows.map((r) => <div key={r.slug}><dt>{r.name}</dt><dd>{usd(r.valueUsd)}</dd></div>) : <div><dt>No positions yet</dt><dd /></div>}
            <div><dt>ETH in wallet</dt><dd>{card.walletEth} ETH</dd></div>
          </dl>
        </div>
      );
    case "vault":
      return (
        <a className="agent-card agent-vault" href={card.url}>
          <span><b>{card.name}</b> <span className="agent-fine">${card.ticker}</span></span>
          <span className="agent-vault-nums">{card.valueUsd !== null && <span>{usd(card.valueUsd)}</span>}{card.sinceLaunchPct !== null && <span className={card.sinceLaunchPct >= 0 ? "up" : "down"}>{card.sinceLaunchPct >= 0 ? "+" : ""}{card.sinceLaunchPct.toFixed(2)}% since launch</span>}</span>
          <span className="agent-fine">{card.summary}</span>
        </a>
      );
    case "notice":
      return <div className={`agent-card agent-notice ${card.tone}`}><span>{card.text}</span>{card.link && <a href={card.link.href} target="_blank" rel="noreferrer">{card.link.label} ↗</a>}</div>;
    default: return null;
  }
}
