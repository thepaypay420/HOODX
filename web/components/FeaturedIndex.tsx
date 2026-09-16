import Image from "next/image";
import Link from "next/link";
import { byAddress } from "@/lib/catalog";
import { CURATOR_696, GEN0_SLUG, GEN0_SYMBOL } from "@/lib/curators";
import { defaultPack } from "@/lib/packs";

export function FeaturedIndex() {
  const lineup = defaultPack()
    .map((t) => byAddress(t))
    .filter(Boolean)
    .map((c) => c!.symbol);

  return (
    <section className="mt-24">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--dim)]">First index</p>
      <Link
        href={`/i/${GEN0_SLUG}`}
        className="holo mt-4 flex flex-col gap-6 rounded-xl p-5 transition-colors hover:border-[rgba(196,165,116,0.4)] sm:flex-row sm:items-center sm:p-6"
      >
        <span className="relative block h-20 w-20 shrink-0 overflow-hidden rounded-full border border-[var(--line)]">
          <Image
            src={CURATOR_696.avatar}
            alt={`@${CURATOR_696.handle}`}
            width={400}
            height={400}
            priority
            className="h-full w-full object-cover"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-wide sm:text-4xl">
            ${GEN0_SYMBOL}
          </h2>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Curated by{" "}
            <span className="text-[var(--paper)]">@{CURATOR_696.handle}</span>
            {CURATOR_696.followers ? ` · ${CURATOR_696.followers.toLocaleString()} on X` : ""}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--paper)]/80">{CURATOR_696.blurb}</p>
          {lineup.length > 0 && (
            <p className="mt-3 font-[family-name:var(--font-mono)] text-[11px] tracking-wide text-[var(--dim)]">
              {lineup.slice(0, 10).join("  ·  ")}
              {lineup.length > 10 ? "  ·  …" : ""}
            </p>
          )}
        </div>
        <span className="text-sm text-[var(--cyan)] sm:self-center">Open →</span>
      </Link>
    </section>
  );
}
