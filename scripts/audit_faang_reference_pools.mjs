import { createPublicClient, http, parseAbi } from "viem";
import survey from "../deployments/robinhood-4663-v2-reference-survey.json" with { type: "json" };

const rpc = process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw new Error("ROBINHOOD_RPC_URL is required");
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
const window = 1800;
const weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const bridge = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca";
const wanted = new Map([
  ["0x12f190a9f9d7d37a250758b26824b97ce941bf54", "AMZN"],
  ["0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", "GOOGL"],
]);
const poolAbi = parseAbi([
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function liquidity() view returns(uint128)",
  "function observe(uint32[]) view returns(int56[],uint160[])",
]);
const erc20Abi = parseAbi(["function decimals() view returns(uint8)"]);

function meanTick(ticks) {
  const delta = ticks[1] - ticks[0];
  let tick = delta / BigInt(window);
  if (delta < 0n && delta % BigInt(window) !== 0n) tick--;
  return Number(tick);
}

async function inspect(pool) {
  const [token0, token1, liquidity, observed] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "observe", args: [[window, 0]] }),
  ]);
  const delta = observed[1][1] - observed[1][0];
  const harmonic = delta === 0n ? 0n : (BigInt(window) << 128n) / delta;
  return { pool, token0: token0.toLowerCase(), token1: token1.toLowerCase(), liquidity, harmonic, tick: meanTick(observed[0]) };
}

function convert(amount, base, pool) {
  const ratio = Math.pow(1.0001, pool.tick);
  return base.toLowerCase() === pool.token0 ? amount * ratio : amount / ratio;
}

const bridgeState = await inspect(bridge);
const block = await client.getBlockNumber();
console.log(`block ${block}; USDG/WETH bridge current ${bridgeState.liquidity} harmonic ${bridgeState.harmonic}`);
for (const asset of survey.assets.filter((item) => wanted.has(item.token.toLowerCase()))) {
  const name = wanted.get(asset.token.toLowerCase());
  const decimals = await client.readContract({ address: asset.token, abi: erc20Abi, functionName: "decimals" });
  console.log(`\n${name}`);
  for (const ref of asset.references) {
    try {
      const state = await inspect(ref.pool);
      let out = convert(10 ** Number(decimals), asset.token, state);
      if (ref.quote.toLowerCase() === usdg) out = convert(out, usdg, bridgeState);
      console.log(`${ref.pool} ${ref.quote.toLowerCase() === weth ? "WETH" : "USDG"} current=${state.liquidity} harmonic=${state.harmonic} wethPerToken=${out.toExponential(8)}`);
    } catch (error) {
      console.log(`${ref.pool} unavailable (${error?.shortMessage || "read failed"})`);
    }
  }
}
