"use client";

import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { IndexCard } from "@/components/IndexCard";
import { VaultDesk } from "@/components/VaultDesk";
import { factoryAbi } from "@/lib/abi";
import { FACTORY, VAULT } from "@/lib/config";
import { isAddress } from "@/lib/format";
import { publicClient } from "@/lib/wallet";

export function IndexClient({ slug, gen0 }: { slug: string; gen0: boolean }) {
  const [vault, setVault] = useState(gen0 && isAddress(VAULT) ? VAULT : "");

  useEffect(() => {
    if (!isAddress(FACTORY)) return;
    publicClient
      .readContract({
        address: FACTORY as Address,
        abi: factoryAbi,
        functionName: "bySlug",
        args: [slug],
      })
      .then((addr) => {
        if (addr && addr.toLowerCase() !== zeroAddress) setVault(addr);
      })
      .catch(() => {});
  }, [slug]);

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 px-4 pb-24 pt-5 sm:space-y-8 sm:px-5 sm:pb-28 sm:pt-10">
      <IndexCard slug={slug} vault={vault || undefined} compact />
      <VaultDesk slug={slug} vault={vault || undefined} isGen0={gen0} />
    </div>
  );
}
