import Link from "next/link";
import { ExploreConstellation } from "@/components/ExploreConstellation";
import { Hud } from "@/components/Hud";
import { LiveIndexes } from "@/components/LiveIndexes";

export const metadata = {
  title: "Explore vaults",
  description: "Browse live HOODX index vaults on Robinhood Chain.",
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const fromHome = from === "home";

  return (
    <>
      <Hud />
      <main className="relative z-10">
        <section className="explore-hero mx-auto max-w-6xl px-4 pb-6 pt-6 sm:px-6 sm:pb-10 sm:pt-10">
          <div className="explore-hero-grid">
            <div className="explore-hero-copy rise">
              <p className="landing-eyebrow">Live vaults</p>
              <h1 className="landing-headline text-[clamp(2rem,6vw,3.25rem)]">Explore indexes</h1>
              <p className="landing-lede">
                Each orb is a live on-chain basket. Tap a vault to open the desk — allocations, NAV, and join/exit are
                all on Robinhood Chain.
              </p>
              <div className="landing-cta-row">
                <Link href="/#create" className="landing-btn-secondary">
                  Create an index
                </Link>
              </div>
            </div>
            <ExploreConstellation fromHome={fromHome} />
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
          <section className="border-t border-[var(--line)] pt-10 sm:pt-12">
            <div className="mb-6">
              <p className="text-[13px] text-[var(--dim)]">Factory</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">All live indexes</h2>
            </div>
            <LiveIndexes />
          </section>
        </div>
      </main>
    </>
  );
}
