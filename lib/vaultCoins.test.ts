import { describe, expect, it } from "vitest";
import { formatTargetPct, targetPct } from "./vaultCoins";

describe("vault target display", () => {
  it("prefers on-chain bps over policy weight", () => {
    expect(targetPct(509, 0.077)).toBeCloseTo(5.09, 4);
  });

  it("falls back to policy when on-chain is zero", () => {
    expect(targetPct(0, 0.077)).toBeCloseTo(7.7, 4);
  });

  it("shows unset for custom names without targets", () => {
    expect(formatTargetPct(0, 0)).toBe("unset");
    expect(formatTargetPct(500, 0)).toBe("5.00%");
  });
});
