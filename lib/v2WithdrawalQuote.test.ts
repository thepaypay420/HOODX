import { describe, expect, it } from "vitest";
import { classifyWithdrawalQuoteFailure, protectedWithdrawalMinimum, withdrawalQuoteFailureMessage } from "./v2WithdrawalQuote";

describe("V2 withdrawal quote handling", () => {
  it("decodes the live InvalidReference selector", () => {
    expect(classifyWithdrawalQuoteFailure(new Error('reverted with signature: "0x5f41ff92"'))).toBe("invalid-reference");
    expect(withdrawalQuoteFailureMessage("invalid-reference")).toContain("Changing the minimum cannot fix it");
  });

  it("keeps the stronger of the execution quote and NAV floor", () => {
    expect(protectedWithdrawalMinimum(1000n, 995n).floor).toBe(995n);
    expect(protectedWithdrawalMinimum(1000n, 1n).floor).toBe(990n);
  });
});
