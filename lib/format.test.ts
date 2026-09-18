import { describe, expect, it } from "vitest";
import { fmtUsdSleeve, genesisEthWei, vaultRoiPct } from "./format";

describe("fmtUsdSleeve", () => {
  it("shows cents for small sleeves", () => {
    expect(fmtUsdSleeve(10.19)).toMatch(/10\.19/);
    expect(fmtUsdSleeve(0.0042)).toMatch(/0\.00/);
  });
});

describe("vaultRoiPct", () => {
  it("uses the $100 peg when ETH/USD is live (matches the Vault hint)", () => {
    const genesis = genesisEthWei(100, 2500);
    const share = (genesis * 99n) / 100n; // −1% in ETH
    const roiEth = vaultRoiPct(share, genesis);
    expect(roiEth).toBeCloseTo(-0.01, 6);
    const roiUsd = vaultRoiPct(share, genesis, 2600, 100);
    // 0.0396 ETH × $2600 ≈ $102.96 vs $100 peg
    expect(roiUsd).toBeGreaterThan(0.02);
  });
});
