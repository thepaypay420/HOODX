import fs from "node:fs";
import { createPublicClient, formatEther, getAddress, http, keccak256, parseAbi } from "viem";

const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
if (!rpc) throw new Error("Robinhood RPC configuration is missing");
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });

const addresses = {
  deployer: getAddress("0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"),
  curator: getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6"),
  registry: getAddress("0xa46150E972Da054f9b954D7a695476A6258A4705"),
  executor: getAddress("0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750"),
  ponsHook: getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044"),
  dopplerHook: getAddress("0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544"),
};
const registryAbi = parseAbi([
  "function isApprovedHook(address) view returns(bool)",
  "function proposals(address) view returns(bytes32 codeHash,bytes32 evidence,uint256 readyAt)",
]);
const executorAbi = parseAbi([
  "function weth() view returns(address)",
  "function hookRegistry() view returns(address)",
  "function v2Factory() view returns(address)",
]);

const [chainId, block, executorCode, registryCode, weth, registryFromExecutor, v2Factory,
  ponsActive, ponsProposal, dopplerActive, dopplerProposal, deployerBalance, curatorBalance,
  deployerLatest, deployerPending, curatorLatest, curatorPending] = await Promise.all([
  client.getChainId(), client.getBlock(), client.getCode({ address: addresses.executor }),
  client.getCode({ address: addresses.registry }),
  client.readContract({ address: addresses.executor, abi: executorAbi, functionName: "weth" }),
  client.readContract({ address: addresses.executor, abi: executorAbi, functionName: "hookRegistry" }),
  client.readContract({ address: addresses.executor, abi: executorAbi, functionName: "v2Factory" }),
  client.readContract({ address: addresses.registry, abi: registryAbi, functionName: "isApprovedHook", args: [addresses.ponsHook] }),
  client.readContract({ address: addresses.registry, abi: registryAbi, functionName: "proposals", args: [addresses.ponsHook] }),
  client.readContract({ address: addresses.registry, abi: registryAbi, functionName: "isApprovedHook", args: [addresses.dopplerHook] }),
  client.readContract({ address: addresses.registry, abi: registryAbi, functionName: "proposals", args: [addresses.dopplerHook] }),
  client.getBalance({ address: addresses.deployer }), client.getBalance({ address: addresses.curator }),
  client.getTransactionCount({ address: addresses.deployer, blockTag: "latest" }),
  client.getTransactionCount({ address: addresses.deployer, blockTag: "pending" }),
  client.getTransactionCount({ address: addresses.curator, blockTag: "latest" }),
  client.getTransactionCount({ address: addresses.curator, blockTag: "pending" }),
]);

if (chainId !== 4663) throw new Error(`Wrong chain ${chainId}`);
const hook = ([codeHash, evidence, readyAt], active) => ({
  active,
  codeHash,
  evidence,
  readyAt: readyAt.toString(),
  readyAtIso: readyAt === 0n ? null : new Date(Number(readyAt) * 1000).toISOString(),
  matured: readyAt !== 0n && block.timestamp >= readyAt,
});
const report = {
  checkedAt: new Date().toISOString(),
  chainId,
  blockNumber: block.number.toString(),
  blockTimestamp: block.timestamp.toString(),
  infrastructure: {
    executor: addresses.executor,
    executorCodeHash: keccak256(executorCode),
    registry: addresses.registry,
    registryCodeHash: keccak256(registryCode),
    registryMatchesExecutor: getAddress(registryFromExecutor) === addresses.registry,
    weth: getAddress(weth),
    v2Factory: getAddress(v2Factory),
  },
  hooks: {
    pons: hook(ponsProposal, ponsActive),
    doppler: hook(dopplerProposal, dopplerActive),
  },
  signers: {
    deployer: { address: addresses.deployer, balanceEth: formatEther(deployerBalance), latestNonce: deployerLatest, pendingNonce: deployerPending },
    curator: { address: addresses.curator, balanceEth: formatEther(curatorBalance), latestNonce: curatorLatest, pendingNonce: curatorPending },
  },
};
fs.writeFileSync(new URL("../deployments/launch-hunter-dependency-check.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
