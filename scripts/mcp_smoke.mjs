// End-to-end check of the HOODX MCP server with the official MCP client: list tools, call every one, and verify that each
// returned transaction simulates on-chain from the user's address. Read-only: nothing is signed or sent.
// Usage: node scripts/mcp_smoke.mjs [baseUrl] [wallet]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPublicClient, http } from "viem";

const base = process.argv[2] ?? "http://127.0.0.1:3126";
const wallet = process.argv[3] ?? "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const chain = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });

const client = new Client({ name: "hoodx-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
const info = client.getServerVersion(), instr = client.getInstructions();
console.log("server:", info?.name, info?.version, "| instructions:", instr ? `${instr.length} chars` : "none");
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const { resources } = await client.listResources();
console.log("resources:", resources.map((r) => r.uri).join(", "));

let failures = 0;
async function call(name, args = {}, expectOk = true) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const body = r.content?.[0]?.text ?? "";
  const ms = Date.now() - t0;
  let data; try { data = JSON.parse(body); } catch { data = body; }
  const ok = !r.isError;
  if (ok !== expectOk) failures++;
  console.log(`\n== ${name} ${JSON.stringify(args)} -> ${ok ? "OK" : "ERROR"} (${ms} ms)${ok !== expectOk ? "  <-- UNEXPECTED" : ""}`);
  console.log(typeof data === "string" ? data.slice(0, 600) : JSON.stringify(data, null, 1).slice(0, 1400));
  return data;
}
async function verifyTx(label, q) {
  if (!q?.transaction) { console.log(`   (no transaction to verify for ${label})`); return; }
  const t = q.transaction;
  try {
    await chain.call({ account: t.from, to: t.to, data: t.data, value: BigInt(t.value) });
    console.log(`   ✓ ${label}: returned transaction simulates successfully on-chain from ${t.from.slice(0, 8)}…`);
  } catch (e) { failures++; console.log(`   ✗ ${label}: transaction does NOT simulate: ${e.shortMessage ?? e.message}`); }
}

await call("hoodx_overview");
await call("hoodx_list_vaults", { type: "all" });
await call("hoodx_get_vault", { vault: "boost" });
await call("hoodx_get_vault", { vault: "autolp" });
await call("hoodx_get_vault", { vault: "$AIX" });
await call("hoodx_get_vault", { vault: "696x" });
await call("hoodx_boost_signal");
await call("hoodx_get_positions", { address: wallet });
await call("hoodx_how_to_fund");
await verifyTx("boost deposit", await call("hoodx_quote_deposit", { vault: "boost", amountEth: "0.005", address: wallet }));
await verifyTx("autolp deposit", await call("hoodx_quote_deposit", { vault: "autolp", amountEth: "0.005", address: wallet }));
await verifyTx("696x deposit", await call("hoodx_quote_deposit", { vault: "696x", amountEth: "0.02", address: wallet }));
await call("hoodx_quote_deposit", { vault: "aistack", amountEth: "0.02", address: "0x000000000000000000000000000000000000dEaD" });
await verifyTx("boost withdraw 10%", await call("hoodx_quote_withdraw", { vault: "boost", address: wallet, percent: 10 }));
await verifyTx("autolp withdraw 10%", await call("hoodx_quote_withdraw", { vault: "autolp", address: wallet, percent: 10 }));
await verifyTx("696x withdraw 10%", await call("hoodx_quote_withdraw", { vault: "696x", address: wallet, percent: 10 }));
// curator tools
await call("hoodx_asset_universe", { kind: "stock" });
await call("hoodx_backtest_basket", { assets: ["NVDA", "TSM", "AVGO"], cashPct: 25, days: 90 });
await call("hoodx_backtest_basket", { assets: ["PONS", "NVDA"], cashPct: 25, days: 30 }, false);
await call("hoodx_curator_status", { vault: "696x", address: wallet });
await call("hoodx_curator_status", { vault: "aistack" });
await verifyTx("696x rebalance to targets", await call("hoodx_prepare_rebalance", { vault: "696x", curator: wallet }));
await call("hoodx_prepare_rebalance", { vault: "696x", curator: "0x000000000000000000000000000000000000dEaD" }, false);
await verifyTx("aistack pause", await call("hoodx_prepare_curator_action", { vault: "aistack", curator: wallet, action: "pause" }));
await verifyTx("aistack set targets", await call("hoodx_prepare_curator_action", { vault: "aistack", curator: wallet, action: "set_targets", targets: { NVDA: 25, META: 10, PLTR: 10, MSFT: 15, GOOGL: 15 }, cashPct: 25 }));
await verifyTx("aistack add AMD", await call("hoodx_prepare_curator_action", { vault: "aistack", curator: wallet, action: "add_asset", asset: "AMD" }));
await verifyTx("launch test index", await call("hoodx_prepare_launch", { curator: wallet, slug: `mcp${Date.now().toString(36).slice(-8)}`, name: "MCP test chips", ticker: "MCPT", assets: ["NVDA", "TSM", "AVGO"], cashPct: 25, creatorFeePct: 0.4 }));
await call("hoodx_prepare_launch", { curator: wallet, slug: "aistack", name: "Dup", ticker: "DUP", assets: ["NVDA", "TSM"], cashPct: 25, creatorFeePct: 0.4 }, false);
// expected failures: bad input is rejected cleanly
await call("hoodx_get_vault", { vault: "nonexistent-vault" }, false);
await call("hoodx_quote_deposit", { vault: "boost", amountEth: "0.005", address: "0x123" }, false);
await client.close();
console.log(`\nDONE: ${failures === 0 ? "all checks passed" : failures + " unexpected result(s)"}`);
process.exit(failures === 0 ? 0 : 1);
