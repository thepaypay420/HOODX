import fs from "node:fs";
import { createPublicClient, getAddress, http, keccak256, parseAbi, zeroAddress } from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL?.trim()
  || (fs.existsSync("C:/Users/lukey/Desktop/RH RPC.txt")
    ? fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim()
    : "https://rpc.mainnet.chain.robinhood.com");
delete process.env.ROBINHOOD_RPC_URL;

const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const FACTORY = getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");
const PONS_FACTORY = getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB");
const pools = [
  { key: "delta", pool: getAddress("0xd64fbda67e1015df43fa5e49f02ca844729e5f94"), pons: true },
  { key: "pongo", pool: getAddress("0xdec8f541ff159d2b4abd3c3b041cd739bd7c486f"), pons: true },
  { key: "giwa", pool: getAddress("0x28f26fb95ef30218e0090d0776a5cdf65ba44e73"), pons: true },
  { key: "core", pool: getAddress("0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca"), pons: false },
];

const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function liquidityPool() view returns (address)",
]);
const ponsFactoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount) launched)",
]);

const block = await client.getBlock();
const reviewed = [];
for (const candidate of pools) {
  const p = candidate.pool;
  const [factory, token0, token1, fee, spacing, liquidity, slot0, code] = await Promise.all([
    client.readContract({ address: p, abi: poolAbi, functionName: "factory" }),
    client.readContract({ address: p, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: p, abi: poolAbi, functionName: "token1" }),
    client.readContract({ address: p, abi: poolAbi, functionName: "fee" }),
    client.readContract({ address: p, abi: poolAbi, functionName: "tickSpacing" }),
    client.readContract({ address: p, abi: poolAbi, functionName: "liquidity" }),
    client.readContract({ address: p, abi: poolAbi, functionName: "slot0" }),
    client.getCode({ address: p }),
  ]);
  const twapSeconds = candidate.pons ? 3_600 : 1_800;
  const [tickCumulatives] = await client.readContract({ address: p, abi: poolAbi, functionName: "observe", args: [[twapSeconds, 0]] });
  const tickDelta = tickCumulatives[1] - tickCumulatives[0];
  let twapTick = Number(tickDelta / BigInt(twapSeconds));
  if (tickDelta < 0n && tickDelta % BigInt(twapSeconds) !== 0n) twapTick -= 1;
  if (factory !== FACTORY || token0 !== WETH || token1 === zeroAddress || liquidity === 0n || !slot0[6]) {
    throw new Error(`${candidate.key}: invalid canonical pool state`);
  }
  const paired = token1;
  const [name, symbol, decimals, supply, tokenCode] = await Promise.all([
    client.readContract({ address: paired, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: paired, abi: tokenAbi, functionName: "symbol" }),
    client.readContract({ address: paired, abi: tokenAbi, functionName: "decimals" }),
    client.readContract({ address: paired, abi: tokenAbi, functionName: "totalSupply" }),
    client.getCode({ address: paired }),
  ]);
  let pons = null;
  if (candidate.pons) {
    pons = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "getLaunchedToken", args: [paired] });
    const declaredPool = await client.readContract({ address: paired, abi: tokenAbi, functionName: "liquidityPool" });
    if (!pons.exists || pons.token !== paired || pons.pairedToken !== WETH || pons.poolFee !== 10_000 || declaredPool !== p) {
      throw new Error(`${candidate.key}: PONS provenance mismatch`);
    }
    if (pons.restrictionsEndBlock >= block.number) throw new Error(`${candidate.key}: launch restrictions are active`);
  }
  reviewed.push({
    key: candidate.key,
    pool: p,
    token: paired,
    name,
    symbol,
    decimals,
    totalSupply: supply.toString(),
    fee,
    tickSpacing: spacing,
    tick: slot0[1],
    twapTick,
    spotTwapDifference: Math.abs(slot0[1] - twapTick),
    feeProtocol: slot0[5],
    liquidity: liquidity.toString(),
    poolCodeHash: keccak256(code),
    tokenCodeHash: keccak256(tokenCode),
    ponsFactory: candidate.pons ? PONS_FACTORY : null,
    restrictionsExpired: candidate.pons ? true : null,
  });
}

const report = {
  chainId: await client.getChainId(),
  blockNumber: block.number.toString(),
  blockTimestamp: Number(block.timestamp),
  factory: FACTORY,
  weth: WETH,
  status: "read-only candidate identity audit; no transaction sent",
  reviewed,
};
if (report.chainId !== 4663) throw new Error(`wrong chain ${report.chainId}`);
fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync("deployments/fee-machine-candidate-audit.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ chainId: report.chainId, blockNumber: report.blockNumber, pools: reviewed.map(({ key, symbol, pool, fee, tickSpacing, tick, twapTick, spotTwapDifference, feeProtocol }) => ({ key, symbol, pool, fee, tickSpacing, tick, twapTick, spotTwapDifference, feeProtocol })) }, null, 2));
