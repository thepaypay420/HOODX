import type { Address } from "viem";

type WatchAssetProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

type WalletAsset = {
  address: Address;
  symbol: string;
  image?: string;
};

function provider(): WatchAssetProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum as WatchAssetProvider | undefined;
}

/** Best-effort EIP-747 import. The image is wallet metadata, never transaction data. */
export async function addVaultAssetToWallet(asset: WalletAsset): Promise<boolean> {
  const wallet = provider();
  if (!wallet) return false;
  const image = asset.image
    ? new URL(asset.image, window.location.origin).toString()
    : undefined;
  try {
    return Boolean(await wallet.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: asset.address,
          symbol: asset.symbol.slice(0, 12),
          decimals: 18,
          ...(image ? { image } : {}),
        },
      },
    }));
  } catch {
    // Some wallets index assets server-side and do not implement EIP-747.
    return false;
  }
}
