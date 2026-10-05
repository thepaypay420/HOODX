/* Last check before a proposal reaches the user: decode the finished transaction and prove it does exactly what the card
 * will say. The right contract for that vault, only an allowed function, the user's own wallet as receiver, no more ETH
 * than they asked for. The proposal card is rendered from this decode, never from model text. */
import { decodeFunctionData, getAddress, parseEther, type Abi, type Address, type Hex } from "viem";
import { boostVaultAbi } from "@/lib/boost";
import { stockLpVaultAbi } from "@/lib/stockLp";
import { proportionalAbi } from "@/lib/proportionalQuote";
import { v2VaultAbi } from "@/lib/v2";
import type { Entry } from "@/lib/mcp/hoodx";

type Tx = { chainId: number; from: string; to: string; data: string; value: string };
const ALLOWED: Record<Entry["kind"], { abi: Abi; deposit: string[]; withdraw: string[]; receiverArg?: Record<string, number> }> = {
  boost: { abi: boostVaultAbi as Abi, deposit: ["deposit"], withdraw: ["withdraw"], receiverArg: { deposit: 0, withdraw: 1 } },
  autolp: { abi: stockLpVaultAbi as Abi, deposit: ["depositEth"], withdraw: ["withdrawEth"], receiverArg: { depositEth: 1, withdrawEth: 1 } },
  atomic: { abi: proportionalAbi as Abi, deposit: ["depositExactShares", "bootstrap"], withdraw: ["withdraw"] },
  v2: { abi: v2VaultAbi as Abi, deposit: ["deposit"], withdraw: ["withdraw"] },
};

export class VerifyError extends Error {}

/** Throws unless `tx` is a deposit/withdraw on `vault` for `wallet`, sending at most `maxValueWei`. Returns the decoded call. */
export function verifyTx(tx: Tx, vault: Entry, wallet: Address, action: "deposit" | "withdraw", maxValueWei: bigint) {
  const fail = (why: string) => { throw new VerifyError(`Blocked a transaction that did not match your request (${why}).`); };
  if (tx.chainId !== 4663) fail("wrong chain");
  if (getAddress(tx.to) !== getAddress(vault.address)) fail("wrong contract");
  if (getAddress(tx.from) !== getAddress(wallet)) fail("wrong wallet");
  const rules = ALLOWED[vault.kind];
  let decoded: { functionName: string; args?: readonly unknown[] };
  try { decoded = decodeFunctionData({ abi: rules.abi, data: tx.data as Hex }); } catch { return fail("unreadable call"); }
  if (!rules[action].includes(decoded.functionName)) fail(`function ${decoded.functionName} is not allowed`);
  const ri = rules.receiverArg?.[decoded.functionName];
  if (ri !== undefined && getAddress(String(decoded.args?.[ri])) !== getAddress(wallet)) fail("receiver is not your wallet");
  const value = BigInt(tx.value);
  if (action === "withdraw" && value !== 0n) fail("a withdrawal must not send ETH");
  if (action === "deposit" && (value <= 0n || value > maxValueWei)) fail("ETH sent differs from the amount you asked for");
  return { functionName: decoded.functionName, valueWei: value };
}

export const ethWei = (eth: string) => parseEther(eth);
