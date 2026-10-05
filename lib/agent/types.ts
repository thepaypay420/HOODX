/* What the agent sends the page: a short reply plus cards. Cards are built by code from tool data, never from model
 * text, so every number and every transaction a user sees comes from the chain. */
export type Row = [label: string, value: string];
export type Card =
  | { type: "proposal"; action: "deposit" | "withdraw"; vault: { slug: string; name: string; ticker: string; url: string }; headline: string; rows: Row[]; protection: string;
      tx: { chainId: number; from: `0x${string}`; to: `0x${string}`; data: `0x${string}`; value: string }; expiresAt: string; reviewUrl: string }
  | { type: "clarify"; question: string; options: string[] }
  | { type: "positions"; totalUsd: number | null; walletEth: string; rows: { name: string; ticker: string; slug: string; valueUsd: number | null; valueEth: number | null }[] }
  | { type: "signal"; target: number; ethPrice: number; eth: boolean[]; btc: boolean[]; fullAbove: number | null; firstStepBelow: number | null; asideBelowEth: number | null }
  | { type: "vault"; slug: string; name: string; ticker: string; valueUsd: number | null; sinceLaunchPct: number | null; summary: string; url: string }
  | { type: "notice"; tone: "info" | "warn"; text: string; link?: { label: string; href: string } }
  | { type: "watch"; rule: import("./watch").WatchRule; label: string }
  | { type: "intent"; action: "deposit" | "withdraw"; vault: string; amount_eth?: string; amount_usd?: string; percent_of_wallet?: number; percent?: number };

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AgentRequest = { messages: ChatMessage[]; wallet?: string; page?: { path?: string; vault?: string }; dryRun?: boolean; model?: string };
export type AgentResponse = { reply: string; cards: Card[]; meta: { model: string; ms: number; tools: string[]; tokensIn: number; tokensOut: number; costUsd: number; fallback: boolean } };
