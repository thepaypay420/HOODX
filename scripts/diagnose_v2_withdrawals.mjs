import { createPublicClient, formatEther, http, parseAbi } from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw new Error("ROBINHOOD_RPC_URL is required");

const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
const holder = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const vaults = {
  "696X": "0x531832cd20d33ee974afee7ba5720b8f3f2c9292",
  FAANGX: "0xcb40b8d79ff6f4c5db15bd8a9692b934b52cb0b0",
};
const vaultAbi = parseAbi([
  "function constituents() view returns(address[])",
  "function policy() view returns(address)",
  "function configId(address) view returns(bytes32)",
  "function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)",
  "function freeBalance(address) view returns(uint256)",
  "function totalAssets() view returns(uint256)",
  "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function owner() view returns(address)",
  "function withdraw(uint256,uint256,uint256) returns(uint256)",
  "function symbol() view returns(string)",
]);
const oracleAbi = parseAbi(["function value(address,uint256) view returns(uint256)"]);
const controllerAbi = parseAbi(["function rebalance(address,bool,uint256,uint256,uint256)"]);

function errorSummary(error) {
  const message = error?.shortMessage || error?.cause?.shortMessage || "reverted";
  const data = error?.data || error?.cause?.data || error?.cause?.cause?.data;
  return `${message}${typeof data === "string" ? ` (${data.slice(0, 10)})` : ""}`;
}

const blockNumber = await client.getBlockNumber();
console.log(`Chain ${await client.getChainId()} block ${blockNumber}`);
for (const [name, vault] of Object.entries(vaults)) {
  const read = { address: vault, abi: vaultAbi, blockNumber };
  const [tokens, policy, supply, shares, owner] = await Promise.all([
    client.readContract({ ...read, functionName: "constituents" }),
    client.readContract({ ...read, functionName: "policy" }),
    client.readContract({ ...read, functionName: "totalSupply" }),
    client.readContract({ ...read, functionName: "balanceOf", args: [holder] }),
    client.readContract({ ...read, functionName: "owner" }),
  ]);
  console.log(`\n${name}: ${tokens.length} tokens, ${formatEther(shares)} holder shares`);
  try {
    const assets = await client.readContract({ ...read, functionName: "totalAssets" });
    console.log(`  totalAssets: ${formatEther(assets)} ETH`);
  } catch (error) {
    console.log(`  totalAssets: FAIL ${errorSummary(error)}`);
  }
  for (const token of tokens) {
    const [symbol, balance, id] = await Promise.all([
      client.readContract({ address: token, abi: vaultAbi, blockNumber, functionName: "symbol" }).catch(() => token.slice(0, 8)),
      client.readContract({ ...read, functionName: "freeBalance", args: [token] }),
      client.readContract({ ...read, functionName: "configId", args: [token] }),
    ]);
    const [, oracle] = await client.readContract({ address: policy, abi: vaultAbi, blockNumber, functionName: "config", args: [id] });
    const amount = supply ? balance * shares / supply : 0n;
    try {
      const value = amount ? await client.readContract({ address: oracle, abi: oracleAbi, blockNumber, functionName: "value", args: [token, amount] }) : 0n;
      let route = "empty";
      if (amount) {
        try {
          await client.simulateContract({ address: owner, abi: controllerAbi, account: holder, blockNumber, functionName: "rebalance", args: [token, false, amount, 1n, BigInt(Math.floor(Date.now() / 1000) + 600)] });
          route = "sell OK";
        } catch (error) {
          route = `sell FAIL ${errorSummary(error)}`;
        }
      }
      console.log(`  ${symbol}: oracle OK ${formatEther(value)} ETH; ${route}; ${oracle}`);
    } catch (error) {
      console.log(`  ${symbol}: FAIL via ${oracle} ${errorSummary(error)}`);
    }
  }
  try {
    const result = await client.simulateContract({ address: vault, abi: vaultAbi, account: holder, blockNumber, functionName: "withdraw", args: [shares, 1n, BigInt(Math.floor(Date.now() / 1000) + 600)] });
    console.log(`  full withdrawal: OK ${formatEther(result.result)} ETH`);
  } catch (error) {
    console.log(`  full withdrawal: FAIL ${errorSummary(error)}`);
  }
}
