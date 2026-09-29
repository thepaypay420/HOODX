import fs from "node:fs";
import {
  createPublicClient,
  encodeDeployData,
  formatEther,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";

const ROOT = new URL("../", import.meta.url);
const RPC_FILE = "C:/Users/lukey/Desktop/RH RPC.txt";
const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync(RPC_FILE, "utf8")).trim();
if (!rpc) throw new Error("Robinhood RPC configuration is missing");

const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const DEPLOYER = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19";
const FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const pools = [
  "0xD64FbdA67E1015dF43Fa5e49F02cA844729E5F94",
  "0xdEc8F541FF159D2B4ABD3c3b041CD739BD7C486F",
  "0x28f26FB95Ef30218E0090d0776A5cDF65BA44E73",
  "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca",
];
const expectedProtocols = [102, 102, 102, 68];
const twapWindows = [3600, 3600, 3600, 1800];
const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)",
]);

const divFloor = (a, b) => {
  let q = a / b;
  if (a < 0n && a % b !== 0n) q -= 1n;
  return q;
};
const nearest = (tick, spacing) => {
  const rem = tick % spacing;
  let center = tick - rem;
  if (rem >= spacing / 2n) center += spacing;
  if (rem <= -(spacing / 2n)) center -= spacing;
  return center;
};

const chainId = await client.getChainId();
if (chainId !== 4663) throw new Error(`Wrong chain ${chainId}`);
const blockNumber = await client.getBlockNumber();
const reviewed = [];
const violations = [];
for (let i = 0; i < pools.length; i += 1) {
  const [factory, token0, token1, fee, spacing, liquidity, slot, observation] = await Promise.all([
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "factory" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "token1" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "fee" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "tickSpacing" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "liquidity" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "slot0" }),
    client.readContract({ address: pools[i], abi: poolAbi, functionName: "observe", args: [[twapWindows[i], 0]] }),
  ]);
  const spot = BigInt(slot[1]);
  const twap = divFloor(observation[0][1] - observation[0][0], BigInt(twapWindows[i]));
  const center = nearest(twap, BigInt(spacing));
  if (factory.toLowerCase() !== FACTORY.toLowerCase() || token0.toLowerCase() !== WETH.toLowerCase()) violations.push(`Pool ${i} identity changed`);
  if (Number(slot[5]) !== expectedProtocols[i] || !slot[6] || liquidity === 0n) violations.push(`Pool ${i} economics or liveness changed`);
  if (fee !== 10_000 && i < 3) violations.push(`Pool ${i} fee changed`);
  const deviation = spot > twap ? spot - twap : twap - spot;
  if (deviation > BigInt(i === 3 ? 120 : 500)) violations.push(`Pool ${i} spot/TWAP divergence: ${deviation} ticks`);
  reviewed.push({ pool: pools[i], token1, fee: Number(fee), spacing: Number(spacing), liquidity: liquidity.toString(), spot: Number(spot), twap: Number(twap), center: Number(center), feeProtocol: Number(slot[5]) });
}

const coreSqrt = BigInt((await client.readContract({ address: pools[3], abi: poolAbi, functionName: "slot0" }))[0]);
const q96 = 2n ** 96n;
const usdPerEthScaled = coreSqrt * coreSqrt * 10n ** 18n * 10n ** 12n / (q96 * q96);
const targetUsd = BigInt(process.env.HOODX_FEE_MACHINE_TARGET_USD || "200");
if (targetUsd <= 0n || targetUsd > 10_000n) throw new Error("Invalid fee-machine target USD");
const targetUsdScaled = targetUsd * 10n ** 18n;
const rawSeed = targetUsdScaled * 10n ** 18n / usdPerEthScaled;
const seedWei = rawSeed / 10n ** 12n * 10n ** 12n;
const initialShares = targetUsd * 10n ** 18n;

