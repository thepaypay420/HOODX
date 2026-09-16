"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GitHubMark } from "@/components/GitHubMark";
import { fmtEth, shortAddr } from "@/lib/format";
import { GEN0_SLUG } from "@/lib/curators";
import { GITHUB_REPO } from "@/lib/config";
import { publicClient, useWallet } from "@/lib/wallet";
import { robinhood } from "@/lib/chain";

export function Hud() {
  const { address, chainId, connecting, connect, disconnect, switchToRobinhood } = useWallet();
  const [bal, setBal] = useState<bigint | undefined>();
  const [hint, setHint] = useState("");
  const on = Boolean(address);
  const wrong = on && chainId !== robinhood.id;

  useEffect(() => {
    if (!address) return setBal(undefined);
    publicClient.getBalance({ address }).then(setBal).catch(() => setBal(undefined));
  }, [address]);

  return (
    <header className="relative z-20 mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 pt-6 pb-[env(safe-area-inset-top)]">
      <Link href="/" className="font-[family-name:var(--font-display)] text-[1.65rem] leading-none tracking-[0.12em]">
        HOODX
      </Link>
      <nav className="flex flex-wrap items-center gap-1 font-[family-name:var(--font-ui)] text-[13px] text-[var(--dim)] sm:gap-2">
        <Link href={`/i/${GEN0_SLUG}`} className="inline-flex min-h-11 items-center px-2 hover:text-[var(--paper)]">
          696X
        </Link>
        <Link href="/#create" className="inline-flex min-h-11 items-center px-2 hover:text-[var(--paper)]">
          Create
        </Link>
        <a
          href={GITHUB_REPO}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 px-2 hover:text-[var(--paper)]"
        >
          <GitHubMark />
          <span className="hidden sm:inline">GitHub</span>
        </a>
        {!on ? (
          <button
            type="button"
            disabled={connecting}
            onClick={() =>
              void connect().catch((e) => {
                setHint(
                  e instanceof Error && e.message === "OPEN_IN_WALLET"
                    ? "Browse freely. Open this in a wallet app to mint."
                    : "Wallet closed — you can still browse.",
                );
              })
            }
            className="min-h-11 rounded-sm border border-[var(--line)] px-3 text-[var(--paper)]"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        ) : wrong ? (
          <button type="button" onClick={() => void switchToRobinhood()} className="min-h-11 px-2 text-[var(--gold)]">
            Switch chain
          </button>
        ) : (
          <span className="tabular px-2 text-[var(--paper)]">
            {shortAddr(address!)}
            {bal != null ? ` · ${fmtEth(bal, 3)}` : ""}
            <button type="button" className="ml-2 min-h-11 text-[var(--dim)]" onClick={() => disconnect()}>
              out
            </button>
          </span>
        )}
      </nav>
      {hint && (
        <p className="w-full font-[family-name:var(--font-mono)] text-[10px] text-[var(--gold)]">{hint}</p>
      )}
    </header>
  );
}
