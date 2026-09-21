import { expect, it } from "vitest";
import { withdrawalFloor } from "./withdrawMinimum";
it("Max uses all shares without decimal truncation and keeps the 99% NAV floor", () => {
  const shares = 1990785288352581025n;
  expect(withdrawalFloor(80000000000000000n, shares, shares, 100)).toEqual({ selected: shares, floor: 79200000000000000n });
});
it("partial exits scale both share selection and output protection", () => {
  expect(withdrawalFloor(10000n, 100n, 100n, 25)).toEqual({ selected: 25n, floor: 2475n });
  expect(withdrawalFloor(10000n, 100n, 0n, 100).floor).toBe(0n);
  expect(withdrawalFloor(10000n, 100n, 100n, 101).floor).toBe(0n);
});
