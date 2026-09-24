"use client";
import { useEffect, useState } from "react";
import { isAddress, parseAbi, zeroAddress, type Address } from "viem";
import { V2VaultDesk } from "@/components/V2VaultDesk";
import { productionV2Factory, productionV2Vault, v2FactoryAbi } from "@/lib/v2";
import { publicClient } from "@/lib/wallet";
import { ProportionalVaultDesk } from "@/components/ProportionalVaultDesk";
import { atomicFactoryAbi, atomicFactoryAddress, atomicFactoryStartBlock } from "@/lib/atomicFactory";
import type { ProportionalRelease } from "@/lib/proportionalRelease";
export function IndexClient({ slug }: { slug: string; gen0: boolean }) {
  const clean = slug.trim().toLowerCase();
  const official = productionV2Vault(clean);
  const direct = isAddress(clean) ? clean as Address : undefined;
  const [resolved, setResolved] = useState<{ slug: string; vault?: Address; proportional?: ProportionalRelease; error?: string }>();
  const [directSymbol, setDirectSymbol] = useState("");
  useEffect(() => {
    if (official || direct) return;
    let cancelled = false;
    const find = async () => {
      if (atomicFactoryAddress) {
        const [vault, implementation] = await Promise.all([
          publicClient.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "bySlug", args: [clean] }),
          publicClient.readContract({ address: atomicFactoryAddress, abi: atomicFactoryAbi, functionName: "implementation" }),
        ]);
        if (vault !== zeroAddress) return { slug: clean, vault, proportional: { vault, implementation, factory: atomicFactoryAddress, slug: clean, launchBlock: atomicFactoryStartBlock } };
      }
      const vault = await publicClient.readContract({ address: productionV2Factory, abi: v2FactoryAbi, functionName: "bySlug", args: [clean] });
      return { slug: clean, vault: vault === zeroAddress ? undefined : vault, error: vault === zeroAddress ? "This index has not been created." : undefined };
    };
    find()
      .then(next => { if (!cancelled) setResolved(next); })
      .catch(() => { if (!cancelled) setResolved({ slug: clean, error: "Unable to load this index. Please reload to retry." }); });
    return () => { cancelled = true; };
  }, [clean, official, direct]);
  useEffect(() => {
    if (!direct) return;
    let cancelled = false;
    publicClient.readContract({ address: direct, abi: parseAbi(["function symbol() view returns (string)"]), functionName: "symbol" })
      .then((symbol) => { if (!cancelled) setDirectSymbol(symbol.toLowerCase()); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [direct]);
  const vault = official ?? direct ?? (resolved?.slug === clean ? resolved.vault : undefined);
  return <div className="relative z-10 mx-auto max-w-5xl px-4 py-8">
    {resolved?.slug === clean && resolved.proportional ? <ProportionalVaultDesk release={resolved.proportional} /> : vault ? <V2VaultDesk vault={vault} slug={directSymbol || clean} /> : <p role="status">{resolved?.slug === clean ? resolved.error : "Loading index…"}</p>}
  </div>;
}
