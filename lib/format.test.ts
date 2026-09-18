import { describe, expect, it } from "vitest";
import { fmtUsdSleeve } from "./format";

describe("fmtUsdSleeve", () => {
  it("shows cents for small sleeves", () => {
    expect(fmtUsdSleeve(10.19)).toMatch(/10\.19/);
    expect(fmtUsdSleeve(0.0042)).toMatch(/0\.00/);
  });
});
