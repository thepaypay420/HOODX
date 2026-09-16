import type { ReactNode } from "react";
import Link from "next/link";
import { Forge } from "@/components/Forge";
import { Gallery } from "@/components/Gallery";
import { Hud } from "@/components/Hud";
import { IndexCard } from "@/components/IndexCard";
import { Starfield } from "@/components/Starfield";
import { Ticker } from "@/components/Ticker";
import { GEN0_SLUG } from "@/lib/curators";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS, VAULT } from "@/lib/config";

export default function Home() {
  return (
    <>
      <Starfield />
      <Hud />
      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-28 pt-10">
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.32em] text-[var(--cyan)]">
          MISSION 001 · ROBINHOOD 4663 · DYOR
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl leading-[0.92] sm:text-7xl">
          Don’t pick one coin.
          <br />
          Launch a basket.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-[#c5e8f4]">
          Build your own meme index. Share it. Earn a cut when friends ape in.{" "}
          <span className="text-[var(--cyan)]">$696X</span> is Gen-0 — the{" "}
          <a
            className="underline decoration-[var(--cyan)]/50"
            href="https://x.com/696_eth/status/2100067116594725086"
            target="_blank"
            rel="noreferrer"
          >
            @696_eth
          </a>{" "}
          RH watchlist, one bag.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/i/${GEN0_SLUG}`} className="ape rounded-sm px-6 py-3 text-sm">
            Ape $696X
          </Link>
          <Link href="#forge" className="ghost rounded-sm px-6 py-3">
            Forge your pack
          </Link>
        </div>

        <Ticker />

        <section className="mt-12">
          <IndexCard slug={GEN0_SLUG} vault={VAULT || undefined} />
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          <Step n="01" title="Lock a pack">
            2–24 RH names. ETH in, one token out. We do not 17-swap your friends.
          </Step>
          <Step n="02" title="Drop the link">
            Share /i/yourslug. They ape ETH. You keep the book from going dust.
          </Step>
          <Step n="03" title="Earn on volume">
            {(CREATOR_FEE_BPS / 100).toFixed(2)}% to you, {(PROTOCOL_FEE_BPS / 100).toFixed(2)}%
            protocol. Redeem is free. Tail under $10 stays ETH. Switch the payout wallet anytime.
          </Step>
        </section>

        <div className="mt-14">
          <Forge />
        </div>

        <Gallery />

        <p className="mt-16 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--dim)]">
          HOODX on Robinhood Chain 4663. Not HOOD10. Not financial advice. DYOR. Look-only until
          the factory is live.
        </p>
      </main>
    </>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="holo rounded-xl px-4 py-4">
      <p className="relative z-10 font-[family-name:var(--font-mono)] text-[11px] text-[var(--cyan)]">{n}</p>
      <h2 className="relative z-10 mt-1 font-[family-name:var(--font-hud)] text-xl tracking-wider">{title}</h2>
      <p className="relative z-10 mt-1 text-sm leading-snug text-[var(--dim)]">{children}</p>
    </div>
  );
}
