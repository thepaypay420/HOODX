import { defineChain } from "viem";
import { CHAIN_ID, EXPLORER, RPC_URL } from "./config";

export const robinhood = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER },
  },
  contracts: {
    // Canonical Multicall3, deployed on Robinhood Chain. Lets the browser client fold concurrent reads into one eth_call.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});
