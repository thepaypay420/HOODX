import { Hud } from "@/components/Hud";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-3xl px-5 py-24 text-center">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-[var(--dim)]">
          Not found
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl">404</h1>
        <p className="mt-4 text-[var(--dim)]">That index is not on HOODX.</p>
        <Link href="/" className="ape mt-8 inline-block rounded-sm px-6 py-3 text-sm">
          Back to HOODX
        </Link>
      </main>
    </>
  );
}
