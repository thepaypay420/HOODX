import fs from "node:fs";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";

throw new Error(
  "RETIRED: the existing canary contains the legacy QUOTIENT token and must not receive another bootstrap or deposit.",
);

const rpc = process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim();
const deployer = getAddress("0xf63E63a80A25611154C5d1c06E55FD763E0cfC19");
const curator = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const factory = getAddress("0xb0a89074d2f88207698aC99f39061463eeabeC8a");
const canary = getAddress("0x64C9cBBa19B6f6A6D9646b0694F668BeA2501436");
const routing = getAddress("0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE");
const implementation = getAddress("0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7");
const capital = 20_000_000_000_000_000n;
const maxGas = 16_500_000n;
const maxGasFee = 1_500_000_000_000_000n;
const expectedRuntime = "0x363d3d373d3d3d363d73ddc4084055ae4d56f9fa618a1ccd962737f1aef75af43d82803e903d91602b57fd5bf3";
const expectedTokens = [
  "0x39dbed3a2bd333467115de45665cc57f813c4571", "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18",
  "0x020bfc650a365f8bb26819deaabf3e21291018b4", "0x56910d4409f3a0c78c64dd8d0545ff0705389870",
  "0x385f4f8ae47651ce5f58f5265395a669f8281e18", "0xe934e36a439c94017b64a3fece66af12099abf50",
  "0x20024e485c0b22b42855589700721b28320a7777", "0x18e674231a58c239dc7daedcffe15ec3a24cff5c",
  "0xe8ffd7e24187f72afb08d75b1bb13088a989a791", "0xab093def657f15df31b33922a95e047add645b29",
  "0x451b42a15100c340ca12f7c66de06fac5ea2d751", "0x57c0e45cb534413d1c20a4240955d6bb250bb4f1",
  "0x5a86828efd322bfb16d93cfed16ee9bc14940d7f", "0xca9c78dd337a67f6e0077f65f5e9218719d30edf",
  "0x9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc", "0x91a2dae9699f0b82540b5886b0d8759c22820ba3",
  "0xa74a94c15b95f8d5f3abdd2db00f6c7384037b55", "0xdee52f2ab639b6942b0d0f0565400b93b7a0fbe5",
  "0x013940c3daa5e2bb12df1ea94afe47ce84c0db4f", "0x20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261",
  "0x7a8cda6a1cab3e5146cd13cb623a3bb284fb4ad1",
].map(getAddress);

const factoryAbi = parseAbi(["function bySlug(string) view returns(address)", "function implementation() view returns(address)"]);
const vaultAbi = parseAbi([
  "function owner() view returns(address)", "function creator() view returns(address)", "function executor() view returns(address)",
  "function creatorFeeBps() view returns(uint16)", "function protocolFeeBps() view returns(uint16)",
  "function minFirstDeposit() view returns(uint256)", "function totalSupply() view returns(uint256)",
  "function paused() view returns(bool)", "function planNonce() view returns(uint256)",
  "function constituents() view returns(address[])", "function targetBps(address) view returns(uint16)",
  "function quoteBuys(uint256[] budgets) payable", "function bootstrap(uint256[] floors,uint256 nonce,uint256 deadline) payable returns(uint256)",
  "error BuyQuote(uint256[] outputs)", "error QuoteUnavailable()", "error RoutesUnavailable()", "error Invalid()",
]);
const client = createPublicClient({ transport: http(rpc, { timeout: 45_000, retryCount: 1 }) });
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const reverted = (error) => error instanceof BaseError
  ? error.walk((item) => item instanceof ContractFunctionRevertedError)
  : undefined;

fail(await client.getChainId() === 4663, "Wrong chain");
const block = await client.getBlock();
const [listed, currentImplementation, code, nativeBalance] = await Promise.all([
  client.readContract({ address: factory, abi: factoryAbi, functionName: "bySlug", args: ["696xcanary"], blockNumber: block.number }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "implementation", blockNumber: block.number }),
  client.getCode({ address: canary, blockNumber: block.number }),
  client.getBalance({ address: deployer, blockNumber: block.number }),
]);
fail(same(listed, canary) && same(currentImplementation, implementation), "Canary identity changed");
fail(code && keccak256(code) === keccak256(expectedRuntime), "Canary runtime changed");

