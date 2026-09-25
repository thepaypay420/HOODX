"use client";

import Link from "next/link";
import { formatEther, isAddress, type Address } from "viem";
import { TokenArt } from "@/components/TokenArt";
import listed from "@/deployments/community-vaults.json";

type ListedRow = { vault: string; slug: string; name: string; symbol: string; curator: string; assetsWei?: string };

/** Discovery is bounded and editorial. Factories and direct slug access stay permissionless. */
export function LiveIndexes() {
  const rows=(listed as ListedRow[]).slice(0,24).filter(row=>
    isAddress(row.vault)&&isAddress(row.curator)&&/^[a-z0-9]{3,16}$/.test(row.slug)&&row.name.length<=64&&row.symbol.length<=16
  );
  if (!rows.length) return null;
  return <section className="mt-14">
    <p className="text-[13px] text-[var(--dim)]">Community</p>
    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Built on HOODX</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {rows.map((row) => <Link key={row.vault} href={`/i/${row.slug}`} data-testid={`live-${row.slug}`} className="holo rounded-xl p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-[12px] text-[var(--dim)]">Community index</p><span className="text-[11px] text-[var(--cyan)]">Reviewed listing</span></div>
        <div className="mt-2 flex items-center gap-3"><TokenArt slug={row.slug} size="sm" /><div className="min-w-0"><h3 className="truncate text-xl font-semibold tracking-[-0.03em]">${row.symbol}</h3><p className="truncate text-[12px] text-[var(--dim)]">{row.name}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3 text-[12px] text-[var(--dim)]"><span>{row.assetsWei ? `${Number(formatEther(BigInt(row.assetsWei))).toLocaleString(undefined,{maximumFractionDigits:4})} ETH` : "Community listing"}</span><span>{`${(row.curator as Address).slice(0,6)}…${row.curator.slice(-4)}`}</span></div>
      </Link>)}
    </div>
  </section>;
}
