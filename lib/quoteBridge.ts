"use client";

import { type Address, type WalletClient } from "viem";
import { vaultAbi } from "@/lib/abi";
import { type Coin, isV4RhQuotePool } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { catalogBridge, isRhStockToken } from "@/lib/rhStocks";
import { findWethBridge } from "@/lib/lookup";
import { publicClient } from "@/lib/wallet";

/** Ensure the vault has a WETH V3 bridge for an RH stock quote before V4 bind/swap. */
export async function ensureQuoteBridge(
  vault: Address,
  coin: Coin,
  walletClient: WalletClient,
  owner: Address,
): Promise<void> {
  if (!isV4RhQuotePool(coin)) return;
  const quote = (coin.buyQuoteAddr || "").toLowerCase();
  if (!quote || !isRhStockToken(quote)) {
    throw new Error("stock quote pool needs a canonical RH stock address");
  }
  const onChain = (await publicClient.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "quoteBridgeV3",
    args: [quote as Address],
  })) as Address;
  if (onChain && onChain !== "0x0000000000000000000000000000000000000000") return;

  const bridge = (await findWethBridge(quote)) || catalogBridge(quote);
  if (!bridge) {
    throw new Error("no WETH V3 bridge for that RH stock — seed liquidity or setQuoteBridge manually");
  }

  const hash = await walletClient.writeContract({
    account: owner,
    address: vault,
    abi: vaultAbi,
    functionName: "setQuoteBridge",
    args: [quote as Address, bridge as Address],
    chain: robinhood,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
