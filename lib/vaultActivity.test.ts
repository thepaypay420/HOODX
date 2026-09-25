import { describe, expect, it } from "vitest";
import { activityTransactionUrl, recentVaultActivity } from "./vaultActivity";

describe("vault activity", () => {
  it("publishes the verified 696X harvest", () => {
    const [harvest] = recentVaultActivity("696X");
    expect(harvest).toMatchObject({
      kind: "harvest",
      title: "Gains harvested",
      result: "+0.00197 WETH reserve",
      confirmedAt: "2026-09-25T20:24:58.000Z",
    });
    expect(activityTransactionUrl(harvest.txHash)).toBe(
      "https://robin.etherscan.io/tx/0xe8b33328d4b0027e885dde9e32fb6118cfb9043137beff7d2a56616a4df0b1c1",
    );
  });

  it("leaves vaults without verified actions empty", () => {
    expect(recentVaultActivity("faangx")).toEqual([]);
    expect(recentVaultActivity("siliconx")).toEqual([]);
  });
});
