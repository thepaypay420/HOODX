// Live check of the on-page agent: real requests, real wallet, real chain. Every proposal card's transaction is simulated
// with eth_call from the wallet, and its target and value are checked against what was asked. Nothing is signed or sent.
// Usage: node scripts/agent_onchain.mjs [baseUrl] [wallet]
import { createPublicClient, http, parseEther, formatEther } from "viem";

const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://127.0.0.1:3126";
const wallet = process.argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) ?? "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const chain = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const VAULT = { boost: "0x5e0135C3592095592C4B43d84c817c26A0F43515", autolp: "0x67D2327eA0C42Cf92C4601ebc59df0F3e9b2aa80", "696x": "0xb645A727ed525321509Ec16aa011D38E52f99a93" };

const CASES = [
  { q: "put 0.01 eth into boosted eth", vault: "boost", eth: "0.01" },
  { q: "deposit 0.005 ETH in hands-free lp", vault: "autolp", eth: "0.005" },
  { q: "add 0.02 eth to 696x", vault: "696x", eth: "0.02" },
  { q: "put $20 into boost", vault: "boost", usd: true },
  { q: "withdraw 10% of my boost", vault: "boost", eth: "0" },
  { q: "take 10 percent out of hands free lp", vault: "autolp", eth: "0" },
  { q: "sell 10% of my 696x", vault: "696x", eth: "0" },
  { q: "deposit 0.01", page: "boost", vault: "boost", eth: "0.01" },
  { q: "put 3 eth into boost", expect: "notice" },          // more than the wallet holds
  { q: "put 0.1 eth in the stack", expect: "clarify" },     // ambiguous
];

let fails = 0;
for (const c of CASES) {
  const r = await fetch(`${base}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-eval": "1" }, body: JSON.stringify({ messages: [{ role: "user", content: c.q }], wallet, page: { vault: c.page, path: "/" } }) });
  const j = await r.json();
  const card = j.cards?.find((k) => k.type === "proposal");
  const kinds = (j.cards ?? []).map((k) => k.type).join(",") || "none";
  if (c.expect) {
    const good = kinds.includes(c.expect) && !card;
    if (!good) fails++;
    console.log(`${good ? "PASS" : "FAIL"}  "${c.q}" -> ${kinds}: ${j.reply}`);
    continue;
  }
  if (!card) { fails++; console.log(`FAIL  "${c.q}" -> no proposal (${kinds}): ${j.reply}`); continue; }
  const t = card.tx, issues = [];
  if (t.to.toLowerCase() !== VAULT[c.vault].toLowerCase()) issues.push(`wrong contract ${t.to}`);
  if (t.from.toLowerCase() !== wallet.toLowerCase()) issues.push("wrong wallet");
  if (!c.usd && BigInt(t.value) !== parseEther(c.eth)) issues.push(`value ${formatEther(BigInt(t.value))} != ${c.eth}`);
  try { await chain.call({ account: t.from, to: t.to, data: t.data, value: BigInt(t.value) }); } catch (e) { issues.push(`does not simulate: ${e.shortMessage ?? e.message}`); }
  if (issues.length) fails++;
  console.log(`${issues.length ? "FAIL" : "PASS"}  "${c.q}" -> ${card.headline} | ${card.rows.map((x) => x.join(" ")).join(" · ")}${issues.length ? "\n      " + issues.join("; ") : " | simulates on-chain ✓"}`);
}
console.log(`\n${CASES.length - fails}/${CASES.length} live checks pass`);
process.exit(fails ? 1 : 0);
