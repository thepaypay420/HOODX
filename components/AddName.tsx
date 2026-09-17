"use client";

import { useState } from "react";
import type { Coin } from "@/lib/catalog";
import { isAddress } from "@/lib/format";
import { lookupIndexCoin } from "@/lib/lookup";

export function AddName({
  onResolved,
  disabled,
  testId,
}: {
  onResolved: (coin: Coin) => void | Promise<void>;
  disabled?: boolean;
  testId: string;
}) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  async function add() {
    const raw = addr.trim();
    if (!isAddress(raw)) {
      setHint("Paste a token 0x.");
      return;
    }
    setBusy(true);
    setHint("");
    try {
      const coin = await lookupIndexCoin(raw);
      await onResolved(coin);
      setAddr("");
    } catch (e) {
      setHint(e instanceof Error ? e.message.slice(0, 160) : "lookup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          data-testid={testId}
          value={addr}
          onChange={(e) => setAddr(e.target.value.trim())}
          placeholder="Paste a new token 0x"
          className="field flex-1 text-sm"
          disabled={disabled || busy}
        />
        <button
          type="button"
          data-testid={`${testId}-btn`}
          disabled={disabled || busy}
          onClick={() => void add()}
          className="ape compact px-5 text-[13px] disabled:opacity-40"
        >
          {busy ? "Looking up…" : "Add token"}
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-[var(--dim)]">
        {hint || "Looks up a Uni V3 WETH or V4 ETH pool. 18 decimals. Max 24 names."}
      </p>
    </div>
  );
}
