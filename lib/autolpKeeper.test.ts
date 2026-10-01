import { describe, expect, it } from "vitest";
import { planKeeperRun, readyRebands, type SleeveStatus } from "./autolpKeeper";

const inRange: SleeveStatus = { inRange: true, referenceAgrees: true, breachStart: 0n, rebandReady: false };

describe("autolp keeper plan", () => {
  it("does nothing on a quiet hour", () => {
    expect(planKeeperRun([inRange, inRange], new Date("2026-10-07T13:05:00Z"))).toEqual({ signal: false, compound: false, claim: false });
  });
  it("signals while any sleeve is out of range or has an open breach", () => {
    expect(planKeeperRun([inRange, { ...inRange, inRange: false }], new Date("2026-10-07T13:05:00Z")).signal).toBe(true);
    expect(planKeeperRun([{ ...inRange, breachStart: 5n }], new Date("2026-10-07T13:05:00Z")).signal).toBe(true);
  });
  it("compounds daily at 00 UTC and claims weekly on Monday 00 UTC", () => {
    expect(planKeeperRun([inRange], new Date("2026-10-07T00:05:00Z"))).toMatchObject({ compound: true, claim: false }); // Wed
    expect(planKeeperRun([inRange], new Date("2026-10-05T00:05:00Z"))).toMatchObject({ compound: true, claim: true }); // Mon
  });
  it("only rebands sleeves the contracts mark ready", () => {
    const s: SleeveStatus[] = [
      { ...inRange, inRange: false, rebandReady: true },
      { ...inRange, inRange: false, rebandReady: true, referenceAgrees: false },
      { ...inRange, rebandReady: true },
      { ...inRange, inRange: false },
    ];
    expect(readyRebands(s)).toEqual([0]);
  });
});
