import { Hud } from "@/components/Hud";
import { Starfield } from "@/components/Starfield";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <Starfield />
      <Hud />
      <main className="relative z-10 mx-auto max-w-3xl px-5 py-24 text-center">
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.32em] text-[var(--danger)]">
          SIGNAL LOST
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl">404</h1>
        <p className="mt-4 text-[var(--dim)]">That pack is not on this frequency.</p>
        <Link href="/" className="ape mt-8 inline-block rounded-sm px-6 py-3 text-sm">
          Return to Gen-0
        </Link>
      </main>
    </>
  );
}
