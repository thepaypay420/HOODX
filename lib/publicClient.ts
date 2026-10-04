"use client";

import { createPublicClient, http } from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";

/* The browser's read client, kept apart from the wallet stack so plain read modules (and their tests) stay light.
 * Vault pages issue hundreds of small reads in a few dependent waves. Plain reads issued in the same tick are folded into
 * one Multicall3 eth_call per block; everything else (blocks, logs, balances, reverting quote simulations) still shares a
 * JSON-RPC batch. Batches stay at 50 because the public RPC rate-limits per call and answers 429 to much larger ones. */
export const publicClient = createPublicClient({
  chain: robinhood,
  batch: { multicall: { wait: 16 } },
  transport: http(RPC_URL, { batch: { batchSize: 50, wait: 16 } }),
});
