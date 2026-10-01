import { describe, expect, it } from "vitest";
import { deadline, minOut, sizeShares, sleeveState } from "./stockLp";

describe("stockLp helpers", () => {
  it("sizes shares proportionally with a margin", () => {
    // probe: 100 shares for 1 ETH -> 2 ETH buys 200 shares minus 3%
    expect(sizeShares(100n, 10n ** 18n, 2n * 10n ** 18n)).toBe(194n);
    expect(sizeShares(0n, 1n, 1n)).toBe(0n);
    expect(sizeShares(1n, 0n, 1n)).toBe(0n);
  });
  it("min out never zero for a positive quote", () => {
    expect(minOut(10_000n)).toBe(9_850n);
    expect(minOut(1n)).toBe(1n);
    expect(minOut(0n)).toBe(0n);
  });
  it("deadline sits inside the 5-minute contract window", () => {
    expect(deadline(1_000)).toBe(1_240n);
  });
  it("describes sleeve state", () => {
    const base = { inRange: true, referenceAgrees: true, breachStart: 0n, rebandReady: false };
    expect(sleeveState(base, 0).label).toBe("Earning in range");
    expect(sleeveState({ ...base, referenceAgrees: false }, 0).tone).toBe("warn");
    expect(sleeveState({ ...base, inRange: false, breachStart: 1000n }, 1000 + 5 * 3600).label).toBe("Waiting · 5h of 24h");
    expect(sleeveState({ ...base, inRange: false, rebandReady: true }, 0).label).toBe("Rebalance due");
  });
});
