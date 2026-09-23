import { Forge } from "@/components/Forge";
import { Hud } from "@/components/Hud";

export default function CreatePage() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pb-28 sm:pt-14">
        <p className="text-[13px] text-[var(--dim)]">Create</p>
        <h1 className="mt-2 text-[2.2rem] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
          Turn your watchlist into an index.
        </h1>
        <p className="mt-3 max-w-md text-[16px] leading-7 text-[var(--dim)]">
          Choose your assets, give your basket an identity and manage it from your curator workspace. Start with an idea; review every step before it goes on-chain.
        </p>
        <div className="curator-guide mt-8"><article><b>1 · Choose your basket</b><p>Pick 2–24 assets with approved routes, then set each launch weight and the WETH reserve.</p></article><article><b>2 · Make it yours</b><p>Name your index, choose a ticker and set your creator fee. Your public vault page is built for sharing.</p></article><article><b>3 · Launch & manage</b><p>Creation includes a 0.02 ETH first deposit, plus network fees. Review the complete allocation before signing.</p></article></div>
        <div className="mt-8">
          <Forge />
        </div>
      </main>
    </>
  );
}
