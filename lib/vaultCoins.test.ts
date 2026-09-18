import { describe, expect, it } from "vitest";
import { formatTargetPct, targetPct } from "./vaultCoins";

describe("vault target display", () => {
  it("prefers on-chain bps over policy weight", () => {
    expect(targetPct(509, 0.077)).toBeCloseTo(5.09, 4);
  });

  it("falls back to policy when on-chain is zero", () => {
    expect(targetPct(0, 0.077)).toBeCloseTo(7.7, 4);
  });

  it("shows live weight for held legacy bags", () => {
    expect(formatTargetPct(0, 0, { held: true, liveWeight: 0.0537, legacy: true })).toBe("5.37% · park");
    expect(formatTargetPct(0, 0, { held: true, liveWeight: 0.04 })).toBe("4.00% live");
  });
});
