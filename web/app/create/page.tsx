import { Forge } from "@/components/Forge";
import { Hud } from "@/components/Hud";

export default function CreatePage() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-5 sm:pb-28 sm:pt-16">
        <p className="text-[11px] text-[var(--dim)]">Create</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-[2.4rem] leading-[1.05] sm:text-6xl">
          Mint an index.
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-7 text-[var(--dim)]">
          Your cut lands on every join. HOODX keeps a small protocol fee. Point fees at another
          wallet later without giving up curation.
        </p>
        <div className="mt-10">
          <Forge />
        </div>
      </main>
    </>
  );
}
