"use client";

import { type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { WETH } from "@/lib/config";
import { publicClient } from "@/lib/wallet";

const MIN_WEI = 10n ** 14n; // 0.0001 ETH

/** V4 spot quoteOut can exceed what the pool fills at the 97% floor — clip buys to what simulates. */
export async function capV4BuyWei(
  vault: Address,
  token: Address,
  owner: Address,
  wantWei: bigint,
): Promise<bigint> {
  if (wantWei <= 0n) return 0n;
  const sim = async (wei: bigint) => {
    if (wei < MIN_WEI) return false;
    const twap = await publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "quoteOut",
      args: [WETH, token, wei],
    });
    const floor = await publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "minOutFloor",
      args: [twap],
    });
    if (floor <= 0n) return false;
    try {
      await publicClient.simulateContract({
        account: owner,
        address: vault,
        abi: vaultAbi,
        functionName: "swapV3",
        args: [WETH, token, wei, floor],
      });
      return true;
    } catch {
      return false;
    }
  };

  if (await sim(wantWei)) return wantWei;

  let lo = MIN_WEI;
  let hi = wantWei;
  let best = 0n;
  while (lo <= hi) {
    const mid = (lo + hi) / 2n;
    if (await sim(mid)) {
      best = mid;
      lo = mid + 1n;
    } else {
      hi = mid - 1n;
    }
  }
  return best;
}
