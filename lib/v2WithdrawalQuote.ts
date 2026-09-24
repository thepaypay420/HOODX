import { BaseError, formatEther } from "viem";

export type WithdrawalQuoteFailure = "invalid-reference" | "route-failure";

function errorText(error: unknown) {
  if (error instanceof BaseError) {
    return [error.shortMessage, error.details, error.message]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function classifyWithdrawalQuoteFailure(error: unknown): WithdrawalQuoteFailure {
  const text = errorText(error).toLowerCase();
  return text.includes("0x5f41ff92") || text.includes("invalidreference")
    ? "invalid-reference"
    : "route-failure";
}

export function withdrawalQuoteFailureMessage(failure: WithdrawalQuoteFailure) {
  if (failure === "invalid-reference") {
    return "ETH withdrawal is temporarily unavailable because a required on-chain price reference is invalid. Changing the minimum cannot fix it. Redeem as tokens and cash below; that path does not use prices or swaps.";
  }
  return "The complete ETH withdrawal could not be simulated. Refresh once; if it still fails, redeem as tokens and cash so your shares are not trapped behind a sale route.";
}

export function protectedWithdrawalMinimum(result: bigint, navFloor: bigint) {
  const quotedFloor = result * 99n / 100n;
  const floor = quotedFloor > navFloor ? quotedFloor : navFloor;
  if (floor <= 0n) throw new Error("Withdrawal output is too small to protect");
  return {
    floor,
    minimum: formatEther(floor),
    message: `Estimated receive: ${formatEther(result)} ETH. Minimum allows up to 1% below this estimate${navFloor > 1n ? ", while retaining the NAV floor" : ""}. Rechecked before signing.`,
  };
}

export async function quoteWithdrawalWithRetry(
  simulate: () => Promise<bigint>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)),
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await simulate();
    } catch (error) {
      lastError = error;
      if (classifyWithdrawalQuoteFailure(error) === "invalid-reference" || attempt === 2) throw error;
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}
