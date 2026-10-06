import { describe, expect, it } from "vitest";
import { deadline, initialProbeShares, minOut, sizeShares, sleeveState, stockLpVaultAbi } from "./stockLp";

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
    expect(sleeveState({ ...base, inRange: false, breachStart: 1000n }, 1000 + 6 * 60).label).toBe("Out of range · 9 min to rebalance");
    expect(sleeveState({ ...base, inRange: false, breachStart: 1000n }, 1000 + 20 * 60).label).toBe("At the band edge");
    expect(sleeveState({ ...base, inRange: false, rebandReady: true, atEdge: true }, 0).label).toBe("At the band edge");
    expect(sleeveState({ ...base, inRange: false, rebandReady: true }, 0).label).toBe("Rebalance due");
  });
});

describe("initialProbeShares", () => {
  it("asks for ~60% of the shares the deposit buys at the live price", () => {
    // 0.02 ETH at 0.00037059 ETH/share buys ~53.97 shares; the probe is 60% of that.
    const probe = initialProbeShares(20_000_000_000_000_000n, 0.00037059093108327);
    expect(Number(probe) / 1e18).toBeCloseTo(32.38, 1);
  });
  it("returns 0 when the price is unknown or the amount is empty", () => {
    expect(initialProbeShares(10n ** 18n, 0)).toBe(0n);
    expect(initialProbeShares(10n ** 18n, Number.NaN)).toBe(0n);
    expect(initialProbeShares(0n, 0.0004)).toBe(0n);
  });
});

describe("stockLpVaultAbi", () => {
  it("decodes the vault custom errors the deposit sizer relies on", () => {
    const names = stockLpVaultAbi.filter((x) => x.type === "error").map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["BelowMinimum", "CapExceeded", "Illiquid", "Slippage", "Stale"]));
  });
});
