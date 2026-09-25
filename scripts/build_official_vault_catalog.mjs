/**
 * Read-only catalog qualification. This writes evidence; it never approves a
 * route, deploys a vault, or sends a transaction.
 */
import fs from "node:fs";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, parseAbiParameters } from "viem";

const CHAIN_ID = 4663;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const V4_POSM = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
const V4_STATE = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const ZERO = "0x0000000000000000000000000000000000000000";
const themes = [
  ["chainfin", "CHAINX", ["MSTR", "COIN", "CRCL", "GLXY"]],
  ["siliconx", "CHIPX", ["NVDA", "AMD", "INTC", "TSM", "MU", "AVGO"]],
  ["aistack", "AIX", ["NVDA", "META", "PLTR", "MSFT", "GOOGL"]],
  ["retailx", "CULTX", ["GME", "AMC", "RDDT", "DJT", "BB", "RBLX"]],
  ["healthx", "HLTHX", ["MRNA", "LLY", "HIMS", "PFE", "JNJ"]],
  ["cloudx", "CLOUDX", ["SHOP", "NET", "SNOW", "ORCL", "MSFT"]],
  ["realx", "REALX", ["GLD", "SLV", "USO", "USAR"]],
  ["corex", "COREX", ["SPY", "QQQ", "SGOV", "GLD", "VTI"]],
  ["frontierx", "EDGE", ["SPCX", "TSLA", "BA", "LMT", "RCAT", "USAR"]],
  ["consumerx", "ICONX", ["AAPL", "AMZN", "COST", "META", "NFLX", "LULU"]],
];
const official = JSON.parse(fs.readFileSync("cache/scout/rh-assets-2026-09-24.json")).assets;
const weekly = JSON.parse(fs.readFileSync("cache/scout/rh-liquid-weekly-2026-09-24.json"));
const client = createPublicClient({ transport: http(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", { timeout: 25_000, retryCount: 2 }) });
const abi = parseAbi([
  "function getPool(address,address,uint24) view returns(address)", "function liquidity() view returns(uint128)",
  "function observe(uint32[]) view returns(int56[],uint160[])", "function poolKeys(bytes25) view returns(address,address,uint24,int24,address)",
  "function getLiquidity(bytes32) view returns(uint128)", "function symbol() view returns(string)", "function decimals() view returns(uint8)",
]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const direct = (pair, symbol) => {
  const b = pair.baseToken?.symbol, q = pair.quoteToken?.symbol;
  return (b === symbol && ["WETH", "USDG"].includes(q)) || (q === symbol && ["WETH", "USDG"].includes(b));
};
const quoteAddress = (pair, token) => pair.baseToken.address.toLowerCase() === token.toLowerCase() ? pair.quoteToken.address : pair.baseToken.address;
const routeVersion = (pair) => pair.labels?.includes("v4") ? 4 : pair.labels?.includes("v3") ? 3 : 0;

async function qualify(symbol) {
  const asset = official.find((row) => row.symbol === symbol);
  if (!asset) throw new Error(`Missing canonical asset ${symbol}`);
  const token = asset.address;
  const [onchainSymbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi, functionName: "symbol" }), client.readContract({ address: token, abi, functionName: "decimals" }),
  ]);
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`);
  if (!response.ok) throw new Error(`DEX pair request failed for ${symbol}`);
  const pairs = (await response.json()).filter((pair) => pair.dexId === "uniswap" && direct(pair, symbol) && routeVersion(pair));
  const ranked = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const bestV3 = ranked.find((pair) => routeVersion(pair) === 3);
  const best = ranked[0];
  // Prefer a direct V3 route when it is independently deep enough. V4 wins
  // only when its liquidity is materially better.
  const chosen = bestV3 && ((bestV3.liquidity?.usd || 0) >= 100_000 || (bestV3.liquidity?.usd || 0) >= (best?.liquidity?.usd || 0) * .6) ? bestV3 : best;
  if (!chosen) throw new Error(`No direct WETH/USDG Uniswap route for ${symbol}`);
  const version = routeVersion(chosen), quote = quoteAddress(chosen, token);
  const route = { version, pool: chosen.pairAddress, quote, displayLiquidityUsd: chosen.liquidity?.usd || 0, volume24hUsd: chosen.volume?.h24 || 0 };
  if (version === 3) {
    let fee = 0;
    for (const candidate of [100, 500, 3000, 10000]) {
      const pool = await client.readContract({ address: V3_FACTORY, abi, functionName: "getPool", args: [token, quote, candidate] });
      if (pool.toLowerCase() === chosen.pairAddress.toLowerCase()) fee = candidate;
    }
    if (!fee) throw new Error(`Could not bind V3 fee for ${symbol}`);
    route.fee = fee;
    route.activeLiquidity = String(await client.readContract({ address: chosen.pairAddress, abi, functionName: "liquidity" }));
    try { await client.readContract({ address: chosen.pairAddress, abi, functionName: "observe", args: [[1800, 0]] }); route.history1800 = true; }
    catch { route.history1800 = false; }
  } else {
    const values = await client.readContract({ address: V4_POSM, abi, functionName: "poolKeys", args: [chosen.pairAddress.slice(0, 52)] });
    route.key = { currency0: values[0], currency1: values[1], fee: values[2], tickSpacing: values[3], hooks: values[4] };
    route.identityMatches = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), values)).toLowerCase() === chosen.pairAddress.toLowerCase();
    route.activeLiquidity = String(await client.readContract({ address: V4_STATE, abi, functionName: "getLiquidity", args: [chosen.pairAddress] }));
    route.hookFree = values[4].toLowerCase() === ZERO;
  }
  const performance = weekly.assets.find((row) => row.symbol === symbol);
  return { symbol, name: asset.name, token, logoUrl: asset.logoUrl, multiplier: asset.multiplier, capabilities: asset.capabilities, onchainSymbol, decimals, return7dUsd: performance?.return7d ?? null, route };
}

if (await client.getChainId() !== CHAIN_ID) throw new Error("Wrong chain");
const block = await client.getBlockNumber();
const symbols = [...new Set(themes.flatMap((theme) => theme[2]))];
const assets = [];
for (const symbol of symbols) { assets.push(await qualify(symbol)); console.log(`qualified ${symbol}`); await wait(160); }
const ethReturn7dUsd = 2.1044;
const catalog = {
  chainId: CHAIN_ID, block: String(block), sampledAt: new Date().toISOString(), status: "route-qualified-pending-fork-lifecycle",
  sources: { canonicalAssets: "https://api.robinhood.com/ncw/v1/assets", routes: "https://api.dexscreener.com/token-pairs/v1/robinhood/{token}", weeklyMethod: weekly.method },
  assumptions: { cashTargetBps: 2500, assetSleeveBps: 7500, ethReturn7dUsd, weighting: "equal weight within asset sleeve" },
  limitations: ["DEX display liquidity is screening data, not a safety guarantee.", "A route is not approved until the pinned route passes buy, sell, deposit, withdrawal and atomic rebalance tests on a current fork.", "Pre-launch performance is an indicative underlier model, not realized vault performance."],
  assets,
  vaults: themes.map(([slug, symbol, members]) => {
    const rows = members.map((member) => assets.find((row) => row.symbol === member));
    const avgUsd = rows.reduce((sum, row) => sum + row.return7dUsd, 0) / rows.length;
    return { slug, symbol, assets: members, weightsBps: members.map((_, index) => Math.floor(7500 / members.length) + (index < 7500 % members.length ? 1 : 0)), cashTargetBps: 2500, model7dUsd: avgUsd, model7dEth: ((1 + .25 * ethReturn7dUsd / 100 + .75 * avgUsd / 100) / (1 + ethReturn7dUsd / 100) - 1) * 100 };
  }),
};
fs.writeFileSync("deployments/official-vault-catalog-2026-09-24.json", JSON.stringify(catalog, null, 2) + "\n");
console.log(`wrote ${catalog.vaults.length} vaults / ${assets.length} unique assets at block ${block}`);
await import("./apply_smart_marketcap_weights.mjs");
