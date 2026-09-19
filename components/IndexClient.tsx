"use client";

import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { CuratorBalanceSection } from "@/components/CuratorBalanceSection";
import { IndexCard } from "@/components/IndexCard";
import { OwnerDesk } from "@/components/OwnerDesk";
import { VaultDesk } from "@/components/VaultDesk";
import { factoryAbi } from "@/lib/abi";
import {
  FACTORY,
  SAFE_FAANGX_VAULT_ADDR,
  VAULT,
  isBricked696x,
  isBrokenFaangx,
  isEmptied696x,
} from "@/lib/config";
import { isAddress } from "@/lib/format";
import { publicClient } from "@/lib/wallet";

export function IndexClient({ slug, gen0 }: { slug: string; gen0: boolean }) {
  const [vault, setVault] = useState(gen0 && isAddress(VAULT) ? VAULT : "");
  const [swapToken, setSwapToken] = useState("");
  const [swapSide, setSwapSide] = useState<"buy" | "sell">("sell");
  const [swapAmount, setSwapAmount] = useState("");

  useEffect(() => {
    const clean = slug.trim().toLowerCase();
    if (clean === "faangx" && isAddress(SAFE_FAANGX_VAULT_ADDR)) {
      setVault(SAFE_FAANGX_VAULT_ADDR as Address);
      return;
    }
    if (!isAddress(FACTORY)) return;
    publicClient
      .readContract({
        address: FACTORY as Address,
        abi: factoryAbi,
        functionName: "bySlug",
        args: [slug],
      })
      .then((addr) => {
        if (!addr || addr.toLowerCase() === zeroAddress) return;
        if (gen0 && (isEmptied696x(addr) || isBricked696x(addr))) return;
        if (clean === "faangx" && isBrokenFaangx(addr)) return;
        setVault(addr);
      })
      .catch(() => {});
  }, [slug, gen0]);

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 px-4 pb-24 pt-5 sm:space-y-8 sm:px-6 sm:pb-28 sm:pt-8">
      <VaultDesk slug={slug} vault={vault || undefined} isGen0={gen0} />
      <CuratorBalanceSection
        vault={vault || undefined}
        onFocusSwap={(tok, side, amt) => {
          setSwapToken(tok);
          setSwapSide(side);
          setSwapAmount(amt || "");
        }}
      />
      <IndexCard slug={slug} vault={vault || undefined} compact />
      <OwnerDesk
        slug={slug}
        vault={vault || undefined}
        prefilledToken={swapToken}
        prefilledSide={swapSide}
        prefilledAmount={swapAmount}
      />
    </div>
  );
}
