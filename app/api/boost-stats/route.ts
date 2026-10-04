import { unstable_cache } from "next/cache";
import { createPublicClient, http } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { BOOST, boostSignalAbi, boostVaultAbi } from "@/lib/boost";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";
import seed from "@/deployments/boost-eth-seed.json";

/* Boosted ETH page data: one Multicall3 read of the vault and its signal, shared by every visitor (60 s server cache,
 * 30 s edge cache). Before deployment it returns the signal as it stands in the published seed, so the page can show
 * what the strategy is doing now. */

export type BoostStats = {
  live: boolean;
  updatedAt: number;
  ethUsd: number;
  navUsd: number;
  navEth: number;
  perShareUsd: number;
  sinceLaunchUsdPct: number;
  sinceLaunchEthPct: number;
  capUsd: number;
  capacityPct: number;
  leverage: number;
  target: number;
  sigma: number;
  fresh: boolean;
  ethFlags: number;
  btcFlags: number;
  debtUsd: number;
  cashUsd: number;
  collateralEth: number;
  depositsPaused: boolean;
  lastRebalance: number;
  signalHour: number;
};

const read = unstable_cache(async (): Promise<BoostStats> => {
  if (!BOOST.vault || !BOOST.signal) {
    const t = Number(seed.target), s = Number(seed.sigma);
    return { live: false, updatedAt: Date.now(), ethUsd: Number(BigInt(seed.ethLast)) / 1e18, navUsd: 0, navEth: 0, perShareUsd: 1,
      sinceLaunchUsdPct: 0, sinceLaunchEthPct: 0, capUsd: BOOST.capUsd, capacityPct: 0, leverage: 0, target: t, sigma: s, fresh: false,
      ethFlags: seed.ethFlags, btcFlags: seed.btcFlags, debtUsd: 0, cashUsd: 0, collateralEth: 0, depositsPaused: false, lastRebalance: 0,
      signalHour: seed.lastHour };
  }
  const client = createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 10_000, retryCount: 1 }) });
  const v = { address: BOOST.vault, abi: boostVaultAbi } as const;
  const [st, supply, launch, paused, lastReb, snap, fresh] = await client.multicall({
    allowFailure: false,
    contracts: [
      { ...v, functionName: "state" }, { ...v, functionName: "totalSupply" }, { ...v, functionName: "launchEthPrice" },
      { ...v, functionName: "depositsPaused" }, { ...v, functionName: "lastRebalance" },
      { address: BOOST.signal, abi: boostSignalAbi, functionName: "snapshot" },
      { address: BOOST.signal, abi: boostSignalAbi, functionName: "isFresh" },
    ],
  });
  const ethUsd = Number(st.price) / 1e24;            // oracle: USDG units per WETH wei x1e36
  const launchUsd = Number(launch) / 1e24;
  const navUsd = Number(st.nav) / 1e6;
  const sup = Number(supply) / 1e18;
  const perShareUsd = sup > 0 ? navUsd / sup : 1;   // 1 share = 1 USDG at launch
  const perShareEthNow = perShareUsd / ethUsd, perShareEthLaunch = 1 / launchUsd;
  return {
    live: true, updatedAt: Date.now(), ethUsd, navUsd, navEth: navUsd / ethUsd, perShareUsd,
    sinceLaunchUsdPct: (perShareUsd - 1) * 100, sinceLaunchEthPct: (perShareEthNow / perShareEthLaunch - 1) * 100,
    capUsd: BOOST.capUsd, capacityPct: Math.min(100, (navUsd / BOOST.capUsd) * 100),
    leverage: Number(st.leverage) / 1e18, target: Number(snap[0]) / 1e18, sigma: Number(snap[1]) / 1e18, fresh,
    ethFlags: snap[2], btcFlags: snap[3], debtUsd: Number(st.debt) / 1e6, cashUsd: Number(st.cashUsdg + st.idleUsdg) / 1e6,
    collateralEth: Number(st.collateral + st.idleWeth) / 1e18, depositsPaused: paused, lastRebalance: Number(lastReb),
    signalHour: Number(snap[7]),
  };
}, ["boost-stats-v1", BOOST.vault ?? "none", BOOST.signal ?? "none"], { revalidate: 60 }); // a new address never reads the old cache

export async function GET() {
  try {
    return await withWorkBudget("boost-stats", 1, { capacity: 60, refillPerSecond: 2, maxConcurrent: 4 }, async () => {
      try {
        return Response.json(await read(), { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=300" } });
      } catch (e) {
        console.error("boost-stats", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=10" } });
      }
    });
  } catch (error) { return guardedError(error); }
}
