import { describe, expect, it } from "vitest";
import { AUTO_LP_LAUNCH, ethUsdFromSqrt, navSummary, positionAmounts, walletPnl } from "./autolpNav";

describe("autolp NAV maths", () => {
  it("position amounts are one-sided outside the range and two-sided inside", () => {
    const [a0, a1] = positionAmounts(1e18, 1.0, 2.0, 3.0); // below range: all token0
    expect(a0).toBeGreaterThan(0); expect(a1).toBe(0);
    const [b0, b1] = positionAmounts(1e18, 4.0, 2.0, 3.0); // above range: all token1
    expect(b0).toBe(0); expect(b1).toBeGreaterThan(0);
    const [c0, c1] = positionAmounts(1e18, 2.5, 2.0, 3.0);
    expect(c0).toBeGreaterThan(0); expect(c1).toBeGreaterThan(0);
  });
  it("ETH price from the ETH/USDG sqrt price", () => {
    const sqrt = BigInt(Math.round(Math.sqrt(2500e-12) * 2 ** 96)); // $2,500 ETH
    expect(ethUsdFromSqrt(sqrt)).toBeCloseTo(2500, 2);
  });
  it("since-launch is measured against the pinned launch share price", () => {
    const s = navSummary([AUTO_LP_LAUNCH.perShareUsd * 100], 100n * 10n ** 18n, AUTO_LP_LAUNCH.ethUsd);
    expect(s.sinceLaunchUsdPct).toBeCloseTo(0, 9);
    expect(s.sinceLaunchEthPct).toBeCloseTo(0, 9);
  });
  it("wallet P/L counts position + withdrawn - deposited", () => {
    expect(walletPnl(60n, 100n, 50n)).toEqual({ pnlWei: 10n, pct: 10 });
    expect(walletPnl(10n, 0n, 0n)).toBeUndefined();
  });
});
