import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {
    // Coinbase's Base Account SDK (pulled in by wagmi's connectors, unused here) imports the CDP server SDK for payment
    // helpers HOODX never calls; that SDK imports packages that are not installed. Resolve it to a small stub.
    resolveAlias: { "@coinbase/cdp-sdk": "./lib/empty-module.ts" },
  },
  async headers() {
    // Logo URLs are content-hashed by scripts/fetch_logos.py, so they can be cached forever.
    return [{ source: "/logos/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;
