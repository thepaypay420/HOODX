import { Hud } from "@/components/Hud";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <Hud />
      <main className="relative z-10 mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-24">
        <p className="text-[13px] text-[var(--dim)]">Not found</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-[-0.05em]">404</h1>
        <p className="mt-4 text-[15px] text-[var(--dim)]">That index is not on HOODX.</p>
        <Link href="/" className="ape mt-8 inline-flex px-6 text-sm">
          Back
        </Link>
      </main>
    </>
  );
}
