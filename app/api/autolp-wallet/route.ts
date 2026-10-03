import { unstable_cache } from "next/cache";
import { isAddress, parseAbi, getAddress, type Address } from "viem";
import { logClient } from "@/lib/logScan";
import { accountFor } from "@/lib/positionAccounting";
import { AUTO_LP } from "@/lib/stockLp";
import { guardedError, withWorkBudget } from "@/lib/requestGuard";

// One wallet's cost basis in the Automated LP vault, rebuilt from the vault's own events: deposits, the launch seed,
// ETH withdrawals, exits to sleeve shares and transfers (see lib/positionAccounting.ts). Cached 60 seconds per address.
const vaultAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// Only successful reads are cached: a failure throws through unstable_cache and is never stored.
const read = unstable_cache(async (wallet: Address) => {
  const shares = await logClient().readContract({ address: AUTO_LP.vault!, abi: vaultAbi, functionName: "balanceOf", args: [wallet] });
  const a = await accountFor(wallet, AUTO_LP.vault!, "autolp", shares);
  return { ok: true as const, ...a, shares: String(shares) };
}, ["autolp-wallet-v3"], { revalidate: 60 });

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
