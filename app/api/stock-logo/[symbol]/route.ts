import { STOCK_LOGOS } from "@/lib/stockLogos";
import { readBoundedImage } from "@/lib/imageProxy";
import { guardedError, withWorkBudget, WorkRejected } from "@/lib/requestGuard";

// Logo proxy for the Automated LP stocks: fixed allowlist (lib/stockLogos.ts), PNG only, size-capped, edge-cached
// 30 days so the upstream is contacted about once a month per logo.
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = (await params).symbol.toUpperCase();
  const entry = STOCK_LOGOS[symbol];
  if (!entry?.url) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
  try {
    return await withWorkBudget("stock-logo", 1, { capacity: 16, refillPerSecond: 0.5, maxConcurrent: 4 }, async () => {
      const upstream = await fetch(entry.url!, { redirect: "error", signal: AbortSignal.timeout(6000), next: { revalidate: 2_592_000 } });
      const type = upstream.headers.get("content-type")?.split(";")[0] || "";
      if (!upstream.ok || type !== "image/png") throw new Error("Invalid logo");
      const bytes = await readBoundedImage(upstream);
      return new Response(bytes, { headers: {
        "Content-Type": "image/png", "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable", "X-Content-Type-Options": "nosniff",
      } });
    });
  } catch (error) {
    if (error instanceof WorkRejected) return guardedError(error);
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
