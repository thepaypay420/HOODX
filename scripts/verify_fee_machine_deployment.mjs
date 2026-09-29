import fs from "node:fs";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
const launcher = getAddress(process.argv[2] || process.env.HOODX_FEE_MACHINE_LAUNCHER || "0x0000000000000000000000000000000000000000");
if (launcher === "0x0000000000000000000000000000000000000000") throw new Error("Launcher address required");
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const preflight = JSON.parse(fs.readFileSync("deployments/fee-machine-launch-preflight.json", "utf8"));
const launchAbi = parseAbi([
  "function curator() view returns(address)", "function seedWeth() view returns(uint256)",
  "function initialShares() view returns(uint256)", "function index() view returns(address)",
  "function controller() view returns(address)", "function sleeves(uint256) view returns(address)",
  "function launchCenters(uint256) view returns(int24)", "function bootstrapped() view returns(bool)",
]);
const ownableAbi = parseAbi(["function owner() view returns(address)", "function pendingOwner() view returns(address)"]);
const controllerAbi = parseAbi(["function curator() view returns(address)", "function activationAuthority() view returns(address)", "function bootstrapAuthority() view returns(address)", "function sleeveCount() view returns(uint256)"]);

if (await client.getChainId() !== 4663) throw new Error("Wrong chain");
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
const manifest = { status: "DEPLOYED_AWAITING_BOOTSTRAP", verifiedAt: new Date().toISOString(), blockNumber: blockNumber.toString(), launcher, launcherRuntimeCodeHash: keccak256(code), index, controller, sleeves, pilot: preflight.pilot };
fs.writeFileSync("deployments/fee-machine-live.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
