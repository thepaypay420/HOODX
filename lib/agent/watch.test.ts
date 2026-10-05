import { describe, expect, it } from "vitest";
import { checkWatch } from "./guard";
import { TEST_VAULTS } from "./guardCases";
import { evaluate } from "./watch";
import { FIRE_CASES, WATCH_GUARD_CASES } from "./watchCases";

describe("watch rules fire exactly when they should", () => {
  for (const c of FIRE_CASES) it(c.name, () => expect(evaluate(c.rule, c.state, c.baseline) !== null).toBe(c.fires));
});
describe("watch rules use only the user's numbers", () => {
  for (const c of WATCH_GUARD_CASES) it(c.name, () => expect(checkWatch(c.rule, c.msgs, TEST_VAULTS, c.page).decision === "ok").toBe(c.ok));
});
