import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createPublicClient,
  custom,
  formatEther,
  getAddress,
  keccak256,
  parseAbi,
} from "viem";

const CHAIN_ID = 4663;
const DEPLOYER = getAddress("0xf63E63a80A25611154C5d1c06E55FD763E0cfC19");
const CURATOR = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const REGISTRY = getAddress("0xa46150E972Da054f9b954D7a695476A6258A4705");
const POLICY = getAddress("0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21");
const ROUTE_ADMIN = getAddress("0x49bAe4Eb7b7a7567f67A600Ca8752027e9d12Fa3");
const FACTORY = getAddress("0xb0a89074d2f88207698aC99f39061463eeabeC8a");
const IMPLEMENTATION = getAddress("0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7");
const PONS_HOOK = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
const QUOTRON_HOOK = getAddress("0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc");
const READY_AT = 1790322086n;
const EXPECTED_EVIDENCE = "0x6b70f4f761e22ecca3a35aab6a9ba22eea9dbd038165fe684f63ca9e1a27315f";
const EXPECTED_HOOK_HASHES = {
  [PONS_HOOK]: "0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db",
  [QUOTRON_HOOK]: "0xd6082651ea0016d58e52d4478b46b8ef601dce4cd6312f22f572ad39f8b2a094",
};
const EXPECTED_ROUTE_FINGERPRINT = "0x6e099c7bc199851686bca108bde88de3f20531e953352a4102712ef1ca03b93a";

const registryAbi = parseAbi([
  "function owner() view returns(address)",
  "function isApprovedHook(address) view returns(bool)",
  "function proposals(address) view returns(bytes32 codeHash,bytes32 evidence,uint256 readyAt)",
]);
const policyAbi = parseAbi(["function owner() view returns(address)"]);
const routeAdminAbi = parseAbi([
  "function owner() view returns(address)",
  "function policy() view returns(address)",
  "function MAX_BATCH() view returns(uint256)",
]);
const factoryAbi = parseAbi([
  "function owner() view returns(address)",
  "function treasury() view returns(address)",
  "function implementation() view returns(address)",
  "function bySlug(string) view returns(address)",
]);

const rpcUrl = process.env.ROBINHOOD_RPC_URL
  || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim();
const curlTransport = custom({
  async request({ method, params }) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] });
    let output;
    try {
      output = execFileSync("curl.exe", [
        "--silent", "--show-error", "--fail-with-body", "--max-time", "25",
        "--header", "content-type: application/json", "--data-binary", "@-", rpcUrl,
      ], { input: payload, encoding: "utf8", windowsHide: true });
    } catch {
      throw new Error(`RPC request failed for ${method}`);
    }
    const response = JSON.parse(output);
    if (response.error) throw new Error(response.error.message || `RPC error for ${method}`);
    return response.result;
  },
});
const client = createPublicClient({ transport: curlTransport });

function same(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

async function signer(address) {
  const [balance, latestNonce, pendingNonce] = await Promise.all([
    client.getBalance({ address }),
    client.getTransactionCount({ address, blockTag: "latest" }),
    client.getTransactionCount({ address, blockTag: "pending" }),
  ]);
  return {
    address,
    balanceWei: balance.toString(),
    balanceEth: formatEther(balance),
    latestNonce,
    pendingNonce,
    pendingGap: pendingNonce - latestNonce,
  };
}

async function hook(address) {
  const [[proposedHash, evidence, readyAt], active, code] = await Promise.all([
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "proposals", args: [address] }),
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "isApprovedHook", args: [address] }),
    client.getCode({ address }),
  ]);
  const liveHash = keccak256(code);
  return {
    address,
    active,
    readyAt: readyAt.toString(),
    proposedHash,
    liveHash,
    evidence,
    checks: {
      readyAtPinned: readyAt === READY_AT,
      proposalMatchesCode: proposedHash === liveHash,
      expectedCodeHash: liveHash === EXPECTED_HOOK_HASHES[address],
      expectedEvidence: evidence === EXPECTED_EVIDENCE,
    },
  };
}

