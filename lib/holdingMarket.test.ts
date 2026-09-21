import { describe, expect, it } from "vitest";
import { selectMarket, compactCap } from "./holdingMarket";
describe("holdings market data", () => {
  it("uses the matching base token on Robinhood and the deepest pool", () => {
    const pair = { chainId: "robinhood", baseToken: { address: "0xABC", name: "Coin" }, marketCap: 123, liquidity: { usd: 10 } };
    expect(selectMarket([{ ...pair, chainId: "ethereum", marketCap: 999 }, { ...pair, baseToken: { address: "other" }, marketCap: 999 }, pair, { ...pair, liquidity: { usd: 20 }, marketCap: 456 }], "0xabc", 1)).toMatchObject({ marketCap: 456, updatedAt: 1 });
  });
  it("does not substitute FDV or invent missing market caps", () => {
    expect(selectMarket([], "0xabc").marketCap).toBeNull();
    expect(compactCap(null)).toBe("—");
    expect(compactCap(411_400_000)).toBe("$411.4M");
  });
  it("accepts only the image CDN and rejects arbitrary remote URLs", () => {
    const pair = { chainId: "robinhood", baseToken: { address: "a" } };
    for (const imageUrl of ["http://cdn.dexscreener.com/a", "https://evil.com/a", "https://cdn.dexscreener.com.evil.com/a", "https://user:pass@cdn.dexscreener.com/a"]) expect(selectMarket([{ ...pair, info: { imageUrl } }], "a").image).toBeNull();
    expect(selectMarket([{ ...pair, info: { imageUrl: "https://cdn.dexscreener.com/a.png" } }], "a").image).toBe("https://cdn.dexscreener.com/a.png");
  });
});
