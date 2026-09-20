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
