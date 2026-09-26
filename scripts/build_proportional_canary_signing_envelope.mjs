import fs from "node:fs";
import { formatEther, keccak256, toBytes } from "viem";

const readiness = JSON.parse(fs.readFileSync("deployments/proportional-canary-live-readiness.json", "utf8"));
if (!readiness.ready || readiness.broadcast) throw new Error("Readiness checkpoint is not safe");

const sources = [
  {
    file: "broadcast/ActivateProportionalHooksV3.s.sol/4663/run-latest.json",
    labels: ["Activate PONS hook", "Activate QUOTRON hook"],
  },
  {
    file: "broadcast/ApproveProportionalWatchlistV3.s.sol/4663/run-latest.json",
    labels: ["Admit reviewed routes 1-20", "Admit reviewed route 21"],
  },
  {
    file: "broadcast/CreateProportionalCanaryV3.s.sol/4663/run-latest.json",
    labels: ["Create empty 696xcanary"],
  },
];
const expectedSigners = [
  readiness.signers.deployer.address,
  readiness.signers.deployer.address,
  readiness.signers.curator.address,
  readiness.signers.curator.address,
  readiness.signers.deployer.address,
].map((value) => value.toLowerCase());
const expectedTargets = [
  readiness.contracts.registry.address,
  readiness.contracts.registry.address,
  readiness.contracts.routeAdmin.address,
  readiness.contracts.routeAdmin.address,
  readiness.contracts.factory.address,
].map((value) => value.toLowerCase());
const maxFeePerGasWei = BigInt(readiness.fees.maxFeePerGasWei) * 125n / 100n;
const transactions = [];

for (const source of sources) {
  const run = JSON.parse(fs.readFileSync(source.file, "utf8"));
  if (run.transactions.length !== source.labels.length || run.receipts.length !== source.labels.length) {
    throw new Error(`Unexpected rehearsal transaction count in ${source.file}`);
  }
  for (let index = 0; index < source.labels.length; index += 1) {
    const raw = run.transactions[index].transaction;
    const receipt = run.receipts[index];
    if (receipt.status !== "0x1") throw new Error(`Rehearsal failed: ${source.labels[index]}`);
    const gasUsed = BigInt(receipt.gasUsed);
    const paddedGas = (gasUsed * 125n + 99n) / 100n;
    const rehearsalGasLimit = BigInt(raw.gas);
    const gasLimit = rehearsalGasLimit > paddedGas ? rehearsalGasLimit : paddedGas;
    const maximumCostWei = gasLimit * maxFeePerGasWei;
    transactions.push({
      order: transactions.length + 1,
      label: source.labels[index],
      signer: raw.from,
      to: raw.to,
      value: "0x0",
      data: raw.input,
      dataHash: keccak256(raw.input),
      dataBytes: (raw.input.length - 2) / 2,
      rehearsalGasUsed: gasUsed.toString(),
      gasLimit: gasLimit.toString(),
      maxFeePerGasWei: maxFeePerGasWei.toString(),
      maximumCostWei: maximumCostWei.toString(),
      maximumCostEth: formatEther(maximumCostWei),
    });
  }
}

transactions.forEach((transaction, index) => {
  if (transaction.signer.toLowerCase() !== expectedSigners[index]) throw new Error(`Signer mismatch at step ${index + 1}`);
  if (transaction.to.toLowerCase() !== expectedTargets[index]) throw new Error(`Target mismatch at step ${index + 1}`);
});

const routeApprovedTopic = keccak256(toBytes("RouteApproved(bytes32,address,bytes32)"));
const routeRun = JSON.parse(fs.readFileSync(sources[1].file, "utf8"));
const routeIdsByTransaction = routeRun.receipts.map((receipt) => receipt.logs
  .filter((log) => log.topics?.[0]?.toLowerCase() === routeApprovedTopic.toLowerCase())
  .map((log) => log.topics[1]));
const routeTokensByTransaction = routeRun.receipts.map((receipt) => receipt.logs
  .filter((log) => log.topics?.[0]?.toLowerCase() === routeApprovedTopic.toLowerCase())
  .map((log) => `0x${log.topics[2].slice(-40)}`));
if (routeIdsByTransaction[0].length !== 20 || routeIdsByTransaction[1].length !== 1) {
  throw new Error("Expected 20 + 1 route approval events");
}

const totalMaximumCostWei = transactions.reduce((total, transaction) => total + BigInt(transaction.maximumCostWei), 0n);
const signerMaximums = {};
for (const transaction of transactions) {
  const signer = transaction.signer.toLowerCase();
  signerMaximums[signer] = (signerMaximums[signer] || 0n) + BigInt(transaction.maximumCostWei);
}
const envelope = {
  chainId: readiness.chainId,
  preparedAt: new Date().toISOString(),
  sourceForkBlock: readiness.blockNumber,
  sourceForkTimestamp: readiness.blockTimestamp,
  routeFingerprint: readiness.expectedRouteFingerprint,
  routeIdsByTransaction,
  routeTokensByTransaction,
  maxFeePerGasWei: maxFeePerGasWei.toString(),
  totalMaximumCostWei: totalMaximumCostWei.toString(),
  totalMaximumCostEth: formatEther(totalMaximumCostWei),
  signerMaximums: Object.fromEntries(Object.entries(signerMaximums).map(([address, value]) => [address, {
    wei: value.toString(),
    eth: formatEther(value),
  }])),
  transactions,
  safety: {
    valueTransferredWei: "0",
    createsEmptyCanary: true,
    activatesExactlyTwoPinnedHooks: true,
    admitsExactly21PinnedRoutes: true,
    touchesExisting696xVault: false,
    broadcastsPerformed: false,
  },
};

fs.writeFileSync(
  "deployments/proportional-canary-signing-envelope-2026-09-26.json",
  `${JSON.stringify(envelope, null, 2)}\n`,
);
console.log(JSON.stringify({
  transactions: transactions.map(({ order, label, signer, to, dataHash, dataBytes, gasLimit, maximumCostEth }) => ({
    order, label, signer, to, dataHash, dataBytes, gasLimit, maximumCostEth,
  })),
  totalMaximumCostEth: envelope.totalMaximumCostEth,
  signerMaximums: envelope.signerMaximums,
  safety: envelope.safety,
}, null, 2));
