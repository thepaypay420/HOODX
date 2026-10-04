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
          <LiveIndexes />
          <Gallery />

          <p className="mt-16 border-t border-[var(--line)] pt-8 text-[13px] leading-6 text-[var(--dim)]">
            V2 pricing uses a 30-minute V3 TWAP. Protected sales can revert when market prices move; direct asset redemption remains available. Not financial advice. DYOR.
          </p>
        </div>
      </main>
    </>
  );
}