const [chainId, block, fees, registryOwner, policyOwner, routeAdminOwner, routeAdminPolicy, maxBatch,
  factoryOwner, factoryTreasury, factoryImplementation, existingCanary, deployer, curator,
  ponsHook, quotronHook] = await Promise.all([
  client.getChainId(),
  client.getBlock(),
  client.estimateFeesPerGas(),
  client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "owner" }),
  client.readContract({ address: POLICY, abi: policyAbi, functionName: "owner" }),
  client.readContract({ address: ROUTE_ADMIN, abi: routeAdminAbi, functionName: "owner" }),
  client.readContract({ address: ROUTE_ADMIN, abi: routeAdminAbi, functionName: "policy" }),
  client.readContract({ address: ROUTE_ADMIN, abi: routeAdminAbi, functionName: "MAX_BATCH" }),
  client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "owner" }),
  client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "treasury" }),
  client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "implementation" }),
  client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "bySlug", args: ["696xcanary"] }),
  signer(DEPLOYER),
  signer(CURATOR),
  hook(PONS_HOOK),
  hook(QUOTRON_HOOK),
]);

if (chainId !== CHAIN_ID) throw new Error(`Wrong chain: ${chainId}`);
const checks = {
  cooldownMature: block.timestamp >= READY_AT,
  registryOwnedByDeployer: same(registryOwner, DEPLOYER),
  policyOwnedByRouteAdmin: same(policyOwner, ROUTE_ADMIN),
  routeAdminOwnedByCurator: same(routeAdminOwner, CURATOR),
  routeAdminTargetsPolicy: same(routeAdminPolicy, POLICY),
  routeBatchCapIs20: maxBatch === 20n,
  factoryOwnedByDeployer: same(factoryOwner, DEPLOYER),
  factoryTreasuryIsCurator: same(factoryTreasury, CURATOR),
  factoryImplementationPinned: same(factoryImplementation, IMPLEMENTATION),
  canarySlugAvailable: /^0x0{40}$/i.test(existingCanary),
  noPendingDeployerTransactions: deployer.pendingGap === 0,
  noPendingCuratorTransactions: curator.pendingGap === 0,
  hookProposalsIntact: [ponsHook, quotronHook].every((item) => Object.values(item.checks).every(Boolean)),
  hooksNotYetActive: !ponsHook.active && !quotronHook.active,
};
const ready = Object.values(checks).every(Boolean);
const report = {
  chainId,
  blockNumber: block.number.toString(),
  blockTimestamp: block.timestamp.toString(),
  checkedAt: new Date().toISOString(),
  ready,
  checks,
  expectedRouteFingerprint: EXPECTED_ROUTE_FINGERPRINT,
  fees: {
    maxFeePerGasWei: (fees.maxFeePerGas || fees.gasPrice).toString(),
    maxPriorityFeePerGasWei: (fees.maxPriorityFeePerGas || 0n).toString(),
  },
  signers: { deployer, curator },
  contracts: {
    registry: { address: REGISTRY, owner: registryOwner },
    policy: { address: POLICY, owner: policyOwner },
    routeAdmin: { address: ROUTE_ADMIN, owner: routeAdminOwner, policy: routeAdminPolicy, maxBatch: maxBatch.toString() },
    factory: { address: FACTORY, owner: factoryOwner, treasury: factoryTreasury, implementation: factoryImplementation, existingCanary },
  },
  hooks: [ponsHook, quotronHook],
  transactionPlan: [
    { order: 1, signer: DEPLOYER, action: "Activate PONS and QUOTRON hooks", transactions: 2 },
    { order: 2, signer: CURATOR, action: "Admit reviewed routes 1-20", transactions: 1 },
    { order: 3, signer: CURATOR, action: "Admit reviewed route 21", transactions: 1 },
    { order: 4, signer: DEPLOYER, action: "Create empty 696xcanary", transactions: 1 },
  ],
  broadcast: false,
};

fs.writeFileSync("deployments/proportional-canary-live-readiness.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!ready) process.exitCode = 2;
