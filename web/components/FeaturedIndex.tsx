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
    <section className="mt-16 sm:mt-24">
      <p className="text-[11px] text-[var(--dim)]">First index</p>
      <Link
        href={`/i/${GEN0_SLUG}`}
        className="holo mt-3 block rounded-2xl p-4 transition-colors hover:border-[rgba(196,165,116,0.4)] sm:p-6"
      >
        <div className="flex items-center gap-3.5">
          <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-full border border-[var(--line)] sm:h-20 sm:w-20">
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
            <h2 className="truncate font-[family-name:var(--font-display)] text-[1.85rem] leading-none sm:text-4xl">
              ${GEN0_SYMBOL}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--dim)]">
              @{CURATOR_696.handle}
              {CURATOR_696.followers ? ` · ${CURATOR_696.followers.toLocaleString()} on X` : ""}
            </p>
          </div>
          <span className="hidden shrink-0 text-sm text-[var(--cyan)] sm:inline">Open →</span>
        </div>
        <p className="mt-4 text-[15px] leading-6 text-[var(--paper)]/85">{CURATOR_696.blurb}</p>
        {lineup.length > 0 && (
          <p className="mt-3 text-[12px] leading-5 text-[var(--dim)]">
            {lineup.slice(0, 8).join(" · ")}
            {lineup.length > 8 ? " · …" : ""}
          </p>
        )}
      </Link>
    </section>
  );
}
