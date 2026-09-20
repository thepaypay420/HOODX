import { describe, expect, it } from "vitest";
import { allocation, equalAllocation, percentBps } from "./v2Allocation";
describe("V2 allocation protection", () => {
  it("distributes rounding remainder without losing basis points", () => {
    const weights = equalAllocation("25", 7);
    expect(allocation("25", weights).weights.reduce((a,b) => a+b, 2500)).toBe(10000);
  });
  it("rejects invalid totals and cash outside contract limits", () => {
    expect(() => allocation("19", ["81"])).toThrow();
    expect(() => allocation("51", ["49"])).toThrow();
    expect(() => allocation("25", ["74.99"])).toThrow();
    expect(allocation("20", ["80"])).toEqual({cashBps:2000,weights:[8000]});
  });
  it("does not silently round or coerce malformed percentages", () => {
    for (const value of ["", "-1", "1e2", "0.001", "NaN", "100.01"]) expect(() => percentBps(value)).toThrow();
    expect(percentBps("12.54")).toBe(1254);
  });
});
