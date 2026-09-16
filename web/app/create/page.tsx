import { Forge } from "@/components/Forge";
import { Hud } from "@/components/Hud";

export default function CreatePage() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-28 pt-16">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-[var(--dim)]">
          Create
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl sm:text-6xl">
          Mint an index.
        </h1>
        <p className="mt-4 max-w-xl text-[var(--dim)]">
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
