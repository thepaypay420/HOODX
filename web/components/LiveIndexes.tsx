"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Address } from "viem";
import { TokenArt } from "@/components/TokenArt";
import { factoryAbi, vaultAbi } from "@/lib/abi";
import { FACTORY } from "@/lib/config";
import { isAddress } from "@/lib/format";
import { publicClient } from "@/lib/wallet";

type Row = { slug: string; vault: string; symbol: string };

export function LiveIndexes() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!isAddress(FACTORY)) return;
    let cancel = false;
    (async () => {
      const n = Number(
        await publicClient.readContract({
          address: FACTORY as Address,
          abi: factoryAbi,
          functionName: "indexCount",
        }),
      );
      const out: Row[] = [];
      for (let i = 0; i < n; i++) {
        const vault = await publicClient.readContract({
          address: FACTORY as Address,
          abi: factoryAbi,
          functionName: "indexAt",
          args: [BigInt(i)],
        });
        const slug = await publicClient.readContract({
          address: FACTORY as Address,
          abi: factoryAbi,
          functionName: "slugOf",
          args: [vault],
        });
        let symbol = slug.toUpperCase();
        try {
          symbol = (await publicClient.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: "symbol",
          })) as string;
        } catch {
          /* keep slug */
        }
        out.push({ slug, vault, symbol });
      }
      if (!cancel) setRows(out);
    })().catch(() => {
      if (!cancel) setRows([]);
    });
    return () => {
      cancel = true;
    };
  }, []);

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
