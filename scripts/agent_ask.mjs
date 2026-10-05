// Ask the local agent one question and print the reply, cards and cost. Usage:
//   node scripts/agent_ask.mjs "why is boost at its leverage?" [--wallet 0x..] [--page boost] [--model openai/gpt-oss-120b] [--dry]
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const text = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const base = opt("--base") ?? "http://127.0.0.1:3126";
const body = { messages: [{ role: "user", content: text }], wallet: opt("--wallet"), page: { vault: opt("--page"), path: "/" }, model: opt("--model"), dryRun: args.includes("--dry") };
const t0 = Date.now();
const r = await fetch(`${base}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-eval": "1" }, body: JSON.stringify(body) });
const j = await r.json();
console.log(`HTTP ${r.status} in ${Date.now() - t0} ms`);
console.log(JSON.stringify(j, (k, v) => (k === "data" && typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v), 2));
