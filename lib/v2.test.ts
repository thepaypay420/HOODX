import { describe, it, expect } from "vitest";
import { encodeFunctionData } from "viem";
import manifest from "../deployments/robinhood-4663-v2.json";
import factory from "../deployments/abi/HoodxFactoryV2.json";
import { productionV2Factory, productionV2Treasury, verifiedV2Vaults, v2FactoryAbi } from "./v2";

describe("V2 production activation", () => {
  it("uses verified production addresses, not the disposable canaries", () => {
    expect(productionV2Factory).toBe(manifest.production.factory);
    expect(verifiedV2Vaults["696x"]).toBe(manifest.production.vault696x);
    expect(verifiedV2Vaults.faangx).toBe(manifest.production.vaultFaangx);
    expect(Object.values(verifiedV2Vaults)).not.toContain(manifest.canary.vault696x);
    expect(Object.values(verifiedV2Vaults)).not.toContain(manifest.canary.vaultFaangx);
  });
  it("encodes creation exactly like the compiled V2 factory", () => {
    const owner = productionV2Treasury;
    const p = { curator: owner, creator: owner, recipient: owner, treasury: owner, name: "Example", symbol: "EX", creatorFee: 40, protocolFee: 10, cashBps: 2500, firstDeposit: 20000000000000000n, imageURI: "" };
    const ids = [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`] as const;
    const encoded = encodeFunctionData({ abi: v2FactoryAbi, functionName: "create", args: ["example", p, ids, [3750,3750]] });
    const compiled = encodeFunctionData({ abi: factory.abi, functionName: "create", args: ["example", { ...p, image: p.imageURI }, ids, [3750,3750]] });
    expect(encoded).toBe(compiled);
  });
});

