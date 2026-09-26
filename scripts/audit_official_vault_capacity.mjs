import fs from "node:fs";
import { BaseError, ContractFunctionRevertedError, createPublicClient, formatEther, http, parseAbi } from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw new Error("ROBINHOOD_RPC_URL is required");

const live = JSON.parse(fs.readFileSync("deployments/official-vault-live-2026-09-24.json", "utf8"));
const catalog = JSON.parse(fs.readFileSync("deployments/official-vault-catalog-2026-09-24.json", "utf8"));
const curator = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const sizes = [20_000_000_000_000_000n, 100_000_000_000_000_000n, 500_000_000_000_000_000n, 1_000_000_000_000_000_000n];
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 1 }) });
const symbolByToken = new Map(catalog.assets.map((asset) => [asset.token.toLowerCase(), asset.symbol]));
const abi = parseAbi([
  "function constituents() view returns(address[])",
  "function targetBps(address) view returns(uint16)",
  "function creatorFeeBps() view returns(uint16)",
  "function protocolFeeBps() view returns(uint16)",
  "function planNonce() view returns(uint256)",
  "function minFirstDeposit() view returns(uint256)",
  "function totalSupply() view returns(uint256)",
  "function quoteBuys(uint256[] budgets) payable",
  "function bootstrap(uint256[] floors,uint256 nonce,uint256 deadline) payable returns(uint256)",
  "error BuyQuote(uint256[] outputs)",
]);

function quotedOutputs(error) {
  const reverted = error instanceof BaseError ? error.walk((item) => item instanceof ContractFunctionRevertedError) : undefined;
  if (!(reverted instanceof ContractFunctionRevertedError) || reverted.data?.errorName !== "BuyQuote") throw error;
  return reverted.data.args[0];
}

const block = await client.getBlock();
const stateOverride = [{ address: curator, balance: 10_000_000_000_000_000_000n }];
const results = [];
for (const [slug, entry] of Object.entries(live.vaults)) {
  const address = entry.vault;
  const [tokens, creatorFee, protocolFee, nonce, minimum, supply] = await Promise.all([
    client.readContract({ address, abi, functionName: "constituents", blockNumber: block.number }),
    client.readContract({ address, abi, functionName: "creatorFeeBps", blockNumber: block.number }),
    client.readContract({ address, abi, functionName: "protocolFeeBps", blockNumber: block.number }),
    client.readContract({ address, abi, functionName: "planNonce", blockNumber: block.number }),
    client.readContract({ address, abi, functionName: "minFirstDeposit", blockNumber: block.number }),
    client.readContract({ address, abi, functionName: "totalSupply", blockNumber: block.number }),
  ]);
  const weights = await Promise.all(tokens.map((token) => client.readContract({ address, abi, functionName: "targetBps", args: [token], blockNumber: block.number })));
  const checks = [];
  for (const gross of sizes) {
    const net = gross * (10_000n - BigInt(creatorFee) - BigInt(protocolFee)) / 10_000n;
    const budgets = weights.map((weight) => net * BigInt(weight) / 10_000n);
    const funding = budgets.reduce((sum, value) => sum + value, 0n);
    try {
      await client.simulateContract({ address, abi, account: curator, functionName: "quoteBuys", args: [budgets], value: funding, blockNumber: block.number, stateOverride });
      throw new Error("quote unexpectedly returned");
    } catch (error) {
      const outputs = quotedOutputs(error);
      const floors = outputs.map((output) => output * 9_700n / 10_000n);
      let status = "PASS";
      try {
        await client.simulateContract({ address, abi, account: curator, functionName: "bootstrap", args: [floors, nonce, block.timestamp + 300n], value: gross, blockNumber: block.number, stateOverride });
      } catch (bootstrapError) {
        status = bootstrapError.shortMessage ?? bootstrapError.message;
      }
      checks.push({ grossEth: formatEther(gross), largestSleeveEth: formatEther(budgets.reduce((a, b) => a > b ? a : b)), status, budgets, outputs });
    }
  }
  const baseline = checks[0];
  const stressed = checks.at(-1);
  const oneEthQuoteRetention = tokens.map((token, index) => ({
    symbol: symbolByToken.get(token.toLowerCase()) ?? token,
    bps: Number(stressed.outputs[index] * baseline.budgets[index] * 10_000n / (baseline.outputs[index] * stressed.budgets[index])),
  })).sort((a, b) => a.bps - b.bps);
  results.push({
    slug,
    vault: address,
    supply: String(supply),
    minimumEth: formatEther(minimum),
    oneEthWorstAsset: oneEthQuoteRetention[0].symbol,
    oneEthWorstQuoteRetentionBps: oneEthQuoteRetention[0].bps,
    oneEthQuoteRetention,
    checks: checks.map(({ grossEth, largestSleeveEth, status }) => ({ grossEth, largestSleeveEth, status })),
  });
}

const liquidity = catalog.assets.map((asset) => Number(asset.route.displayLiquidityUsd)).sort((a, b) => a - b);
const report = {
  chainId: await client.getChainId(),
  block: String(block.number),
  checkedAt: new Date().toISOString(),
  topology: {
    assets: catalog.assets.length,
    directWeth: catalog.assets.filter((asset) => asset.route.quote.toLowerCase() === "0x0bd7d308f8e1639fab988df18a8011f41eacad73").length,
    sharedUsdgBridge: catalog.assets.filter((asset) => asset.route.quote.toLowerCase() === "0x5fc5360d0400a0fd4f2af552add042d716f1d168").length,
    minimumRecordedPoolLiquidityUsd: liquidity[0],
    medianRecordedPoolLiquidityUsd: liquidity[Math.floor(liquidity.length / 2)],
    weakestPools: catalog.assets.sort((a, b) => Number(a.route.displayLiquidityUsd) - Number(b.route.displayLiquidityUsd)).slice(0, 10).map((asset) => ({ symbol: asset.symbol, liquidityUsd: asset.route.displayLiquidityUsd, pool: asset.route.pool })),
  },
  results,
};
fs.writeFileSync("deployments/official-vault-capacity-audit-2026-09-25.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (results.some((result) => result.supply !== "0" || result.checks.some((check) => check.status !== "PASS"))) process.exit(1);
