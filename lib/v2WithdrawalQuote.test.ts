import { describe, expect, it } from "vitest";
import { classifyWithdrawalQuoteFailure, protectedWithdrawalMinimum, quoteWithdrawalWithRetry, withdrawalQuoteFailureMessage } from "./v2WithdrawalQuote";

describe("V2 withdrawal quote handling", () => {
  it("decodes the live InvalidReference selector", () => {
    expect(classifyWithdrawalQuoteFailure(new Error('reverted with signature: "0x5f41ff92"'))).toBe("invalid-reference");
    expect(withdrawalQuoteFailureMessage("invalid-reference")).toContain("Changing the minimum cannot fix it");
  });

  it("keeps the stronger of the execution quote and NAV floor", () => {
    expect(protectedWithdrawalMinimum(1000n, 995n).floor).toBe(995n);
    expect(protectedWithdrawalMinimum(1000n, 1n).floor).toBe(990n);
  });

  it("decodes the executor floor failure and does not retry it", async () => {
    expect(classifyWithdrawalQuoteFailure(new Error('reverted with signature: "0x2c5211c6"'))).toBe("protected-floor");
    expect(withdrawalQuoteFailureMessage("protected-floor")).toContain("protected on-chain sale floor");
    let attempts = 0;
    await expect(quoteWithdrawalWithRetry(async () => {
      attempts++;
      throw new Error("0x2c5211c6");
    }, async () => {})).rejects.toThrow("0x2c5211c6");
    expect(attempts).toBe(1);
  });

  it("recovers from a transient route rehearsal failure", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const result = await quoteWithdrawalWithRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary RPC or route rehearsal failure");
        return 123n;
      },
      async milliseconds => { waits.push(milliseconds); },
    );
    expect(result).toBe(123n);
    expect(attempts).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  it("does not retry an invalid on-chain reference", async () => {
    let attempts = 0;
    await expect(quoteWithdrawalWithRetry(async () => {
      attempts++;
      throw new Error("0x5f41ff92");
    }, async () => {})).rejects.toThrow("0x5f41ff92");
    expect(attempts).toBe(1);
  });
});
