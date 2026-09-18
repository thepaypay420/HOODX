import { describe, expect, it } from "vitest";
import {
  analyzeDrift,
  draftTotals,
  equalTargets,
  liveMixTargets,
  normalizeDraft,
  resizeSliderTargets,
  riskCap,
  trimDriftTargets,
} from "./curator";

describe("curator targets", () => {
  it("equal splits the 75% risk budget", () => {
    const d = equalTargets(["0xaaa", "0xbbb", "0xccc"], 2500);
    expect(d["0xaaa"]).toBe(2500);
    expect(draftTotals(d, 2500).riskOnBps).toBe(7500);
    expect(draftTotals(d, 2500).cashBps).toBe(2500);
  });

  it("resize keeps risk-on inside the cap", () => {
    const base = equalTargets(["0xa", "0xb", "0xc"], 2500);
    const next = resizeSliderTargets(base, "0xa", 5000, 2500);
    expect(next["0xa"]).toBe(5000);
    expect(draftTotals(next, 2500).over).toBe(0);
    expect(draftTotals(next, 2500).riskOnBps).toBeLessThanOrEqual(riskCap(2500));
  });

  it("live mix scales overweight books down", () => {
    const d = liveMixTargets(
      [
        { token: "0xa", liveBps: 5000 },
        { token: "0xb", liveBps: 4000 },
      ],
      2500,
    );
    expect(draftTotals(d, 2500).riskOnBps).toBeLessThanOrEqual(7500);
    expect(d["0xa"]).toBeGreaterThan(d["0xb"] || 0);
  });

  it("trim keeps in-band on-chain targets and snaps drifted names", () => {
    const d = trimDriftTargets(
      [
        { token: "0xa", liveBps: 1000, onChainTargetBps: 900 },
        { token: "0xb", liveBps: 5000, onChainTargetBps: 500 },
        { token: "0xc", liveBps: 100, onChainTargetBps: 800 },
      ],
      2500,
      200,
    );
    expect(d["0xa"]).toBe(900);
    expect(d["0xb"]).toBeGreaterThan(d["0xc"] || 0);
    expect(draftTotals(d, 2500).riskOnBps).toBeLessThanOrEqual(7500);
  });

  it("normalize scales when risk-on exceeds the cap", () => {
    const draft = { "0xaaa": 4000, "0xbbb": 4000, "0xccc": 4000 };
    const nav = 15n * 10n ** 16n;
    const min = 4n * 10n ** 15n;
    const { bps } = normalizeDraft(draft, ["0xaaa", "0xbbb", "0xccc"], nav, min, 2500);
    expect(bps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(7500);
  });
});

describe("drift analysis", () => {
  it("flags buys and sells outside the band", () => {
    const nav = 10n ** 17n;
    const rows = analyzeDrift(
      [
        {
          token: "0xpons",
          symbol: "PONS",
          balanceWei: 10n ** 18n,
          wethValueWei: 6n * 10n ** 15n,
          onChainTargetBps: 500,
          draftBps: 1000,
          lastPxWad: 10n ** 18n,
          currentPxWad: 11n * 10n ** 17n,
        },
        {
          token: "0xtail",
          symbol: "TAIL",
          balanceWei: 10n ** 18n,
          wethValueWei: 3n * 10n ** 15n,
          onChainTargetBps: 500,
          draftBps: 50,
          lastPxWad: 10n ** 18n,
          currentPxWad: 10n ** 18n,
        },
      ],
      nav,
      2500,
      200,
    );
    const pons = rows.find((r) => r.symbol === "PONS");
    const tail = rows.find((r) => r.symbol === "TAIL");
    expect(pons?.action).toBe("buy");
    expect(tail?.action).toBe("sell");
    expect(pons?.markDelta).toBeCloseTo(0.1, 5);
  });
});
