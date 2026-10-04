import { describe, expect, it } from "vitest";
import { HOODX_AGENT_PROMPT, HOODX_LLM_REFERENCE } from "./llmConnect";

describe("HOODX agent connection reference", () => {
  it("pins the production network and atomic factory", () => {
    expect(HOODX_LLM_REFERENCE).toContain("Chain ID: 4663");
    expect(HOODX_LLM_REFERENCE).toContain("0x29349c79863b58e7ab470865f7c6df0b31dc7c17");
  });
  it("covers holder, curator, atomic, and launch actions", () => {
    for (const action of ["depositExactShares", "emergencyRedeemInKind", "atomicRebalance", "createAtomic", "addConstituent", "claim(address token,address recipient)", "proposeCurator", "releaseVault", "setImageURI", "transferFrom"]) expect(HOODX_LLM_REFERENCE).toContain(action);
  });
  it("covers Boosted ETH, Hands-free LP, every official collection and the data endpoints", () => {
    for (const s of ["exitInKind", "previewExitInKind", "depositEth", "exitToSleeveShares", "/api/platform-tvl", "/api/collection-returns", "0x5e0135C3592095592C4B43d84c817c26A0F43515", "0x67D2327eA0C42Cf92C4601ebc59df0F3e9b2aa80"]) expect(HOODX_LLM_REFERENCE).toContain(s);
    for (const slug of ["696x", "faangx", "chainfin", "consumerx"]) expect(HOODX_LLM_REFERENCE).toContain(slug);
  });
  it("requires simulation and keeps signing with the user", () => {
    expect(HOODX_AGENT_PROMPT).toContain("simulate");
    expect(HOODX_AGENT_PROMPT).toContain("Never ask for or handle a seed phrase or private key");
    expect(HOODX_LLM_REFERENCE).toContain("let the user approve and sign in their own wallet");
  });
});
