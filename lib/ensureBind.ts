"use client";

import { type Address, type WalletClient } from "viem";
import { vaultAbi } from "@/lib/abi";
import { erc20Abi } from "@/lib/abi";
import { poolRef, type Coin } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { USDG } from "@/lib/config";
import { lookupIndexCoin } from "@/lib/lookup";
import { publicClient } from "@/lib/wallet";

export async function bestBindForToken(token: string): Promise<{ coin: Coin; ref: `0x${string}` }> {
  const coin = await lookupIndexCoin(token);
  return { coin, ref: poolRef(coin) };
}

/** Rebind a zero-bag name when Dexscreener's deepest book differs from on-chain poolIdOf. */
export async function ensureVaultBind(
  vault: Address,
  token: Address,
  walletClient: WalletClient,
  owner: Address,
): Promise<{ rebound: boolean; poolRef: `0x${string}`; quote: string }> {
  const [poolId, quote, bag] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "poolIdOf", args: [token] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "quoteOf", args: [token] }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
  ]);
  if (bag > 0n) {
    throw new Error("vault still holds this name — sell to WETH before rebinding");
  }
  const { ref } = await bestBindForToken(token);
  if (String(poolId).toLowerCase() === ref.toLowerCase()) {
    return { rebound: false, poolRef: ref, quote: String(quote).toLowerCase() };
  }
  await publicClient.simulateContract({
    account: owner,
    address: vault,
    abi: vaultAbi,
    functionName: "rebindToken",
    args: [token, ref],
  });
  const hash = await walletClient.writeContract({
    account: owner,
    address: vault,
    abi: vaultAbi,
    functionName: "rebindToken",
    args: [token, ref],
    chain: robinhood,
  });
  const rec = await publicClient.waitForTransactionReceipt({ hash });
  if (rec.status !== "success") throw new Error("rebind reverted");
  const nextQuote = await publicClient.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "quoteOf",
    args: [token],
  });
  return { rebound: true, poolRef: ref, quote: String(nextQuote).toLowerCase() };
}

export function isUsdgQuote(quote: string) {
  return quote.toLowerCase() === USDG.toLowerCase();
}
