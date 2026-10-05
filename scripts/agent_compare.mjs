// Side-by-side answers from several models to the same free-form questions, to judge reply quality by eye.
// Usage: node scripts/agent_compare.mjs model1,model2 [baseUrl]
const models = (process.argv[2] ?? "openai/gpt-oss-120b,mistralai/mistral-nemo").split(",");
const base = process.argv[3] ?? "http://127.0.0.1:3126";
const WALLET = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const QS = [
  { q: "Why is Boosted ETH at its current leverage?" },
  { q: "What's in my vaults and how are they doing?", wallet: true },
  { q: "How does Hands-free LP make money?" },
  { q: "Which indexes hold NVIDIA?" },
  { q: "Is 696X risky?" },
  { q: "Should I put all my money in boost?" },
  { q: "What happens to Boosted ETH if ETH drops 10%?" },
];
for (const { q, wallet } of QS) {
  console.log(`\n### ${q}`);
  for (const model of models) {
    const r = await fetch(`${base}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-eval": "1" }, body: JSON.stringify({ messages: [{ role: "user", content: q }], wallet: wallet ? WALLET : undefined, page: { path: "/" }, model }) });
    const j = await r.json();
    console.log(`- ${model.split("/")[1]} [${(j.meta?.tools ?? []).join(",") || "no tools"}${j.meta?.fallback ? ", FALLBACK" : ""}; ${j.meta?.ms} ms]: ${j.reply}`);
  }
}
