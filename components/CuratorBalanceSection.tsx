"use client";

import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { CuratorBook } from "@/components/CuratorBook";
import { isAddress, shortAddr } from "@/lib/format";
import { publicClient, useWallet } from "@/lib/wallet";

export function CuratorBalanceSection({
  vault,
  onFocusSwap,
}: {
  vault?: string;
  onFocusSwap?: (token: string, side: "buy" | "sell", amountEth?: string) => void;
}) {
  const live = isAddress(vault || "");
  const { address, connect, connecting } = useWallet();
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
  const connected = Boolean(address);

  return (
    <section id="curator-balance" data-testid="curator-balance-section" className="holo p-4 sm:p-5">
      <p className="text-[13px] text-[var(--dim)]">Curator · Balance</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Targets, drift & rebalance</h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-6 text-[var(--dim)]">
        Slide each name to the weight you want, pick a preset strategy, write targets on-chain, then use Fix
        to prefill vault swaps. P/L vs target is sleeve drift from your draft — not wallet ROI.
      </p>

      {!connected ? (
        <div className="mt-4 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-4 py-3">
          <p className="text-[14px] leading-6 text-[var(--paper)]">
            Connect the curator wallet to unlock sliders and on-chain writes.
          </p>
          <p className="mt-1 text-[13px] text-[var(--dim)]">Curator on this vault: {shortAddr(owner)}</p>
          <button
            type="button"
            data-testid="curator-connect"
            disabled={connecting}
            onClick={() => void connect().catch(() => setMsg("Wallet closed."))}
            className="ape mt-3 px-4 text-[13px]"
          >
            {connecting ? "…" : "Connect wallet"}
          </button>
        </div>
      ) : !isOwner ? (
        <div className="mt-4 rounded-xl border border-[var(--line)] px-4 py-3">
          <p className="text-[14px] leading-6 text-[var(--dim)]">
            Connected {shortAddr(address!)} — not the curator. Switch to{" "}
            <span className="text-[var(--paper)]">{shortAddr(owner)}</span> to edit targets and swap.
          </p>
        </div>
      ) : null}

      <CuratorBook
        vault={vault!}
        locked={!isOwner}
        onStatus={(m) => setMsg(m)}
        onFocusSwap={isOwner ? onFocusSwap : undefined}
      />

      {msg && (
        <p data-testid="curator-section-msg" className="mt-3 text-sm text-[var(--gold)]">
          {msg}
        </p>
      )}
    </section>
  );
}
