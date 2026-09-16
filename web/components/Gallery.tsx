"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dropDraft, loadGallery, type DraftPack } from "@/lib/packs";
import { byAddress } from "@/lib/catalog";

export function Gallery() {
  const [packs, setPacks] = useState<DraftPack[]>([]);

  useEffect(() => {
    setPacks(loadGallery());
  }, []);

  if (!packs.length) return null;

  return (
    <section className="mt-14">
      <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--dim)]">
        Yours
      </p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl">Draft indexes</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {packs.map((p) => {
          const names = p.tokens
            .map((t) => byAddress(t)?.symbol)
            .filter(Boolean)
            .slice(0, 8)
            .join(" · ");
          return (
            <article key={p.slug} className="holo rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--dim)]">
                    /i/{p.slug}
                  </p>
                  <h3 className="font-[family-name:var(--font-display)] text-2xl">
                    ${p.symbol}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{p.name}</p>
                  <p className="mt-2 font-[family-name:var(--font-mono)] text-[10px] text-[var(--dim)]">
                    {p.tokens.length} slots · {(p.feeBps / 100).toFixed(2)}% cut · {names}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Link href={`/i/${p.slug}`} className="ghost rounded-sm px-3 py-2 text-center">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="ghost rounded-sm px-3 py-2 text-[var(--danger)]"
                    onClick={() => {
                      dropDraft(p.slug);
                      setPacks(loadGallery());
                    }}
                  >
                    Drop
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
