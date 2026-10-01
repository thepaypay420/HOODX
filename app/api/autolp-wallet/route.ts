import { unstable_cache } from "next/cache";
import { createPublicClient, http, isAddress, parseAbiItem, getAddress, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { AUTO_LP } from "@/lib/stockLp";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

// ETH deposited into / withdrawn from the Automated LP vault by one wallet, from the vault's own events.
// Two filtered log queries per wallet, cached 2 minutes per address (and at the edge).
const deposited = parseAbiItem("event DepositedEth(address indexed account, address indexed receiver, uint256 shares, uint256 ethUsed, uint256 usdgValue)");
const withdrawn = parseAbiItem("event WithdrawnEth(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut)");

// Only successful reads are cached: a failure throws through unstable_cache and is never stored.
const read = unstable_cache(async (wallet: Address) => {
  {
    const client = createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 12_000, retryCount: 1 }) });
    const [ins, outs] = await Promise.all([
      client.getLogs({ address: AUTO_LP.vault!, event: deposited, args: { receiver: wallet }, fromBlock: AUTO_LP.deployBlock, toBlock: "latest" }),
      client.getLogs({ address: AUTO_LP.vault!, event: withdrawn, args: { account: wallet }, fromBlock: AUTO_LP.deployBlock, toBlock: "latest" }),
    ]);
    return {
      ok: true as const,
      depositedWei: ins.reduce((a, l) => a + (l.args.ethUsed ?? 0n), 0n).toString(),
      withdrawnWei: outs.reduce((a, l) => a + (l.args.ethOut ?? 0n), 0n).toString(),
      deposits: ins.length, withdrawals: outs.length,
    };
  }
}, ["autolp-wallet-v2"], { revalidate: 120 });

export async function GET(request: Request) {
  if (!AUTO_LP.vault) return Response.json({ error: "not live" }, { status: 404 });
  const raw = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(raw)) return Response.json({ error: "bad address" }, { status: 400 });
  try {
    return await withWorkBudget("autolp-wallet", 1, { capacity: 20, refillPerSecond: 0.5, maxConcurrent: 3 }, async () => {
      let r: Awaited<ReturnType<typeof read>>;
      try {
        r = await read(getAddress(raw));
      } catch (e) {
        console.error("autolp-wallet", e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e);
        return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "public, max-age=15" } });
      }
      return Response.json(r, { headers: { "Cache-Control": "public, max-age=30, s-maxage=120" } });
    });
  } catch (error) { return guardedError(error); }
}
