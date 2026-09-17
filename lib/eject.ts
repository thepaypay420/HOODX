/** `NeedBuffer()` — vault still holds the ERC20. Selector from the failed WALLET eject. */
export const NEED_BUFFER_SEL = "0x1309bbaa";
/** `Slippage()` — amountOutMin below the live 97% TWAP floor. */
export const SLIPPAGE_SEL = "0x7dd37f70";

export function isHeldWei(wei: bigint | number | string | null | undefined): boolean {
  try {
    return BigInt(wei ?? 0) > 0n;
  } catch {
    return false;
  }
}

export function ejectBlocked(symbol: string, held: boolean): string | null {
  if (!held) return null;
  return `${symbol} is still in the vault — sell to WETH on Rebalance, then tap ×`;
}

export function sellBlocked(amountWei: bigint, bagWei: bigint, symbol: string, bagText: string): string | null {
  if (amountWei <= 0n) return "amount in must be > 0";
  if (bagWei <= 0n) return `vault holds 0 ${symbol}`;
  if (amountWei > bagWei) return `vault holds ${bagText} ${symbol} — use Max`;
  return null;
}

export function partitionRemovals(
  tokens: readonly string[],
  weiByToken: ReadonlyMap<string, bigint>,
): { empty: string[]; held: string[] } {
  const empty: string[] = [];
  const held: string[] = [];
  for (const token of tokens) {
    const wei = weiByToken.get(token.toLowerCase()) ?? 0n;
    if (isHeldWei(wei)) held.push(token);
    else empty.push(token);
  }
  return { empty, held };
}

function blobOf(err: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (value == null || depth > 4) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      parts.push(String(value));
      return;
    }
    if (typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    for (const k of ["shortMessage", "message", "details", "errorName", "errorSignature"]) {
      if (typeof o[k] === "string") parts.push(o[k] as string);
    }
    if (typeof o.data === "string") parts.push(o.data);
    else walk(o.data, depth + 1);
    walk(o.cause, depth + 1);
  };
  walk(err, 0);
  return parts.join("\n").toLowerCase();
}

export function revertHint(err: unknown): string {
  const blob = blobOf(err);
  if (blob.includes("needbuffer") || blob.includes(NEED_BUFFER_SEL)) {
    return "still holding that name — sell to WETH on Rebalance, then tap ×";
  }
  if (blob.includes("slippage") || blob.includes(SLIPPAGE_SEL)) {
    return "min-out went stale vs TWAP — tap Swap again, and sell the vault bag (Max)";
  }
  if (blob.includes("swapfailed") || blob.includes("0x81ceff30")) {
    return "pool could not fill the TWAP floor — wait a block and sell Max";
  }
  if (blob.includes("badlen")) return "pack needs at least 2";
  if (blob.includes("listed")) return "that name is not on the book";
  const msg = err instanceof Error ? err.message.trim() : "";
  return msg ? msg.slice(0, 160) : "sell to WETH first, then eject";
}