const artifact = JSON.parse(fs.readFileSync(new URL("out/HoodxFeeMachineLaunchV1.sol/HoodxFeeMachineLaunchV1.json", ROOT), "utf8"));
const bytecode = artifact.bytecode.object.startsWith("0x") ? artifact.bytecode.object : `0x${artifact.bytecode.object}`;
const data = encodeDeployData({ abi: artifact.abi, bytecode, args: [CURATOR, seedWei, initialShares, reviewed.map((x) => x.center)] });
const [deployerNonce, deployerBalance, curatorBalance, fees] = await Promise.all([
  client.getTransactionCount({ address: DEPLOYER, blockTag: "pending" }),
  client.getBalance({ address: DEPLOYER }),
  client.getBalance({ address: CURATOR }),
  client.estimateFeesPerGas(),
]);
const gasEstimate = violations.length === 0 ? await client.estimateGas({ account: DEPLOYER, data }) : 0n;
const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
const gasCap = gasEstimate * maxFeePerGas * 125n / 100n;
// Fork evidence measures the complete bootstrap near 6.2m gas. Reserve 8m gas
// at twice the current fee so the funding gate remains conservative.
const bootstrapGasReserve = 8_000_000n * maxFeePerGas * 2n;
const requiredCurator = seedWei + bootstrapGasReserve;
const manifest = {
  status: violations.length ? "AWAITING_MARKET_STABILITY" : curatorBalance >= requiredCurator ? "READY_TO_DEPLOY_AND_BOOTSTRAP" : "AWAITING_CURATOR_SEED",
  violations,
  generatedAt: new Date().toISOString(),
  chainId,
  blockNumber: blockNumber.toString(),
  accounts: {
    deployer: { address: DEPLOYER, nonce: deployerNonce, balanceWei: deployerBalance.toString(), balanceEth: formatEther(deployerBalance) },
    curator: { address: CURATOR, balanceWei: curatorBalance.toString(), balanceEth: formatEther(curatorBalance) },
  },
  pilot: {
    name: "HOODX Fee Machine",
    symbol: "FEEX",
    seedWei: seedWei.toString(),
    seedEth: formatEther(seedWei),
    approximateUsdAtSpot: Number(targetUsd),
    initialShares: initialShares.toString(),
    allocationBps: [3000, 3000, 3000, 1000],
    centers: reviewed.map((x) => x.center),
  },
  deployment: {
    expectedLauncher: getContractAddress({ from: DEPLOYER, nonce: BigInt(deployerNonce) }),
    creationCodeHash: keccak256(bytecode),
    deployDataHash: keccak256(data),
    initCodeBytes: (data.length - 2) / 2,
    estimatedGas: gasEstimate.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(),
    reviewedGasCapWei: gasCap.toString(),
  },
  funding: {
    bootstrapGasReserveWei: bootstrapGasReserve.toString(),
    requiredCuratorWei: requiredCurator.toString(),
    shortfallWei: (requiredCurator > curatorBalance ? requiredCurator - curatorBalance : 0n).toString(),
    shortfallEth: formatEther(requiredCurator > curatorBalance ? requiredCurator - curatorBalance : 0n),
  },
  pools: reviewed,
};
const outputPath = process.env.HOODX_FEE_MACHINE_PREFLIGHT_PATH || "deployments/fee-machine-launch-preflight.json";
fs.writeFileSync(new URL(outputPath, ROOT), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: manifest.status, violations: manifest.violations, block: manifest.blockNumber, seedEth: manifest.pilot.seedEth, shortfallEth: manifest.funding.shortfallEth, centers: manifest.pilot.centers, pools: manifest.pools.map(({pool, spot, twap, center}) => ({pool, spot, twap, center, deviation: Math.abs(spot - twap)})), expectedLauncher: manifest.deployment.expectedLauncher, estimatedGas: manifest.deployment.estimatedGas, initCodeBytes: manifest.deployment.initCodeBytes }, null, 2));
