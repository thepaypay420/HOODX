import { createPublicClient, http, type AbiEvent, type Address, type PublicClient } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";

/* Event history reads for server routes. The Robinhood Chain public RPC answers one contract's filtered logs over up to
 * 10M blocks in a single call (but only 100k blocks when a filter position holds several values), so history is read per
 * contract in 9M-block windows. If an RPC refuses a window, that window is retried in 100k-block slices within a budget. */

const WIDE = 9_000_000n, NARROW = 100_000n, NARROW_BUDGET = 150;
let _logs: PublicClient | undefined;
/** the public endpoint is used for logs on purpose: private endpoints often cap ranges far lower */
export const logClient = () => (_logs ??= createPublicClient({ chain: robinhood, transport: http(RPC_URL, { timeout: 15_000, retryCount: 1 }) }) as PublicClient);

export async function scanLogs<E extends AbiEvent>(address: Address, event: E, args: Record<string, unknown> | undefined, fromBlock: bigint, toBlock?: bigint) {
  const c = logClient(), end = toBlock ?? (await c.getBlockNumber());
  const out = [];
  let narrow = 0;
  for (let a = fromBlock; a <= end; a += WIDE) {
    const b = a + WIDE - 1n > end ? end : a + WIDE - 1n;
    try { out.push(...await c.getLogs({ address, event, args: args as never, fromBlock: a, toBlock: b })); }
    catch {
      for (let x = a; x <= b; x += NARROW) {
        if (++narrow > NARROW_BUDGET) throw new Error("log history budget exceeded");
        out.push(...await c.getLogs({ address, event, args: args as never, fromBlock: x, toBlock: x + NARROW - 1n > b ? b : x + NARROW - 1n }));
      }
    }
  }
  return out;
}
