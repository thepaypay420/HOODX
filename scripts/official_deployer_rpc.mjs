import fs from "node:fs";

const rpcUrl = fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim();
const [mode, argument] = process.argv.slice(2);

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `RPC ${response.status}`);
  return body.result;
}

if (mode === "nonce") {
  if (!/^0x[0-9a-fA-F]{40}$/.test(argument || "")) throw new Error("Invalid account");
  console.log(await rpc("eth_getTransactionCount", [argument, "pending"]));
} else if (mode === "send") {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  raw = raw.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error("Invalid signed transaction");
  console.log(await rpc("eth_sendRawTransaction", [raw]));
} else {
  throw new Error("Expected nonce <address> or send");
}
