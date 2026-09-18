import { describe, expect, it } from "vitest";
import {
  analyzeDrift,
  curatorWorkflow,
  draftTotals,
  equalTargets,
  liveMixTargets,
  normalizeDraft,
  resizeSliderTargets,
  parkLegacyTargets,
  riskCap,
  suggestBuyEth,
  trimDriftTargets,
  vaultMcapTargets,
  mcapScore,
} from "./curator";

describe("curator targets", () => {
  it("equal splits the 75% risk budget", () => {
    const d = equalTargets(["0xaaa", "0xbbb", "0xccc"], 2500);
    expect(d["0xaaa"]).toBe(2500);
    expect(draftTotals(d, 2500).riskOnBps).toBe(7500);
    expect(draftTotals(d, 2500).cashBps).toBe(2500);
  });

  it("resize reallocates others by mcap not proportional draft", () => {
    const mcapRows = [
      { token: "0xa", mcapUsd: 400_000_000 },
      { token: "0xb", mcapUsd: 100_000_000 },
      { token: "0xc", mcapUsd: 25_000_000 },
    ];
    const base = vaultMcapTargets(mcapRows, 2500);
    const next = resizeSliderTargets(base, "0xa", 5000, 2500, mcapRows);
    expect(next["0xa"]).toBe(5000);
    expect(draftTotals(next, 2500).over).toBe(0);
    expect(next["0xb"] || 0).toBeGreaterThan(next["0xc"] || 0);
  });

  it("drift rows keep input order", () => {
    const nav = 10n ** 18n;
    const rows = analyzeDrift(
      [
        {
          token: "0xzzz",
          symbol: "ZZZ",
          balanceWei: 1n,
          wethValueWei: 1n ** 17n,
          onChainTargetBps: 100,
          draftBps: 100,
          lastPxWad: 10n ** 18n,
          currentPxWad: 10n ** 18n,
        },
        {
          token: "0xaaa",
          symbol: "AAA",
          balanceWei: 1n,
          wethValueWei: 5n * 10n ** 16n,
          onChainTargetBps: 5000,
          draftBps: 50,
          lastPxWad: 10n ** 18n,
          currentPxWad: 10n ** 18n,
        },
      ],
      nav,
      2500,
      200,
    );
    expect(rows[0]?.symbol).toBe("ZZZ");
    expect(rows[1]?.symbol).toBe("AAA");
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

  it("park legacy zeros skipped bags only", () => {
    const d = parkLegacyTargets(
      [
        { token: "0xquotient", balanceWei: 1n, onChainTargetBps: 500, legacy: true },
        { token: "0xpons", balanceWei: 1n, onChainTargetBps: 770, legacy: false },
      ],
      2500,
    );
    expect(d["0xquotient"]).toBe(0);
    expect(d["0xpons"]).toBe(770);
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

  it("suggestBuyEth caps by deployable WETH above cash floor", () => {
    const nav = 10n ** 18n;
    const weth = 4n * 10n ** 17n; // 0.4 ETH
    const row = analyzeDrift(
      [
        {
          token: "0xpons",
          symbol: "PONS",
          balanceWei: 10n ** 18n,
          wethValueWei: 1n * 10n ** 16n,
          onChainTargetBps: 500,
          draftBps: 5000,
          lastPxWad: 10n ** 18n,
          currentPxWad: 10n ** 18n,
        },
      ],
      nav,
      2500,
      200,
    )[0]!;
    expect(row.action).toBe("buy");
    // floor = 25% of 1 ETH = 0.25; deployable = 0.15
    expect(suggestBuyEth(row, nav, weth, 2500)).toBeCloseTo(0.15, 6);
  });
});

describe("curator workflow", () => {
  it("prioritizes legacy exit before buys", () => {
    const wf = curatorWorkflow(
      [{ token: "0xlegacy", onChainTargetBps: 500 }],
      { "0xlegacy": 0 },
      [
        {
          token: "0xlegacy",
          symbol: "OLD",
          liveBps: 500,
          targetBps: 500,
          draftBps: 0,
          driftBps: 500,
          valueEth: 0.05,
          valueUsd: 100,
          markDelta: null,
          plVsTargetEth: 0.05,
          plVsTargetUsd: 100,
          action: "park",
          swapEth: 0.05,
        },
        {
          token: "0xnew",
          symbol: "NEW",
          liveBps: 0,
          targetBps: 0,
          draftBps: 1000,
          driftBps: -1000,
          valueEth: 0,
          valueUsd: 0,
          markDelta: null,
          plVsTargetEth: -0.1,
          plVsTargetUsd: -200,
          action: "buy",
          swapEth: 0.1,
        },
      ],
      10n ** 17n,
      [],
    );
    expect(wf.headline).toContain("OLD");
    expect(wf.draftDirty).toBe(true);
  });
});
