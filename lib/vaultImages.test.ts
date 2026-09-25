import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FEATURED_VAULTS } from "@/lib/vaults";

type TokenList = {
  tokens: Array<{ symbol: string; logoURI: string }>;
};

describe("vault artwork", () => {
  it("assigns a unique production image to every featured vault", () => {
    const images = FEATURED_VAULTS.map((vault) => vault.image);

    expect(new Set(images).size).toBe(FEATURED_VAULTS.length);
    for (const image of images) {
      expect(image).toMatch(/^\/vaults\/[a-z0-9-]+\.png$/);
      expect(existsSync(join(process.cwd(), "public", image))).toBe(true);
    }
  });

  it("publishes canonical wallet artwork for every live vault", () => {
    const tokenList = JSON.parse(
      readFileSync(join(process.cwd(), "public", "hoodx-token-list.json"), "utf8"),
    ) as TokenList;

    const logosBySymbol = new Map(
      tokenList.tokens.map((token) => [token.symbol, token.logoURI]),
    );

    for (const vault of FEATURED_VAULTS.filter(({ status }) => status === "live")) {
      expect(logosBySymbol.get(vault.symbol)).toBe(
        `https://www.xhoodindex.com${vault.image}`,
      );
    }
  });
});
