import Link from "next/link";
import { Forge } from "@/components/Forge";
import { Gallery } from "@/components/Gallery";
import { HomeLanding } from "@/components/HomeLanding";
import { Hud } from "@/components/Hud";
import { LiveIndexes } from "@/components/LiveIndexes";

export default function Home() {
  return (
    <>
      <Hud landing />
      <main className="relative z-10">
        <HomeLanding />

        <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <section id="explore" className="scroll-mt-24 border-t border-[var(--line)] pt-12 sm:pt-16">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] text-[var(--dim)]">Live indexes</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Explore the book</h2>
              </div>
              <Link href="/explore" className="ghost px-4 text-[13px]">
                Explore vaults →
              </Link>
            </div>
            <LiveIndexes />
            <Gallery />
          </section>

          <section id="create" className="scroll-mt-24 border-t border-[var(--line)] pt-12 sm:pt-16">
            <Forge />
          </section>

          <p className="mt-16 border-t border-[var(--line)] pt-8 text-[13px] leading-6 text-[var(--dim)]">
            V2 pricing uses a 30-minute V3 TWAP. Protected sales can revert when market prices move; direct asset redemption remains available. Not financial advice. DYOR.
          </p>
        </div>
      </main>
    </>
  );
}
