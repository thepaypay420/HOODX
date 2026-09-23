import { describe, expect, it } from "vitest";
import { basketHoldReturnBps, basketHoldReturnFromValue, excessReturnBps } from "./basketBenchmark";

describe("basket benchmark", () => {
  it("compares against the original weighted basket with cash unchanged", () => {
    expect(basketHoldReturnBps(2500, [5000, 2500], [1n, 2n], [2n, 1n])).toBe(3750n);
  });

  it("rejects incomplete price history or an invalid allocation", () => {
    expect(basketHoldReturnBps(2500, [7500], [0n], [1n])).toBeUndefined();
    expect(basketHoldReturnBps(2500, [7000], [1n], [1n])).toBeUndefined();
  });

  it("reports curator excess return", () => {
    expect(excessReturnBps(1200n, 900n)).toBe(300n);
  });

  it("values the exact basket acquired at launch", () => {
    expect(basketHoldReturnFromValue(1_000n, 1_250n)).toBe(2_500n);
    expect(basketHoldReturnFromValue(0n, 1_250n)).toBeUndefined();
  });
});
