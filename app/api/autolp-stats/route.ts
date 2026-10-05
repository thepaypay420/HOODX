import { AUTO_LP } from "@/lib/stockLp";
import { readAutoLpStats, type AutoLpStats } from "@/lib/autolpStats";

export async function GET() {
  if (!AUTO_LP.vault || !AUTO_LP.controller) return Response.json({ error: "not live" }, { status: 404 });
  let value: AutoLpStats;
  try {
    value = await readAutoLpStats();
  } catch (e) {
    console.error("autolp-stats", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
    return Response.json({ error: "stats temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
  }
  // short edge cache: the server-side cache already follows deposits and withdrawals (keyed by share supply)
  return Response.json(value, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60" } });
}
