import { unstable_cache } from "next/cache";
import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbi, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL, USDG } from "@/lib/config";
import { AUTO_LP, stockLpControllerAbi, stockLpVaultAbi } from "@/lib/stockLp";
import { ethUsdFromSqrt, navSummary, sleeveValueUsd, AUTO_LP_LAUNCH } from "@/lib/autolpNav";

// Cached Automated LP stats: one Multicall3 request (~90 reads) every 5 minutes at most, shared by every visitor
// through the edge cache. Never hammers the RPC, whatever the traffic.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b" as Address;
const ETH_POOL_ID = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  ["0x0000000000000000000000000000000000000000", USDG as Address, 100, 1, "0x0000000000000000000000000000000000000000"],
));
const sleeveAbi = parseAbi([
  "function spot() view returns (uint160,int24)",
  "function tickLower() view returns (int24)",
  "function tickUpper() view returns (int24)",
  "function positionLiquidity() view returns (uint128)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function feeOwed0() view returns (uint256)",
  "function feeOwed1() view returns (uint256)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const stateViewAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);

export type AutoLpStats = Awaited<ReturnType<typeof readStats>>;

async function readStats() {
  const vault = AUTO_LP.vault!, controller = AUTO_LP.controller!;
  const client = createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 12_000, retryCount: 1 }) });
  const per = AUTO_LP.sleeves.flatMap((s, i) => {
    const [t0, t1] = s.usdgIsToken0 ? [USDG as Address, s.token] : [s.token, USDG as Address];
    return [
      { address: s.sleeve, abi: sleeveAbi, functionName: "spot" },
      { address: s.sleeve, abi: sleeveAbi, functionName: "tickLower" },
      { address: s.sleeve, abi: sleeveAbi, functionName: "tickUpper" },
      { address: s.sleeve, abi: sleeveAbi, functionName: "positionLiquidity" },
      { address: s.sleeve, abi: sleeveAbi, functionName: "totalSupply" },
      { address: s.sleeve, abi: sleeveAbi, functionName: "balanceOf", args: [vault] },
      { address: t0, abi: erc20, functionName: "balanceOf", args: [s.sleeve] },
      { address: t1, abi: erc20, functionName: "balanceOf", args: [s.sleeve] },
      { address: s.sleeve, abi: sleeveAbi, functionName: "feeOwed0" },
      { address: s.sleeve, abi: sleeveAbi, functionName: "feeOwed1" },
      { address: controller, abi: stockLpControllerAbi, functionName: "status", args: [BigInt(i)] },
    ] as const;
  });
  const [blockNumber, results] = await Promise.all([
    client.getBlockNumber(),
    client.multicall({
      multicallAddress: MULTICALL3, allowFailure: false,
      contracts: [
        ...per,
        { address: vault, abi: stockLpVaultAbi, functionName: "totalSupply" },
        { address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [ETH_POOL_ID] },
      ] as never,
    }) as Promise<unknown[]>,
  ]);
  const N = 11;
  const ethUsd = ethUsdFromSqrt((results[per.length + 1] as readonly [bigint])[0]);
  const supply = results[per.length] as bigint;
  const sleeves = AUTO_LP.sleeves.map((s, i) => {
    const r = results.slice(i * N, (i + 1) * N);
    const [sqrtP, tick] = r[0] as readonly [bigint, number];
    const status = r[10] as readonly [boolean, boolean, bigint, bigint, boolean, number];
    const read = {
      sqrtPriceX96: sqrtP, tickLower: Number(r[1]), tickUpper: Number(r[2]), liquidity: r[3] as bigint,
      sleeveSupply: r[4] as bigint, vaultShares: r[5] as bigint, bal0: r[6] as bigint, bal1: r[7] as bigint,
      owed0: r[8] as bigint, owed1: r[9] as bigint, usdgIsToken0: s.usdgIsToken0,
    };
    return {
      symbol: s.symbol, valueUsd: sleeveValueUsd(read), tick: Number(tick), tickLower: read.tickLower, tickUpper: read.tickUpper,
      inRange: status[0], referenceAgrees: status[1], breachStart: Number(status[2]), rebandReady: status[4],
    };
  });
  const summary = navSummary(sleeves.map((s) => s.valueUsd), supply, ethUsd);
  return {
    updatedAt: Math.floor(Date.now() / 1000), block: Number(blockNumber), ...summary,
    capUsd: AUTO_LP.capUsd, capacityPct: Math.min(100, (summary.navUsd / AUTO_LP.capUsd) * 100),
    launch: AUTO_LP_LAUNCH, sleeves,
  };
}

// Only successful reads are cached: a failure throws through unstable_cache and is never stored.
const cached = unstable_cache(readStats, ["autolp-stats-v3"], { revalidate: 300 });

export async function GET() {
  if (!AUTO_LP.vault || !AUTO_LP.controller) return Response.json({ error: "not live" }, { status: 404 });
  let value: AutoLpStats;
  try {
    value = await cached();
  } catch (e) {
    console.error("autolp-stats", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
    return Response.json({ error: "stats temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
  }
  return Response.json(value, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } });
}