const read = (functionName, args = []) => client.readContract({ address: canary, abi: vaultAbi, functionName, args, blockNumber: block.number });
const [owner, creator, executor, creatorFee, protocolFee, minimum, supply, paused, nonce, tokens] = await Promise.all([
  read("owner"), read("creator"), read("executor"), read("creatorFeeBps"), read("protocolFeeBps"),
  read("minFirstDeposit"), read("totalSupply"), read("paused"), read("planNonce"), read("constituents"),
]);
fail(same(owner, curator) && same(creator, deployer) && same(executor, routing), "Canary roles or routing changed");
fail(Number(creatorFee) === 40 && Number(protocolFee) === 10 && minimum === capital, "Canary economics changed");
fail(supply === 0n && !paused && nonce === 22n, "Canary is no longer pristine");
fail(tokens.length === expectedTokens.length && tokens.every((token, index) => same(token, expectedTokens[index])), "Canary basket changed");
const weights = await Promise.all(tokens.map((token) => read("targetBps", [token])));
fail(weights.every((weight, index) => Number(weight) === (index < 3 ? 358 : 357)), "Canary weights changed");
fail(nativeBalance >= capital + maxGasFee, "Deployer balance is below the reviewed capital and gas reserve");

const net = capital * (10_000n - BigInt(creatorFee) - BigInt(protocolFee)) / 10_000n;
const budgets = weights.map((weight) => net * BigInt(weight) / 10_000n);
let outputs;
try {
  await client.simulateContract({ address: canary, abi: vaultAbi, account: deployer, functionName: "quoteBuys", args: [budgets], value: capital, blockNumber: block.number });
  throw new Error("Buy quote unexpectedly returned");
} catch (error) {
  const reason = reverted(error);
  if (!(reason instanceof ContractFunctionRevertedError) || reason.data?.errorName !== "BuyQuote") throw error;
  outputs = reason.data.args[0];
}
fail(outputs.length === 21 && outputs.every((value) => value > 0n), "A canary route returned zero output");
const floors = outputs.map((output) => output * 9_700n / 10_000n);

// Start the five-minute contract window only after every route has been quoted.
const freshBlock = await client.getBlock({ blockTag: "pending" });
const deadline = freshBlock.timestamp + 300n;
const args = [floors, nonce, deadline];
await client.simulateContract({ address: canary, abi: vaultAbi, account: deployer, functionName: "bootstrap", args, value: capital, blockTag: "pending" });
const estimate = await client.estimateContractGas({ address: canary, abi: vaultAbi, account: deployer, functionName: "bootstrap", args, value: capital });
const gas = estimate * 120n / 100n;
fail(gas <= maxGas, "Bootstrap gas exceeds the reviewed cap");
let maxFeePerGas;
let maxPriorityFeePerGas;
const rehearsalFee = process.env.HOODX_REHEARSAL_MAX_FEE_PER_GAS_WEI;
if (rehearsalFee) {
  fail(/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(rpc), "Fee override is restricted to a local rehearsal RPC");
  maxFeePerGas = BigInt(rehearsalFee);
  maxPriorityFeePerGas = 0n;
} else try {
  const fees = await client.estimateFeesPerGas();
  maxFeePerGas = fees.maxFeePerGas;
  maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
} catch {
  // Some fork nodes do not retain fee history. A bounded gas-price fallback
  // keeps rehearsal available while the absolute fee cap remains enforced.
  maxFeePerGas = await client.getGasPrice();
  maxPriorityFeePerGas = 0n;
}
fail(maxFeePerGas > 0n && gas * maxFeePerGas <= maxGasFee, "Bootstrap fee reserve exceeds the reviewed cap");
const data = encodeFunctionData({ abi: vaultAbi, functionName: "bootstrap", args });

console.log(JSON.stringify({
  chainId: 4663,
  blockNumber: freshBlock.number.toString(),
  assetCount: tokens.length,
  quoteRetentionBps: 9700,
  capitalWei: capital.toString(),
  deadline: deadline.toString(),
  estimateGas: estimate.toString(),
  maxGasFeeWei: (gas * maxFeePerGas).toString(),
  tx: {
    to: canary,
    data,
    value: `0x${capital.toString(16)}`,
    gas: `0x${gas.toString(16)}`,
    maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
    maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
  },
}, null, 2));
