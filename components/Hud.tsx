"use client";

import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { Socials } from "@/components/Socials";
import { TokenArt } from "@/components/TokenArt";
import { GEN0_SLUG } from "@/lib/curators";
import { shortAddr } from "@/lib/format";
import { robinhood } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { useState } from "react";

export function Hud() {
  const { address, chainId, connecting, connect, disconnect, switchToRobinhood } = useWallet();
  const [hint, setHint] = useState("");
  const on = Boolean(address);
  const wrong = on && chainId !== robinhood.id;

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--void)]/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <BrandMark size={34} priority />
          <span className="text-[17px] font-semibold tracking-[-0.04em]">HOODX</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 text-[13px] text-[var(--dim)]">
          <Link
            href={`/i/${GEN0_SLUG}`}
            data-testid="nav-696x"
            className="inline-flex h-11 items-center gap-1.5 rounded-full px-2.5 hover:text-[var(--paper)]"
          >
            <TokenArt slug={GEN0_SLUG} size="xs" alt="696X" />
            <span className="hidden xs:inline sm:inline">696X</span>
          </Link>
          <Link
            href="/#create"
            data-testid="nav-create"
            className="inline-flex h-11 items-center rounded-full px-2.5 hover:text-[var(--paper)]"
          >
            Create
          </Link>
          <span className="hidden sm:flex">
            <Socials />
          </span>
          {!on ? (
            <button
              type="button"
              data-testid="wallet-connect"
              disabled={connecting}
              onClick={() =>
                void connect().catch((e) => {
                  setHint(
                    e instanceof Error && e.message === "OPEN_IN_WALLET"
                      ? "Open this in a wallet to mint."
                      : "Wallet closed.",
                  );
                })
              }
              className="ape compact ml-1 shrink-0 text-[13px]"
            >
              {connecting ? "…" : "Connect"}
            </button>
          ) : wrong ? (
            <button
              type="button"
              data-testid="wallet-switch"
              onClick={() => void switchToRobinhood()}
              className="ml-1 h-11 shrink-0 px-2 text-[var(--gold)]"
            >
              Switch
            </button>
          ) : (
            <span
              data-testid="wallet-addr"
              className="ml-1 inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-[var(--line)] px-3 tabular text-[var(--paper)]"
            >
              {shortAddr(address!)}
              <button
                type="button"
                data-testid="wallet-out"
                className="text-[var(--dim)]"
                onClick={() => disconnect()}
              >
                out
              </button>
            </span>
          )}
        </nav>
      </div>
      {hint && (
        <p className="mx-auto max-w-5xl px-4 pb-3 text-[12px] text-[var(--gold)] sm:px-6">{hint}</p>
      )}
    </header>
  );
}
