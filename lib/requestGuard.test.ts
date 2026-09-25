import { afterEach, describe, expect, it } from "vitest";
import { admitWork, mapConcurrent, resetWorkGuardForTests, WorkRejected } from "./requestGuard";

afterEach(resetWorkGuardForTests);

describe("aggregate request work guard", () => {
  const policy = { capacity: 4, refillPerSecond: 1, maxConcurrent: 2 };
  it("cannot be bypassed by changing caller-controlled identity", () => {
    const releases = [admitWork("quote", 1, policy, 0), admitWork("quote", 1, policy, 0)];
    expect(() => admitWork("quote", 1, policy, 0)).toThrow(WorkRejected);
    releases.forEach((release) => release());
    admitWork("quote", 2, policy, 0)();
    expect(() => admitWork("quote", 1, policy, 0)).toThrow(WorkRejected);
  });

  it("refills only with elapsed time and release is idempotent", () => {
    const release = admitWork("image", 4, policy, 0);
    release(); release();
    expect(() => admitWork("image", 1, policy, 999)).toThrow(WorkRejected);
    admitWork("image", 1, policy, 1000)();
  });

  it("bounds internal fan-out", async () => {
    let active = 0, peak = 0;
    await mapConcurrent([1,2,3,4,5], 2, async () => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    });
    expect(peak).toBe(2);
  });

  it("fails closed for invalid or corrupted protection state", () => {
    expect(() => admitWork("bad", 2, { capacity: 1, refillPerSecond: 1, maxConcurrent: 1 })).toThrow(/Invalid/);
    (globalThis as Record<PropertyKey, unknown>)[Symbol.for("hoodx.request-work-guard.v1")] = { buckets: null };
    expect(() => admitWork("quote", 1, policy)).toThrow(/unavailable/);
  });

  it("stops repeated maximum-size cache-miss batches", () => {
    const market={capacity:96,refillPerSecond:1.6,maxConcurrent:4};
    for(let i=0;i<4;i++)admitWork("holding-market",24,market,0)();
    expect(()=>admitWork("holding-market",24,market,0)).toThrow(WorkRejected);
  });
});
