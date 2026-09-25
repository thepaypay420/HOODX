import { getHoldingMarket } from "@/lib/holdingMarketServer";
import { guardedError, withWorkBudget, WorkRejected } from "@/lib/requestGuard";
import { approvedImageUrl, readBoundedImage } from "@/lib/imageProxy";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) return new Response(null, { status: 400 });
  try {
    return await withWorkBudget("holding-image", 1, { capacity: 24, refillPerSecond: 0.4, maxConcurrent: 3 }, async () => {
      const market = await getHoldingMarket(token);
      if (!market.image) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=300, s-maxage=900" } });
      const image = await fetch(approvedImageUrl(market.image), { redirect: "error", signal: AbortSignal.timeout(6000), next: { revalidate: 604800 } });
      const type = image.headers.get("content-type")?.split(";")[0] || "";
      if (!image.ok || !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new Error("Invalid image");
      const bytes = await readBoundedImage(image);
      return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, s-maxage=604800", "X-Content-Type-Options": "nosniff" } });
    });
  } catch (error) {
    if (error instanceof WorkRejected) return guardedError(error);
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
