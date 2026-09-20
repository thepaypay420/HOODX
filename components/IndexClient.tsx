"use client";
import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { V2VaultDesk } from "@/components/V2VaultDesk";
import { productionV2Factory, productionV2Vault, v2FactoryAbi } from "@/lib/v2";
import { publicClient } from "@/lib/wallet";
export function IndexClient({ slug }: { slug: string; gen0: boolean }) {
  const clean = slug.trim().toLowerCase();
  const official = productionV2Vault(clean);
  const [resolved, setResolved] = useState<{ slug: string; vault?: Address; error?: string }>();
  useEffect(() => {
    if (official) return;
    let cancelled = false;
    publicClient.readContract({ address: productionV2Factory, abi: v2FactoryAbi, functionName: "bySlug", args: [clean] })
      .then(vault => { if (!cancelled) setResolved({ slug: clean, vault: vault === zeroAddress ? undefined : vault, error: vault === zeroAddress ? "This index has not been created on V2." : undefined }); })
      .catch(() => { if (!cancelled) setResolved({ slug: clean, error: "Unable to load this index. Please reload to retry." }); });
    return () => { cancelled = true; };
  }, [clean, official]);
  const vault = official ?? (resolved?.slug === clean ? resolved.vault : undefined);
  return <div className="relative z-10 mx-auto max-w-5xl px-4 py-8">
    {vault ? <V2VaultDesk vault={vault} slug={clean} /> : <p role="status">{resolved?.slug === clean ? resolved.error : "Loading index…"}</p>}
  </div>;
}
