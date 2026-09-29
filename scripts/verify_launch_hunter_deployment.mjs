import fs from "node:fs";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const launcher = getAddress(process.argv[2] || "");
const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const CURATOR = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const EXECUTOR = getAddress("0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750");
const launcherAbi = parseAbi(["function policy() view returns(address)", "function vault() view returns(address)"]);
const policyAbi = parseAbi(["function owner() view returns(address)", "function executor() view returns(address)"]);
const vaultAbi = parseAbi([
  "function curator() view returns(address)", "function policy() view returns(address)",
  "function seedAmount() view returns(uint256)", "function initialShares() view returns(uint256)",
  "function bootstrapped() view returns(bool)", "function totalSupply() view returns(uint256)",
  "function IMAGE_URI() view returns(string)",
]);
const [launcherCode, policyAddress, vaultAddress] = await Promise.all([
  client.getCode({ address: launcher }),
  client.readContract({ address: launcher, abi: launcherAbi, functionName: "policy" }),
  client.readContract({ address: launcher, abi: launcherAbi, functionName: "vault" }),
]);
const policy = getAddress(policyAddress), vault = getAddress(vaultAddress);
const [policyCode, vaultCode, policyOwner, policyExecutor, vaultCurator, vaultPolicy, seed, shares,
  bootstrapped, supply, image] = await Promise.all([
  client.getCode({ address: policy }), client.getCode({ address: vault }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "owner" }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "executor" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "curator" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "policy" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "seedAmount" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "initialShares" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "bootstrapped" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "IMAGE_URI" }),
]);
const checks = {
  contractsExist: launcherCode !== "0x" && policyCode !== "0x" && vaultCode !== "0x",
  policyOwnedByCurator: getAddress(policyOwner) === CURATOR,
  policyUsesPinnedExecutor: getAddress(policyExecutor) === EXECUTOR,
  vaultUsesPolicy: getAddress(vaultPolicy) === policy,
  vaultUsesCurator: getAddress(vaultCurator) === CURATOR,
  seedPinned: seed === 73_973_000_000_000_000n,
  sharesPinned: shares === 200n * 10n ** 18n,
  notPrebootstrapped: !bootstrapped && supply === 0n,
  imagePinned: image === "https://xhoodindex.com/vaults/launch-hunter.png",
};
if (!Object.values(checks).every(Boolean)) throw new Error(`Deployment verification failed: ${JSON.stringify(checks)}`);
const report = {
  verifiedAt: new Date().toISOString(), status: "DEPLOYED_AWAITING_BOOTSTRAP", launcher, policy, vault,
  codeHashes: { launcher: keccak256(launcherCode), policy: keccak256(policyCode), vault: keccak256(vaultCode) }, checks,
};
fs.writeFileSync(new URL("../deployments/launch-hunter-live.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
