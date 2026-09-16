import type { ReactNode } from "react";
import Link from "next/link";
import { FeaturedIndex } from "@/components/FeaturedIndex";
import { Forge } from "@/components/Forge";
import { Gallery } from "@/components/Gallery";
import { Hud } from "@/components/Hud";
import { Ticker } from "@/components/Ticker";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS } from "@/lib/config";

export default function Home() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-28 pt-16">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-[var(--dim)]">
          Robinhood Chain · 4663
        </p>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-[3.4rem] leading-[0.95] sm:text-7xl">
          Build a meme index.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--dim)]">
          HOODX is a factory for baskets. Pick the names, mint one token, share the link. You earn a
          cut when people join.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="#create" className="ape rounded-sm px-6 py-3 text-sm">
            Create an index
          </Link>
          <Link href="#how" className="ghost rounded-sm px-6 py-3">
            How it works
          </Link>
        </div>

        <Ticker />

        <section id="how" className="mt-16 grid gap-8 sm:grid-cols-3">
          <Step n="01" title="Compose">
            Two to twenty-four names on Robinhood Chain. Friends send ETH and receive one token — not
            a bag of dust.
          </Step>
          <Step n="02" title="Share">
            Every index lives at /i/yourslug. Drop the link. They join; you keep the book from going
            thin.
          </Step>
          <Step n="03" title="Earn">
            {(CREATOR_FEE_BPS / 100).toFixed(2)}% to the creator, {(PROTOCOL_FEE_BPS / 100).toFixed(2)}%
            to HOODX, on every mint. Redeem is free. Change the payout wallet anytime.
          </Step>
        </section>

        <FeaturedIndex />

        <div className="mt-16">
          <Forge />
        </div>

        <Gallery />

        <p className="mt-20 text-sm leading-relaxed text-[var(--dim)]">
          HOODX on Robinhood Chain 4663. Not HOOD10. Not financial advice. DYOR. Look-only until the
          factory is live.
        </p>
      </main>
    </>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--dim)]">{n}</p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">{children}</p>
    </div>
  );
}
