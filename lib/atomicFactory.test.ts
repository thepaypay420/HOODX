import { describe, expect, it } from "vitest";
import { encodeFunctionData, zeroAddress } from "viem";
import { atomicFactoryAbi } from "./atomicFactory";

describe("atomic successor factory", () => {
  it("encodes vault and controller creation as one call", () => {
    const id = `0x${"11".repeat(32)}` as const;
    const encoded = encodeFunctionData({
      abi: atomicFactoryAbi,
      functionName: "createAtomic",
      args: [
        "community",
        {
          curator: zeroAddress,
          creator: zeroAddress,
          recipient: zeroAddress,
          treasury: zeroAddress,
          name: "Community",
          symbol: "CMNTY",
          creatorFee: 40,
          protocolFee: 10,
          cashBps: 2500,
          firstDeposit: 20_000_000_000_000_000n,
          imageURI: "",
        },
        [id, id],
        [3750, 3750],
      ],
    });
    expect(encoded.startsWith("0x")).toBe(true);
    expect(encoded.length).toBeGreaterThan(10);
  });
});
