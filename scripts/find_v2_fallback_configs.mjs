import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw new Error("ROBINHOOD_RPC_URL is required");
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
const policy = "0x8e36fb11545fc1683f35a079d3f9f1a715dbec70";
const assets = {
  AMZN: "0x12f190a9f9d7d37a250758b26824b97ce941bf54",
  GOOGL: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
};
const event = parseAbiItem("event ConfigApproved(bytes32 indexed id,address indexed token,address oracle,bytes32 evidence)");
const abi = parseAbi([
  "function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)",
  "function value(address,uint256) view returns(uint256)",
]);
const blockNumber = await client.getBlockNumber();
for (const [symbol, token] of Object.entries(assets)) {
  const logs = [];
  for (let from = 67_000_000n; from <= blockNumber; from += 10_000n) {
    const to = from + 9_999n > blockNumber ? blockNumber : from + 9_999n;
    logs.push(...await client.getLogs({ address: policy, event, args: { token }, fromBlock: from, toBlock: to }));
  }
  console.log(`\n${symbol}: ${logs.length} approved configuration(s)`);
  for (const log of logs) {
    const id = log.args.id;
    const [, oracle] = await client.readContract({ address: policy, abi, blockNumber, functionName: "config", args: [id] });
    try {
      const value = await client.readContract({ address: oracle, abi, blockNumber, functionName: "value", args: [token, 10n ** 18n] });
      console.log(`  HEALTHY id=${id} oracle=${oracle} value=${value}`);
    } catch (error) {
      const selector = (error?.data || error?.cause?.data || error?.cause?.cause?.data || "").slice(0, 10);
      console.log(`  failed id=${id} oracle=${oracle} selector=${selector || "unknown"}`);
    }
  }
}
