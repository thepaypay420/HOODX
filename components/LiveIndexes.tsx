"use client";

import Link from "next/link";


import { TokenArt } from "@/components/TokenArt";

import { verifiedV2Vaults } from "@/lib/v2";



type Row = { slug: string; vault: string; symbol: string };

export function LiveIndexes() {
  const rows: Row[] = Object.entries(verifiedV2Vaults).map(([slug, vault]) => ({ slug, vault, symbol: slug.toUpperCase() }));

  if (!rows.length) return null;

  return (
    <section className="mt-14">
      <p className="text-[13px] text-[var(--dim)]">Live</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">On chain</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <Link
            key={r.vault}
            href={`/i/${r.slug}`}
            data-testid={`live-${r.slug}`}
            className="holo rounded-xl p-4"
          >
            <p className="text-[12px] text-[var(--dim)]">
              /i/{r.slug}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <TokenArt slug={r.slug} size="sm" />
              <h3 className="text-xl font-semibold tracking-[-0.03em]">${r.symbol}</h3>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
