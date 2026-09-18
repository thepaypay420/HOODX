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

/** WETH buys cannot spend below the vault cash floor (default 25%). */
export function buyBlocked(
  amountWei: bigint,
  wethWei: bigint,
  assetsWei: bigint,
  cashBps: number,
): string | null {
  if (amountWei <= 0n) return "amount in must be > 0";
  if (wethWei <= 0n) return "vault holds 0 WETH";
  if (assetsWei <= 0n || cashBps <= 0) return null;
  const need = (assetsWei * BigInt(cashBps)) / 10_000n;
  if (wethWei <= need) return "cash is already at the floor — sell a name first";
  const max = wethWei - need;
  if (amountWei > max) {
    return `max buy ${formatEtherSafe(max)} WETH — must keep ${(cashBps / 100).toFixed(0)}% cash`;
  }
  return null;
}

function formatEtherSafe(wei: bigint) {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0";
  return `${whole}.${frac}`;
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

export function isSlippageError(err: unknown): boolean {
  const blob = blobOf(err);
  return blob.includes("slippage") || blob.includes(SLIPPAGE_SEL);
}

/** Names like PROMETHEUS trade on SPCX/SPY books; the live vault may still be bound to a thin ETH stub. */
export function buySlippageHint(symbol: string, listedQuote?: string): string {
  const q = (listedQuote || "").toUpperCase();
  if (q && q !== "ETH" && q !== "WETH") {
    return `${symbol} trades on the ${q} pool (see DexScreener) — this vault is still bound to a thin ETH/WETH stub until V4 ${q} bind ships`;
  }
  return `${symbol} bind pool is too thin to fill at the 97% TWAP floor — seed the ETH/WETH book or wait for depth`;
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
    return "pool filled below the TWAP floor — retry after the bind book has more depth";
  }
  if (blob.includes("cashfloor") || blob.includes("0xdc55f981")) {
    return "that buy would breach the cash floor — use a smaller WETH amount";
  }
  if (blob.includes("swapfailed") || blob.includes("0x81ceff30")) {
    return "pool could not fill the TWAP floor — wait a block and sell Max";
  }
  if (blob.includes("badlen")) return "pack needs at least 2";
  if (blob.includes("listed")) return "that name is not on the book";
  const msg = err instanceof Error ? err.message.trim() : "";
  return msg ? msg.slice(0, 160) : "sell to WETH first, then eject";
}
