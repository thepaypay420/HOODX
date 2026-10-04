import { describe, expect, it } from "vitest";
import { quoteSymbol, simulatedReturn } from "./collectionReturns";

const eth = { launch: 2000, now: 2200 }; // +10%

describe("simulatedReturn", () => {
  it("weights each leg and the WETH cash sleeve", () => {
    // 50% A (+20%), 25% B (-20%), 25% cash in ETH (+10%) -> +10% -5% +2.5% = +7.5%
    const r = simulatedReturn([{ symbol: "A", weightBps: 5000 }, { symbol: "B", weightBps: 2500 }], 2500,
      { A: { launch: 100, now: 120 }, B: { launch: 50, now: 40 } }, eth, 1);
    expect(r?.pct).toBeCloseTo(7.5, 9);
    expect(r?.coverageBps).toBe(10_000);
  });
  it("re-weights around a small unpriced leg", () => {
    const r = simulatedReturn([{ symbol: "A", weightBps: 7000 }, { symbol: "X", weightBps: 500 }], 2500, { A: { launch: 10, now: 11 } }, { launch: 1, now: 1 }, 1);
    expect(r?.pct).toBeCloseTo((7000 * 1.1 + 2500) / 9500 * 100 - 100, 9);
    expect(r?.coverageBps).toBe(9500);
  });
  it("gives no estimate when more than 10% of the basket is unpriced", () => {
    expect(simulatedReturn([{ symbol: "A", weightBps: 6000 }, { symbol: "X", weightBps: 1500 }], 2500, { A: { launch: 1, now: 1 } }, eth, 1)).toBeUndefined();
  });
  it("needs an ETH price for the cash sleeve", () => {
    expect(simulatedReturn([{ symbol: "A", weightBps: 7500 }], 2500, { A: { launch: 1, now: 1 } }, undefined, 1)).toBeUndefined();
  });
});

describe("quoteSymbol", () => {
  it("maps share classes to the exchange ticker", () => { expect(quoteSymbol(" brk.b ")).toBe("BRK-B"); });
});
