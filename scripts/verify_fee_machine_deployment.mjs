import fs from "node:fs";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
const deploymentTx = process.argv[2] || process.env.HOODX_FEE_MACHINE_DEPLOY_TX;
if (!/^0x[0-9a-f]{64}$/i.test(deploymentTx || "")) throw new Error("Deployment transaction hash required");
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const preflightPath = process.env.HOODX_FEE_MACHINE_PREFLIGHT_PATH || "deployments/fee-machine-launch-preflight.json";
const livePath = process.env.HOODX_FEE_MACHINE_LIVE_PATH || "deployments/fee-machine-live.json";
const preflight = JSON.parse(fs.readFileSync(preflightPath, "utf8"));
const launchAbi = parseAbi([
  "function curator() view returns(address)", "function seedWeth() view returns(uint256)",
  "function initialShares() view returns(uint256)", "function index() view returns(address)",
  "function controller() view returns(address)", "function sleeves(uint256) view returns(address)",
  "function launchCenters(uint256) view returns(int24)", "function bootstrapped() view returns(bool)",
]);
const ownableAbi = parseAbi(["function owner() view returns(address)", "function pendingOwner() view returns(address)"]);
const controllerAbi = parseAbi(["function curator() view returns(address)", "function activationAuthority() view returns(address)", "function bootstrapAuthority() view returns(address)", "function sleeveCount() view returns(uint256)"]);

if (await client.getChainId() !== 4663) throw new Error("Wrong chain");
const [tx, receipt] = await Promise.all([client.getTransaction({ hash: deploymentTx }), client.getTransactionReceipt({ hash: deploymentTx })]);
if (receipt.status !== "success" || tx.to !== null || tx.from.toLowerCase() !== "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19".toLowerCase() || keccak256(tx.input) !== preflight.deployment.deployDataHash) throw new Error("Deployment provenance differs from preflight");
const launcher = getAddress(receipt.contractAddress);
if (launcher.toLowerCase() !== preflight.deployment.expectedLauncher.toLowerCase()) throw new Error("Unexpected launcher address");
const [code, curator, seed, shares, index, controller, bootstrapped] = await Promise.all([
  client.getCode({ address: launcher }),
  client.readContract({ address: launcher, abi: launchAbi, functionName: "curator" }),
  client.readContract({ address: launcher, abi: launchAbi, functionName: "seedWeth" }),
  client.readContract({ address: launcher, abi: launchAbi, functionName: "initialShares" }),
  client.readContract({ address: launcher, abi: launchAbi, functionName: "index" }),
  client.readContract({ address: launcher, abi: launchAbi, functionName: "controller" }),
  client.readContract({ address: launcher, abi: launchAbi, functionName: "bootstrapped" }),
]);
if (!code || curator.toLowerCase() !== CURATOR.toLowerCase() || seed !== BigInt(preflight.pilot.seedWei) || shares !== BigInt(preflight.pilot.initialShares) || bootstrapped) throw new Error("Launcher terms do not match preflight");
const [indexOwner, controllerCurator, activation, bootstrap, sleeveCount] = await Promise.all([
  client.readContract({ address: index, abi: ownableAbi, functionName: "owner" }),
  client.readContract({ address: controller, abi: controllerAbi, functionName: "curator" }),
  client.readContract({ address: controller, abi: controllerAbi, functionName: "activationAuthority" }),
  client.readContract({ address: controller, abi: controllerAbi, functionName: "bootstrapAuthority" }),
  client.readContract({ address: controller, abi: controllerAbi, functionName: "sleeveCount" }),
]);
if (indexOwner.toLowerCase() !== controller.toLowerCase() || controllerCurator.toLowerCase() !== CURATOR.toLowerCase() || activation.toLowerCase() !== launcher.toLowerCase() || bootstrap.toLowerCase() !== launcher.toLowerCase() || sleeveCount !== 4n) throw new Error("Ownership graph mismatch");
const sleeves = [];
for (let i = 0; i < 4; i += 1) {
  const [address, center] = await Promise.all([
    client.readContract({ address: launcher, abi: launchAbi, functionName: "sleeves", args: [BigInt(i)] }),
    client.readContract({ address: launcher, abi: launchAbi, functionName: "launchCenters", args: [BigInt(i)] }),
  ]);
  const [owner, sleeveCode] = await Promise.all([client.readContract({ address, abi: ownableAbi, functionName: "owner" }), client.getCode({ address })]);
  if (owner.toLowerCase() !== controller.toLowerCase() || !sleeveCode || Number(center) !== preflight.pilot.centers[i]) throw new Error(`Sleeve ${i} mismatch`);
  sleeves.push({ address, runtimeCodeHash: keccak256(sleeveCode), center: Number(center) });
}
const blockNumber = await client.getBlockNumber();
const manifest = { status: "DEPLOYED_AWAITING_BOOTSTRAP", verifiedAt: new Date().toISOString(), blockNumber: blockNumber.toString(), deploymentTx, deployDataHash: keccak256(tx.input), launcher, launcherRuntimeCodeHash: keccak256(code), index, controller, sleeves, pilot: preflight.pilot };
fs.writeFileSync(livePath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
