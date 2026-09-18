import { type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { WETH } from "@/lib/config";
import { publicClient } from "@/lib/wallet";

/** WETH wei value of a token bag — TWAP first, then last trade px if oracle is cold. */
export async function sleeveWethWei(vault: Address, token: Address, wei: bigint): Promise<bigint> {
  if (wei <= 0n) return 0n;
  if (token.toLowerCase() === WETH.toLowerCase()) return wei;
  try {
    const px = await publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "priceWethWad",
      args: [token],
    });
    if (px > 0n) return (wei * px) / 10n ** 18n;
  } catch {
    /* TWAP can be cold */
  }
  try {
    const px = await publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "lastPxWad",
      args: [token],
    });
    if (px > 0n) return (wei * px) / 10n ** 18n;
  } catch {
    /* */
  }
  return 0n;
}
