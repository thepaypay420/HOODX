"use client";

import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { CuratorBook } from "@/components/CuratorBook";
import { isAddress } from "@/lib/format";
import { publicClient, useWallet } from "@/lib/wallet";

export function CuratorBalanceSection({
  vault,
  onFocusSwap,
}: {
  vault?: string;
  onFocusSwap?: (token: string, side: "buy" | "sell", amountEth?: string) => void;
}) {
  const live = isAddress(vault || "");
  const { address } = useWallet();
  const [owner, setOwner] = useState("");
  const [msg, setMsg] = useState("");

  const loadOwner = useCallback(async () => {
    if (!live || !vault) return;
    const own = await publicClient.readContract({
      address: vault as Address,
      abi: vaultAbi,
      functionName: "owner",
    });
    setOwner(String(own).toLowerCase());
  }, [live, vault]);

  useEffect(() => {
    void loadOwner().catch(() => {});
  }, [loadOwner]);

  if (!live) return null;

  const isOwner = Boolean(address && owner && address.toLowerCase() === owner);
  if (!isOwner) return null;

  return (
    <section id="curator-balance" data-testid="curator-balance-section" className="holo p-4 sm:p-5">
      <p className="text-[13px] text-[var(--dim)]">Curator · Balance</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Targets, drift & rebalance</h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-6 text-[var(--dim)]">
        Slide each name to the weight you want, write targets on-chain, then Fix → Buy to spend idle WETH
        (above the cash floor). Sliders plan allocation — swaps run separately in vault swaps below.
      </p>

      <CuratorBook
        vault={vault!}
        onStatus={(m) => setMsg(m)}
        onFocusSwap={onFocusSwap}
      />

      {msg && (
        <p data-testid="curator-section-msg" className="mt-3 text-sm text-[var(--gold)]">
          {msg}
        </p>
      )}
    </section>
  );
}
