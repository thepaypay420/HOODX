import { expect, it } from "vitest";
import { launchReturnBps, walletReturn } from "./v2Performance";
const eth = 10n ** 18n;
it("measures per-share performance independently of deposits", () => {
  expect(launchReturnBps(eth,25n*eth)).toBe(0n);
  expect(launchReturnBps(2n*eth,50n*eth)).toBe(0n);
  expect(launchReturnBps(11n*eth/10n,25n*eth)).toBe(1000n);
  expect(launchReturnBps(0n,0n)).toBeUndefined();
});
it("includes withdrawals and deposit fees in wallet P&L without double counting shares", () => {
  expect(walletReturn(eth/2n,10n*eth,10n*eth,eth,eth/2n)?.bps).toBe(0n);
  expect(walletReturn(99n*eth/100n,eth,eth,eth,0n)?.bps).toBe(-100n);
  expect(walletReturn(0n,0n,0n,eth,11n*eth/10n)?.bps).toBe(1000n);
  expect(walletReturn(eth,eth,eth,0n,0n)).toBeUndefined();
});
