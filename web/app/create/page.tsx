import { Forge } from "@/components/Forge";
import { Hud } from "@/components/Hud";
import { Starfield } from "@/components/Starfield";

export default function CreatePage() {
  return (
    <>
      <Starfield />
      <Hud />
      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-28 pt-10">
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.32em] text-[var(--mag)]">
          FORGE BAY · DON’T PICK ONE COIN
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl sm:text-6xl">
          Mint a pack. Drop the link.
        </h1>
        <p className="mt-4 max-w-xl text-[var(--dim)]">
          Your cut lands on every ape-in. Protocol keeps a slice. Point fees at another wallet later
          without giving up curation.
        </p>
        <div className="mt-8">
          <Forge />
        </div>
      </main>
    </>
  );
}
