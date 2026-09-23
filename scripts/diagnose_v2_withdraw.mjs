import { createPublicClient, http, parseAbi } from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL;
const vault = process.argv[2];
if (!rpc || !/^0x[0-9a-fA-F]{40}$/.test(vault ?? "")) {
  throw new Error("Usage: ROBINHOOD_RPC_URL=<private> node scripts/diagnose_v2_withdraw.mjs <vault>");
}

const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const abi = parseAbi([
  "function constituents() view returns(address[])",
  "function policy() view returns(address)",
  "function configId(address) view returns(bytes32)",
  "function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)",
  "function freeBalance(address) view returns(uint256)",
  "function value(address,uint256) view returns(uint256)",
  "function symbol() view returns(string)",
  "function pool() view returns(address)",
  "function bridge() view returns(address)",
  "function minLiquidity() view returns(uint128)",
  "function minBridgeLiquidity() view returns(uint128)",
  "function liquidity() view returns(uint128)",
]);

if (await client.getChainId() !== 4663) throw new Error("Wrong network");
const blockNumber = await client.getBlockNumber();
const common = { abi, blockNumber };
const policy = await client.readContract({ ...common, address: vault, functionName: "policy" });
const tokens = await client.readContract({ ...common, address: vault, functionName: "constituents" });
const report = [];
for (const token of tokens) {
  const [id, balance, symbol] = await Promise.all([
    client.readContract({ ...common, address: vault, functionName: "configId", args: [token] }),
    client.readContract({ ...common, address: vault, functionName: "freeBalance", args: [token] }),
    client.readContract({ ...common, address: token, functionName: "symbol" }).catch(() => token),
  ]);
  if (balance === 0n) continue;
  const config = await client.readContract({ ...common, address: policy, functionName: "config", args: [id] });
  try {
    const value = await client.readContract({ ...common, address: config[1], functionName: "value", args: [token, balance] });
    report.push({ symbol, token, oracle: config[1], status: "ok", value: String(value) });
  } catch (error) {
    const pool = await client.readContract({ ...common, address: config[1], functionName: "pool" }).catch(() => undefined);
    const bridge = await client.readContract({ ...common, address: config[1], functionName: "bridge" }).catch(() => undefined);
    const source = async (address, minimumFunction) => address && address !== "0x0000000000000000000000000000000000000000" ? {
      address,
      minimum: String(await client.readContract({ ...common, address: config[1], functionName: minimumFunction }).catch(() => -1n)),
      current: String(await client.readContract({ ...common, address, functionName: "liquidity" }).catch(() => -1n)),
    } : undefined;
    report.push({
      symbol, token, oracle: config[1], status: "invalid-reference",
      pool: await source(pool, "minLiquidity"),
      bridge: await source(bridge, "minBridgeLiquidity"),
      reason: error instanceof Error ? error.message.match(/0x[0-9a-fA-F]{8}/)?.[0] ?? "read reverted" : "read reverted",
    });
  }
}
console.log(JSON.stringify({ chainId: 4663, blockNumber: String(blockNumber), vault, report }, null, 2));
