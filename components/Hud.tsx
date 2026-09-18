"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Socials } from "@/components/Socials";
import { GEN0_SLUG } from "@/lib/curators";
import { shortAddr } from "@/lib/format";
import { robinhood } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";

export function Hud({ landing = false }: { landing?: boolean }) {
  const { address, chainId, connecting, connect, disconnect, switchToRobinhood } = useWallet();
  const [hint, setHint] = useState("");
  const [open, setOpen] = useState(false);
  const on = Boolean(address);
  const wrong = on && chainId !== robinhood.id;

  async function onConnect() {
    try {
      await connect();
      setOpen(false);
    } catch (e) {
      setHint(
        e instanceof Error && e.message === "OPEN_IN_WALLET"
          ? "Open this in a wallet to mint."
          : "Wallet closed.",
      );
    }
  }

  const connectBtn = !on ? (
    <button
      type="button"
      data-testid="wallet-connect"
      disabled={connecting}
      onClick={() => void onConnect()}
      className={landing ? "landing-nav-connect" : "ape compact ml-1 shrink-0 text-[13px]"}
    >
      {connecting ? "…" : "Connect"}
    </button>
  ) : wrong ? (
    <button
      type="button"
      data-testid="wallet-switch"
      onClick={() => void switchToRobinhood()}
      className={landing ? "landing-nav-connect landing-nav-connect-warn" : "ml-1 h-11 shrink-0 px-2 text-[var(--gold)]"}
    >
      Switch
    </button>
  ) : (
    <span
      data-testid="wallet-addr"
      className={
        landing
          ? "landing-nav-wallet"
          : "ml-1 inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-[var(--line)] px-3 tabular text-[var(--paper)]"
      }
    >
      {shortAddr(address!)}
      <button type="button" data-testid="wallet-out" className="text-[var(--dim)]" onClick={() => disconnect()}>
        out
      </button>
    </span>
  );

  const navLinks = (
    <>
      <Link
        href={landing ? `#explore` : `/i/${GEN0_SLUG}`}
        data-testid="nav-explore"
        className="landing-nav-link"
        onClick={() => setOpen(false)}
      >
        Explore
      </Link>
      <Link href={landing ? "#create" : "/#create"} data-testid="nav-create" className="landing-nav-link" onClick={() => setOpen(false)}>
        Create
      </Link>
    </>
  );

  return (
    <header className={landing ? "landing-header" : "sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--void)]/75 backdrop-blur-xl"}>
      <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-3 sm:px-6 ${landing ? "max-w-6xl" : "max-w-5xl py-2.5"}`}>
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <BrandMark size={landing ? 38 : 34} priority />
          <span className="text-[18px] font-semibold tracking-[-0.04em] sm:text-[19px]">HOODX</span>
        </Link>

        {landing ? (
          <>
            <nav className="hidden items-center gap-1 md:flex">{navLinks}</nav>
            <div className="hidden items-center gap-2 md:flex">
              <span className="hidden lg:flex">
                <Socials />
              </span>
              {connectBtn}
            </div>
            <div className="flex items-center gap-2 md:hidden">
              {connectBtn}
              <button
                type="button"
                aria-expanded={open}
                aria-label="Menu"
                className="landing-nav-menu"
                onClick={() => setOpen((v) => !v)}
              >
                <span />
                <span />
                <span />
              </button>
            </div>
          </>
        ) : (
          <nav className="flex min-w-0 items-center gap-0.5 text-[13px] text-[var(--dim)]">
            <Link
              href={`/i/${GEN0_SLUG}`}
              data-testid="nav-696x"
              className="inline-flex h-11 items-center rounded-full px-2.5 hover:text-[var(--paper)]"
            >
              696X
            </Link>
            <Link href="/#create" data-testid="nav-create" className="inline-flex h-11 items-center rounded-full px-2.5 hover:text-[var(--paper)]">
              Create
            </Link>
            <span className="hidden sm:flex">
              <Socials />
            </span>
            {connectBtn}
          </nav>
        )}
      </div>

      {landing && open && (
        <div className="landing-mobile-menu md:hidden">
          {navLinks}
          <Link href={`/i/${GEN0_SLUG}`} className="landing-nav-link" onClick={() => setOpen(false)}>
            696X
          </Link>
          <Socials />
        </div>
      )}

      {hint && (
        <p className={`mx-auto px-4 pb-3 text-[12px] text-[var(--gold)] sm:px-6 ${landing ? "max-w-6xl" : "max-w-5xl"}`}>
          {hint}
        </p>
      )}
    </header>
  );
}
