import { Hud } from "@/components/Hud";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-3xl px-4 py-20 text-center sm:px-5 sm:py-24">
        <p className="text-[11px] text-[var(--dim)]">Not found</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl">404</h1>
        <p className="mt-4 text-[15px] leading-6 text-[var(--dim)]">That index is not on HOODX.</p>
        <Link href="/" className="ape mt-8 inline-flex rounded-sm px-6 py-3 text-sm">
          Back to HOODX
        </Link>
      </main>
    </>
  );
}
