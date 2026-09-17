import type { ReactNode } from "react";
import Link from "next/link";
import { FeaturedIndex } from "@/components/FeaturedIndex";
import { Forge } from "@/components/Forge";
import { Gallery } from "@/components/Gallery";
import { Hud } from "@/components/Hud";
import { LiveIndexes } from "@/components/LiveIndexes";
import { Ticker } from "@/components/Ticker";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS } from "@/lib/config";

export default function Home() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pb-28 sm:pt-16">
        <p className="text-[13px] text-[var(--dim)]">Robinhood Chain</p>
        <h1 className="mt-3 max-w-[11ch] text-[2.7rem] font-semibold leading-[0.98] tracking-[-0.05em] sm:max-w-none sm:text-6xl">
          One token. A whole book.
        </h1>
        <p className="mt-4 max-w-md text-[16px] leading-7 text-[var(--dim)] sm:text-[17px]">
          Pick RH names, mint an index, share /i/yourslug. Join buys the basket. Leave sells your
          slice to ETH. Redeem is free.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={`/i/696x`} className="ape w-full px-6 text-[15px] sm:w-auto">
            Open 696X
          </Link>
          <Link href="#create" className="ghost w-full px-6 sm:w-auto">
            Create yours
          </Link>
        </div>

        <Ticker />
        <FeaturedIndex />

        <section id="how" className="mt-16 grid gap-8 sm:grid-cols-3">
          <Step n="01" title="Compose">
            2–24 Uni V3 or V4 names. Friends send ETH and get one token.
          </Step>
          <Step n="02" title="Share">
            Every index lives at /i/yourslug. You keep the book from going thin.
          </Step>
          <Step n="03" title="Earn">
            {(CREATOR_FEE_BPS / 100).toFixed(2)}% to you, {(PROTOCOL_FEE_BPS / 100).toFixed(2)}% to
            HOODX, on every join. Redeem cannot be paused.
          </Step>
        </section>

        <div className="mt-16">
          <Forge />
        </div>

        <Gallery />
        <LiveIndexes />

        <p className="mt-16 text-[13px] leading-6 text-[var(--dim)]">
          NAV is Uni V3 TWAP or V4 spot. 3% max slip per swap. Not HOOD10. DYOR.
        </p>
      </main>
    </>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="rise">
      <p className="text-[12px] text-[var(--dim)]">{n}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="mt-2 text-[15px] leading-6 text-[var(--dim)]">{children}</p>
    </div>
  );
}
