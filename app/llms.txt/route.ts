import { HOODX_LLM_REFERENCE } from "@/lib/llmConnect";

export const dynamic = "force-static";

export function GET() {
  return new Response(HOODX_LLM_REFERENCE, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
