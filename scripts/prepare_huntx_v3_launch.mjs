import fs from "node:fs";
import {
  createPublicClient, encodeDeployData, formatEther, getContractAddress, http, keccak256, parseAbi,
} from "viem";

const ROOT = new URL("../", import.meta.url);
const rpc = process.env.ROBINHOOD_RPC_URL?.trim();
if (!rpc) throw new Error("ROBINHOOD_RPC_URL is required");
const client = createPublicClient({ transport: http(rpc, { timeout: 25_000, retryCount: 1 }) });
const CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const DEPLOYER = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19";
const EXECUTOR = "0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750";
const EXECUTOR_HASH = "0x7f0ab91ef78f36e60d01f7b167e227de218e708931ce4b6e823080608a4dc195";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const REGISTRY = "0xa46150E972Da054f9b954D7a695476A6258A4705";
const PONS = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
const live = JSON.parse(fs.readFileSync(new URL("deployments/huntx-v3-base-live.json", ROOT), "utf8"));
const violations = [];
if (live.status !== "LIVE_CLOSED_PILOT") violations.push("FEEX base is not bootstrapped and verified");
if (Number(live.pilot?.approximateUsdAtSpot) !== 160) violations.push("FEEX base is not the reviewed $160 sleeve");
const base = live.index;
const baseAbi = parseAbi([
  "function weth() view returns(address)", "function owner() view returns(address)",
  "function bootstrapped() view returns(bool)", "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)", "function sleeves() view returns(address[])",
]);
const executorAbi = parseAbi(["function weth() view returns(address)", "function hookRegistry() view returns(address)"]);
const registryAbi = parseAbi(["function isApprovedHook(address) view returns(bool)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns(uint256)"]);

const [chainId, blockNumber, baseCode, baseWeth, baseOwner, baseReady, baseSupply, curatorBase, sleeves,
  executorCode, executorWeth, executorRegistry, ponsActive, deployerNonce, deployerBalance, curatorBalance, fees] = await Promise.all([
  client.getChainId(), client.getBlockNumber(), client.getCode({ address: base }),
  client.readContract({ address: base, abi: baseAbi, functionName: "weth" }),
  client.readContract({ address: base, abi: baseAbi, functionName: "owner" }),
  client.readContract({ address: base, abi: baseAbi, functionName: "bootstrapped" }),
  client.readContract({ address: base, abi: baseAbi, functionName: "totalSupply" }),
  client.readContract({ address: base, abi: baseAbi, functionName: "balanceOf", args: [CURATOR] }),
  client.readContract({ address: base, abi: baseAbi, functionName: "sleeves" }),
  client.getCode({ address: EXECUTOR }),
  client.readContract({ address: EXECUTOR, abi: executorAbi, functionName: "weth" }),
  client.readContract({ address: EXECUTOR, abi: executorAbi, functionName: "hookRegistry" }),
  client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "isApprovedHook", args: [PONS] }),
  client.getTransactionCount({ address: DEPLOYER, blockTag: "pending" }),
  client.getBalance({ address: DEPLOYER }), client.getBalance({ address: CURATOR }), client.estimateFeesPerGas(),
]);
if (chainId !== 4663) violations.push("wrong chain");
if (!baseCode || baseWeth.toLowerCase() !== WETH.toLowerCase() || !baseReady) violations.push("FEEX identity changed");
if ((await client.getCode({ address: baseOwner })) === "0x") violations.push("FEEX controller missing");
if (baseSupply !== curatorBase || baseSupply !== BigInt(live.pilot.initialShares)) violations.push("FEEX supply or curator balance changed");
if (sleeves.length !== 4) violations.push("FEEX sleeve count changed");
for (const sleeve of sleeves) {
  const [code, backing] = await Promise.all([
    client.getCode({ address: sleeve }), client.readContract({ address: sleeve, abi: erc20Abi, functionName: "balanceOf", args: [base] }),
  ]);
  if (!code || backing === 0n) violations.push(`empty or missing FEEX sleeve ${sleeve}`);
}
if (keccak256(executorCode) !== EXECUTOR_HASH || executorWeth.toLowerCase() !== WETH.toLowerCase()
    || executorRegistry.toLowerCase() !== REGISTRY.toLowerCase() || !ponsActive) violations.push("launch execution infrastructure changed");

const baseSeedAmount = baseSupply;
const baseSeedWeth = BigInt(live.pilot.seedWei);
const riskReference = baseSeedWeth * 10_000n / 8_000n;
const wethSeed = riskReference * 2_000n / 10_000n;
const initialShares = 200n * 10n ** 18n;
const baseHash = keccak256(baseCode);
const artifact = JSON.parse(fs.readFileSync(new URL("out/HoodxLaunchHunterLaunchV3.sol/HoodxLaunchHunterLaunchV3.json", ROOT), "utf8"));
const bytecode = artifact.bytecode.object.startsWith("0x") ? artifact.bytecode.object : `0x${artifact.bytecode.object}`;
const args = [base, EXECUTOR_HASH, baseHash, baseSeedAmount, wethSeed, riskReference, initialShares];
const data = encodeDeployData({ abi: artifact.abi, bytecode, args });
const initCodeBytes = (data.length - 2) / 2;
if (initCodeBytes > 49_152) violations.push(`launcher init code exceeds EIP-3860: ${initCodeBytes}`);
let estimatedGas = 0n;
if (violations.length === 0) estimatedGas = await client.estimateGas({ account: DEPLOYER, data });
const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
const deployGasCap = estimatedGas * maxFeePerGas * 125n / 100n;
const bootstrapGasReserve = 1_000_000n * maxFeePerGas * 2n;
if (deployerBalance < deployGasCap) violations.push("deployer lacks reviewed deployment gas cap");
if (curatorBalance < wethSeed + bootstrapGasReserve) violations.push("curator lacks HUNTX WETH seed plus gas reserve");

const report = {
  status: violations.length === 0 ? "READY_TO_DEPLOY" : "BLOCKED",
  generatedAt: new Date().toISOString(), chainId, blockNumber: blockNumber.toString(), violations,
  base: { launcher: live.launcher, index: base, indexRuntimeHash: baseHash, seedShares: baseSeedAmount.toString(),
    seedWethEquivalent: baseSeedWeth.toString(), sleeves },
  huntx: { riskReferenceWei: riskReference.toString(), wethSeedWei: wethSeed.toString(),
    wethSeedEth: formatEther(wethSeed), initialShares: initialShares.toString(), allocationBps: { feex: 8000, weth: 2000 } },
  deployment: { expectedLauncher: getContractAddress({ from: DEPLOYER, nonce: BigInt(deployerNonce) }),
    creationCodeHash: keccak256(bytecode), deployDataHash: keccak256(data), initCodeBytes,
    estimatedGas: estimatedGas.toString(), reviewedGasCapWei: deployGasCap.toString(), maxFeePerGasWei: maxFeePerGas.toString() },
  accounts: { deployer: { address: DEPLOYER, nonce: deployerNonce, balanceWei: deployerBalance.toString() },
    curator: { address: CURATOR, balanceWei: curatorBalance.toString(),
      requiredWei: (wethSeed + bootstrapGasReserve).toString(),
      shortfallWei: (curatorBalance < wethSeed + bootstrapGasReserve ? wethSeed + bootstrapGasReserve - curatorBalance : 0n).toString() } },
};
fs.writeFileSync(new URL("deployments/huntx-v3-launch-preflight.json", ROOT), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
