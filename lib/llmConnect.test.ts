import { describe, expect, it } from "vitest";
import { HOODX_AGENT_PROMPT, HOODX_LLM_REFERENCE } from "./llmConnect";

describe("HOODX agent connection reference", () => {
  it("pins the production network and atomic factory", () => {
    expect(HOODX_LLM_REFERENCE).toContain("Chain ID: 4663");
    expect(HOODX_LLM_REFERENCE).toContain("0x29349c79863b58e7ab470865f7c6df0b31dc7c17");
  });
  it("covers holder, curator, atomic, and launch actions", () => {
    for (const action of ["depositExactShares", "emergencyRedeemInKind", "atomicRebalance", "createAtomic", "addConstituent", "claim(address token,address recipient)"]) expect(HOODX_LLM_REFERENCE).toContain(action);
  });
  it("requires simulation and keeps signing with the user", () => {
    expect(HOODX_AGENT_PROMPT).toContain("simulate");
    expect(HOODX_AGENT_PROMPT).toContain("Never ask for or handle a seed phrase or private key");
    expect(HOODX_LLM_REFERENCE).toContain("let the user approve and sign in their own wallet");
  });
});
