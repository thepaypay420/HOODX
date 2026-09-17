import Link from "next/link";
import { TokenArt } from "@/components/TokenArt";
import { byAddress } from "@/lib/catalog";
import { CURATOR_696, GEN0_SLUG, GEN0_SYMBOL } from "@/lib/curators";
import { defaultPack } from "@/lib/packs";

export function FeaturedIndex() {
  const lineup = defaultPack()
    .map((t) => byAddress(t))
    .filter(Boolean)
    .map((c) => c!.symbol);

  return (
    <section className="mt-14 sm:mt-16">
      <p className="text-[13px] text-[var(--dim)]">First index</p>
      <Link
        href={`/i/${GEN0_SLUG}`}
        className="holo mt-3 block p-4 transition-[border-color,transform] hover:border-[rgba(31,212,198,0.35)] active:scale-[0.995] sm:p-5"
      >
        <div className="flex items-center gap-3.5">
          <TokenArt slug={GEN0_SLUG} size="md" priority />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[1.7rem] font-semibold leading-none tracking-[-0.04em] sm:text-3xl">
              ${GEN0_SYMBOL}
            </h2>
            <p className="mt-1.5 text-[13px] text-[var(--dim)]">
              @{CURATOR_696.handle}
            </p>
          </div>
          <span className="hidden text-sm text-[var(--cyan)] sm:inline">Open</span>
        </div>
        {lineup.length > 0 && (
          <p className="mt-4 text-[13px] leading-5 text-[var(--dim)]">
            {lineup.slice(0, 8).join(" · ")}
            {lineup.length > 8 ? " · …" : ""}
          </p>
        )}
      </Link>
    </section>
  );
}
