import { z } from "zod";
import { runAgent } from "@/lib/agent/run";
import { admitWork, guardedError, withWorkBudget } from "@/lib/requestGuard";

/* The on-page HOODX assistant. POST { messages, wallet?, page? } → { reply, cards, meta }. The model only proposes; code
 * checks, builds, simulates and verifies every transaction, and the user signs in their own wallet. */
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(30),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  page: z.object({ path: z.string().max(200).optional(), vault: z.string().max(40).optional() }).optional(),
  dryRun: z.boolean().optional(),
  model: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const body = parsed.data;
  if (body.messages[body.messages.length - 1].role !== "user") return Response.json({ error: "The last message must be the user's." }, { status: 400 });

  // the model override and dry runs are for the local test harness only
  const local = process.env.NODE_ENV !== "production";
  if (!local) { delete body.model; delete body.dryRun; }

  const who = (request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anon") + (body.wallet ? `:${body.wallet.toLowerCase()}` : "");
  try {
    // per visitor: 30 messages an hour, 2 at a time; site-wide: a steady ceiling on model spend
    const run = async () => Response.json(await runAgent(body, new URL(request.url).origin), { headers: { "Cache-Control": "no-store" } });
    if (local && request.headers.get("x-agent-eval") === "1") return await run();   // the local test harness
    const releaseClient = admitWork(`agent:${who}`, 1, { capacity: 30, refillPerSecond: 30 / 3600, maxConcurrent: 2 });
    try { return await withWorkBudget("agent", 1, { capacity: 120, refillPerSecond: 1, maxConcurrent: 12 }, run); }
    finally { releaseClient(); }
  } catch (error) {
    return guardedError(error);
  }
}
