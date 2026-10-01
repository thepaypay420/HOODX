import { parseAbi, type Address } from "viem";
import { publicClient } from "@/lib/wallet";
const configAbi = parseAbi([
  "function policy() view returns (address)",
  "function executor() view returns (address)",
  "function weth() view returns (address)",
  "function constituents() view returns (address[])",
  "function configId(address) view returns (bytes32)",
  "function targetBps(address) view returns (uint16)",
]);
const policyAbi = parseAbi(["function config(bytes32) view returns (address token,address oracle,bytes buy,bytes sell)"]);
const executorAbi = parseAbi(["function validateRoute(bytes,address,address) view"]);
const oracleAbi = parseAbi(["function value(address,uint256) view returns (uint256)"]);
const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
export type V2RouteCheck = { token: Address; targetBps: number; buyAvailable: boolean; sellAvailable: boolean };

/** Structural/liquidity preflight, not an executable price quote or future guarantee.
 * The complete deposit/withdraw is also simulated immediately before wallet submission.
 */
export async function preflightV2Routes(vault: Address): Promise<V2RouteCheck[]> {
  const [policy, executor, weth, tokens] = await Promise.all([
    publicClient.readContract({ address: vault, abi: configAbi, functionName: "policy" }),
    publicClient.readContract({ address: vault, abi: configAbi, functionName: "executor" }),
    publicClient.readContract({ address: vault, abi: configAbi, functionName: "weth" }),
    publicClient.readContract({ address: vault, abi: configAbi, functionName: "constituents" }),
  ]);
  return Promise.all(tokens.map(async token => {
    const [id, targetBps] = await Promise.all([
      publicClient.readContract({ address: vault, abi: configAbi, functionName: "configId", args: [token] }),
      publicClient.readContract({ address: vault, abi: configAbi, functionName: "targetBps", args: [token] }),
    ]);
    const [configuredToken, , buy, sell] = await publicClient.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [id] });
    if (configuredToken.toLowerCase() !== token.toLowerCase()) throw new Error("Vault route configuration does not match its asset.");
    const checks = await Promise.allSettled([
      publicClient.readContract({ address: executor, abi: executorAbi, functionName: "validateRoute", args: [buy, weth, token] }),
      publicClient.readContract({ address: executor, abi: executorAbi, functionName: "validateRoute", args: [sell, token, weth] }),
    ]);
    return { token, targetBps, buyAvailable: checks[0].status === "fulfilled", sellAvailable: checks[1].status === "fulfilled" };
  }));
}

export type BlockedReference = { token: Address; symbol: string };

/** Held constituents whose configured price reference currently reverts or returns zero.
 * Any one of these blocks NAV, so ETH deposits and ETH exits revert; in-kind exits do not.
 */
export async function blockedPriceReferences(vault: Address): Promise<BlockedReference[]> {
  const [policy, tokens] = await Promise.all([
    publicClient.readContract({ address: vault, abi: configAbi, functionName: "policy" }),
    publicClient.readContract({ address: vault, abi: configAbi, functionName: "constituents" }),
  ]);
  const checks = await Promise.all(tokens.map(async token => {
    const id = await publicClient.readContract({ address: vault, abi: configAbi, functionName: "configId", args: [token] });
    const [, oracle] = await publicClient.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [id] });
    const decimals = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }).catch(() => 18);
    const healthy = await publicClient.readContract({ address: oracle, abi: oracleAbi, functionName: "value", args: [token, 10n ** BigInt(decimals)] })
      .then(value => value > 0n, () => false);
    if (healthy) return undefined;
    const symbol = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }).catch(() => `${token.slice(0, 6)}…`);
    return { token, symbol };
  }));
  return checks.filter((check): check is BlockedReference => check !== undefined);
}

export function blockedReferenceMessage(blocked: readonly BlockedReference[]) {
  if (blocked.length === 0) return "ETH exit unavailable · use direct assets below";
  const names = blocked.map(b => b.symbol);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `ETH exit paused: the ${list} pool${names.length === 1 ? " is" : "s are"} below the safety liquidity needed to price ${names.length === 1 ? "it" : "them"}. Exit as tokens and cash below. That path needs no prices or swaps.`;
}
