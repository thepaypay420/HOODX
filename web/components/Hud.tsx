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
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--void)]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
        <Link
          href="/"
          className="shrink-0 font-[family-name:var(--font-display)] text-[1.45rem] leading-none tracking-[0.14em] sm:text-[1.65rem]"
        >
          HOODX
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 text-[13px] text-[var(--dim)] sm:gap-1">
          <Link
            href={`/i/${GEN0_SLUG}`}
            className="inline-flex h-11 items-center px-2 hover:text-[var(--paper)]"
          >
            696X
          </Link>
          <Link href="/#create" className="inline-flex h-11 items-center px-2 hover:text-[var(--paper)]">
            Create
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 w-11 items-center justify-center hover:text-[var(--paper)] sm:w-auto sm:gap-1.5 sm:px-2"
            aria-label="GitHub"
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
              className="ml-1 h-11 shrink-0 rounded-sm border border-[var(--line)] px-3 text-[var(--paper)]"
            >
              {connecting ? "…" : "Connect"}
            </button>
          ) : wrong ? (
            <button
              type="button"
              onClick={() => void switchToRobinhood()}
              className="ml-1 h-11 shrink-0 px-2 text-[var(--gold)]"
            >
              Switch
            </button>
          ) : (
            <span className="ml-1 inline-flex h-11 shrink-0 items-center tabular text-[var(--paper)]">
              {shortAddr(address!)}
              <button type="button" className="ml-2 text-[var(--dim)]" onClick={() => disconnect()}>
                out
              </button>
            </span>
          )}
        </nav>
      </div>
      {hint && (
        <p className="mx-auto max-w-5xl px-4 pb-3 font-[family-name:var(--font-mono)] text-[11px] leading-5 text-[var(--gold)] sm:px-5">
          {hint}
        </p>
      )}
    </header>
  );
}
