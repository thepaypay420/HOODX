import { describe, expect, it } from "vitest";
import { isUsdgQuote } from "./ensureBind";

describe("ensureBind", () => {
  it("flags USDG quote only", () => {
    expect(isUsdgQuote("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")).toBe(true);
    expect(isUsdgQuote("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")).toBe(false);
    expect(isUsdgQuote("0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa")).toBe(false);
  });
});
