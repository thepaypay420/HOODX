import { describe, expect, it } from "vitest";
import { checkDeposit, checkWithdraw } from "./guard";
import { GUARD_CASES, TEST_VAULTS } from "./guardCases";
import { amountMentions, vaultMentions } from "./understand";

describe("agent guard: the model's proposal must match the user's words", () => {
  for (const c of GUARD_CASES) {
    it(c.name, () => {
      const r = c.kind === "deposit" ? checkDeposit(c.intent, c.msgs, TEST_VAULTS, c.page) : checkWithdraw(c.intent, c.msgs, TEST_VAULTS, c.page);
      if (c.expect === "clarify") expect(r.decision).toBe("clarify");
      else expect(r).toEqual(c.expect);
    });
  }
});

describe("understand", () => {
  it("masks vault names before reading amounts", () => {
    expect(amountMentions("deposit into 696x", TEST_VAULTS)).toEqual([]);
    expect(vaultMentions("put 0.1 into $AIX and boost", TEST_VAULTS).slugs).toEqual(["aistack", "boost"]);
  });
  it("never reads plain 'eth' as Boosted ETH", () => {
    expect(vaultMentions("put 0.1 eth into chips", TEST_VAULTS).slugs).toEqual(["siliconx"]);
  });
});
