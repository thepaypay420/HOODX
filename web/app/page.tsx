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
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-5 sm:pb-28 sm:pt-16">
        <p className="text-[11px] text-[var(--dim)]">Robinhood Chain · 4663</p>
        <h1 className="mt-3 max-w-[12ch] font-[family-name:var(--font-display)] text-[2.6rem] leading-[1.05] sm:mt-5 sm:max-w-none sm:text-7xl sm:leading-[0.95]">
          Build a meme index.
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-7 text-[var(--dim)] sm:mt-5 sm:text-lg sm:leading-relaxed">
          HOODX is a factory for baskets. Pick the names, mint one token, share the link. You earn a
          cut when people join.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:flex-wrap">
          <Link href="#create" className="ape w-full rounded-sm px-6 py-3 text-sm sm:w-auto">
            Create an index
          </Link>
          <Link href="#how" className="ghost flex w-full items-center justify-center rounded-sm px-6 py-3 sm:w-auto">
            How it works
          </Link>
        </div>

        <Ticker />

        <section id="how" className="mt-14 grid gap-8 sm:mt-16 sm:grid-cols-3">
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
      <p className="mt-2 text-[15px] leading-6 text-[var(--dim)]">{children}</p>
    </div>
  );
}
