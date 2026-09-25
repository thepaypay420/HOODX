export type VaultActivity = {
  kind: "harvest" | "rebalance" | "deploy";
  title: string;
  detail: string;
  result: string;
  confirmedAt: string;
  txHash: `0x${string}`;
};

const activityBySlug: Readonly<Record<string, readonly VaultActivity[]>> = {
  "696x": [
    {
      kind: "harvest",
      title: "Gains harvested",
      detail: "28.47 CASHCAT moved into the WETH reserve",
      result: "+0.00197 WETH reserve",
      confirmedAt: "2026-09-25T20:24:58.000Z",
      txHash: "0xe8b33328d4b0027e885dde9e32fb6118cfb9043137beff7d2a56616a4df0b1c1",
    },
  ],
};

export function recentVaultActivity(slug: string): readonly VaultActivity[] {
  return activityBySlug[slug.toLowerCase()] ?? [];
}

export function activityTransactionUrl(txHash: VaultActivity["txHash"]): string {
  return `https://robin.etherscan.io/tx/${txHash}`;
}
