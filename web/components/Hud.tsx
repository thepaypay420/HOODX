"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtEth, shortAddr } from "@/lib/format";
import { GEN0_SLUG } from "@/lib/curators";
import { publicClient, useWallet } from "@/lib/wallet";
import { robinhood } from "@/lib/chain";

export function Hud() {
  const { address, chainId, connecting, connect, disconnect, switchToRobinhood } = useWallet();
  const [bal, setBal] = useState<bigint | undefined>();
  const [t, setT] = useState("");
  const on = Boolean(address);
  const wrong = on && chainId !== robinhood.id;

  useEffect(() => {
    const tick = () => setT(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!address) return setBal(undefined);
    publicClient.getBalance({ address }).then(setBal).catch(() => setBal(undefined));
  }, [address]);

  return (
    <header className="relative z-20 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pt-5">
      <Link href="/" className="flex items-center gap-3">
        <span className="pulse-ring grid h-8 w-8 place-items-center rounded-sm border border-[var(--cyan)] font-[family-name:var(--font-mono)] text-[10px] text-[var(--cyan)]">
          696
        </span>
        <span className="font-[family-name:var(--font-hud)] text-lg tracking-[0.28em]">696X</span>
      </Link>
      <nav className="flex items-center gap-4 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--dim)]">
        <span className="hidden sm:inline text-[var(--cyan)]">{t} UTC</span>
        <Link href={`/i/${GEN0_SLUG}`} className="hover:text-[var(--cyan)]">
          Gen-0
        </Link>
        <Link href="/#forge" className="hover:text-[var(--cyan)]">
          Forge
        </Link>
        {!on ? (
          <button
            type="button"
            disabled={connecting}
            onClick={() => void connect().catch(() => {})}
            className="rounded-sm border border-[var(--cyan)] px-3 py-1 text-[var(--cyan)]"
          >
            {connecting ? "Linking…" : "Jack in"}
          </button>
        ) : wrong ? (
          <button type="button" onClick={() => void switchToRobinhood()} className="text-[var(--gold)]">
            Switch chain
          </button>
        ) : (
          <span className="tabular text-[var(--cyan)]">
            {shortAddr(address!)}
            {bal != null ? ` · ${fmtEth(bal, 3)}` : ""}
            <button type="button" className="ml-2 text-[var(--dim)]" onClick={() => disconnect()}>
              out
            </button>
          </span>
        )}
      </nav>
    </header>
  );
}
