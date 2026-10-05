/* One call to an OpenAI-compatible chat API (OpenRouter by default). The key lives only on the server. OpenRouter is
 * asked for the cheapest host that supports every parameter we send (tools included), and falls over to the next host
 * if one is down. */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } };

/** The default model and the stronger one used when the first stumbles. Both chosen by scripts/agent_eval.mjs. */
export const MODELS = {
  primary: process.env.AGENT_MODEL || "openai/gpt-oss-120b",
  // a different model, same host family: no new-account rate limits (Anthropic models are capped at 20 req/min for new
  // OpenRouter accounts). Switch to Haiku with AGENT_MODEL_FALLBACK once that lifts.
  fallback: process.env.AGENT_MODEL_FALLBACK || "openai/gpt-oss-20b",
};

export async function chat(model: string, messages: Msg[], tools: ToolDef[], signal?: AbortSignal) {
  const key = process.env.AGENT_API_KEY;
  if (!key) throw new Error("The assistant is not configured (AGENT_API_KEY).");
  const base = (process.env.AGENT_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = { model, messages, tools, tool_choice: "auto", temperature: 0, max_tokens: 900, usage: { include: true } };
  if (base.includes("openrouter.ai")) body.provider = { sort: "price", require_parameters: true, allow_fallbacks: true };
  if (/gpt-oss/.test(model)) body.reasoning = { effort: "low" };
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://www.xhoodindex.com", "X-Title": "HOODX" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null) as { choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } } | null;
  if (!r.ok || !j?.choices?.[0]) throw new Error(`Model error ${r.status}: ${j?.error?.message ?? "no response"}`);
  return { message: j.choices[0].message, tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0, costUsd: j.usage?.cost ?? 0 };
}
