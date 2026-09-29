import fs from "node:fs";
import {
  createPublicClient, encodeDeployData, formatEther, getContractAddress, http, keccak256, parseAbi,
} from "viem";

const ROOT = new URL("../", import.meta.url);
const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
if (!rpc) throw new Error("Robinhood RPC configuration is missing");
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const DEPLOYER = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19";
const CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const EXECUTOR = "0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750";
const REGISTRY = "0xa46150E972Da054f9b954D7a695476A6258A4705";
const PONS = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
const EXPECTED_EXECUTOR_HASH = "0x7f0ab91ef78f36e60d01f7b167e227de218e708931ce4b6e823080608a4dc195";
const SEED = 73_973_000_000_000_000n;

const artifact = JSON.parse(fs.readFileSync(new URL("../out/HoodxLaunchHunterLaunchV1.sol/HoodxLaunchHunterLaunchV1.json", import.meta.url)));
const bytecode = artifact.bytecode.object.startsWith("0x") ? artifact.bytecode.object : `0x${artifact.bytecode.object}`;
const deployData = encodeDeployData({ abi: artifact.abi, bytecode });
const registryAbi = parseAbi(["function isApprovedHook(address) view returns(bool)"]);
const executorAbi = parseAbi(["function weth() view returns(address)", "function hookRegistry() view returns(address)"]);

const [chainId, block, fees, executorCode, hookActive, weth, executorRegistry, deployerBalance,
  curatorBalance, latestNonce, pendingNonce] = await Promise.all([
  client.getChainId(), client.getBlock(), client.estimateFeesPerGas(), client.getCode({ address: EXECUTOR }),
  client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "isApprovedHook", args: [PONS] }),
  client.readContract({ address: EXECUTOR, abi: executorAbi, functionName: "weth" }),
  client.readContract({ address: EXECUTOR, abi: executorAbi, functionName: "hookRegistry" }),
  client.getBalance({ address: DEPLOYER }), client.getBalance({ address: CURATOR }),
  client.getTransactionCount({ address: DEPLOYER, blockTag: "latest" }),
  client.getTransactionCount({ address: DEPLOYER, blockTag: "pending" }),
]);
if (chainId !== 4663) throw new Error(`Wrong chain ${chainId}`);
const gasEstimate = await client.estimateGas({ account: DEPLOYER, data: deployData });
const gasLimit = gasEstimate * 125n / 100n;
const gasPrice = fees.maxFeePerGas || fees.gasPrice;
if (!gasPrice) throw new Error("Gas price unavailable");
const gasCap = gasLimit * gasPrice;
const checks = {
  executorPinned: keccak256(executorCode) === EXPECTED_EXECUTOR_HASH,
  ponsHookActive: hookActive,
  executorRegistryPinned: executorRegistry.toLowerCase() === REGISTRY.toLowerCase(),
  wethPinned: weth.toLowerCase() === "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  noPendingDeployerTransactions: latestNonce === pendingNonce,
  deployerGasFunded: deployerBalance >= gasCap,
};
const report = {
  checkedAt: new Date().toISOString(), chainId, blockNumber: block.number.toString(),
  status: Object.values(checks).every(Boolean) ? "READY_TO_DEPLOY" : "BLOCKED",
  checks,
  launcher: getContractAddress({ from: DEPLOYER, nonce: BigInt(pendingNonce) }),
  deployer: { address: DEPLOYER, nonce: pendingNonce, balanceEth: formatEther(deployerBalance) },
  curator: {
    address: CURATOR, balanceEth: formatEther(curatorBalance), seedEth: formatEther(SEED),
    bootstrapFundingShortfallEth: formatEther(curatorBalance >= SEED ? 0n : SEED - curatorBalance),
  },
  deployment: {
    gasEstimate: gasEstimate.toString(), gasLimit: gasLimit.toString(), maxFeePerGas: gasPrice.toString(),
    maximumCostEth: formatEther(gasCap), initCodeBytes: (deployData.length - 2) / 2,
    initCodeHash: keccak256(deployData),
  },
};
fs.writeFileSync(new URL("../deployments/launch-hunter-launch-preflight.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
