import { getHoldingMarket } from "@/lib/holdingMarketServer";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) return new Response(null, { status: 400 });
  try {
    const market = await getHoldingMarket(token);
    if (!market.image) return new Response(null, { status: 404 });
    const image = await fetch(market.image, { redirect: "error", signal: AbortSignal.timeout(8000), next: { revalidate: 604800 } });
    const type = image.headers.get("content-type")?.split(";")[0] || "";
    if (!image.ok || !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new Error("Invalid image");
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength > 2_000_000) throw new Error("Image too large");
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, s-maxage=604800", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 502 }); }
}
