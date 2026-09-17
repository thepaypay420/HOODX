import { Forge } from "@/components/Forge";
import { Hud } from "@/components/Hud";

export default function CreatePage() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pb-28 sm:pt-14">
        <p className="text-[13px] text-[var(--dim)]">Create</p>
        <h1 className="mt-2 text-[2.2rem] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
          Mint an index.
        </h1>
        <p className="mt-3 max-w-md text-[16px] leading-7 text-[var(--dim)]">
          Your cut lands on every join. Point fees at another wallet later.
        </p>
        <div className="mt-8">
          <Forge />
        </div>
      </main>
    </>
  );
}
