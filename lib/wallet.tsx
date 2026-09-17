"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type WalletClient,
} from "viem";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";

export const publicClient = createPublicClient({
  chain: robinhood,
  transport: http(RPC_URL),
});

type WalletState = {
  address?: Address;
  chainId?: number;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToRobinhood: () => Promise<void>;
  walletClient?: WalletClient;
};

const Ctx = createContext<WalletState | null>(null);

type Ethereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (ev: string, fn: (...a: never[]) => void) => void;
  removeListener?: (ev: string, fn: (...a: never[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Ethereum;
  }
}

function injectedProvider(): Ethereum | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum;
}

/** Wallets disagree: hex "0x1237", decimal "4663", or a number. */
export function parseChainId(chain: unknown): number | undefined {
  if (chain == null || chain === "") return undefined;
  if (typeof chain === "bigint") return Number(chain);
  if (typeof chain === "number" && Number.isFinite(chain)) return chain;
  const s = String(chain).trim();
  if (!s) return undefined;
  const n = s.startsWith("0x") || s.startsWith("0X") ? Number.parseInt(s, 16) : Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    const eth = injectedProvider();
    if (!eth) return;
    const [accounts, chain] = await Promise.all([
      eth.request({ method: "eth_accounts" }) as Promise<string[]>,
      eth.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    setAddress(accounts[0] ? (accounts[0] as Address) : undefined);
    setChainId(parseChainId(chain));
  }, []);

  useEffect(() => {
    const eth = injectedProvider();
    if (!eth) return;
    void refresh();
    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts?.[0] ? (accounts[0] as Address) : undefined);
    };
    const onChain = (...args: never[]) => {
      const id = args[0] as string;
      setChainId(parseChainId(id));
    };
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    const eth = injectedProvider();
    if (!eth) {
      throw new Error("OPEN_IN_WALLET");
    }
    setConnecting(true);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await refresh();
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const disconnect = useCallback(() => {
    setAddress(undefined);
  }, []);

  const switchToRobinhood = useCallback(async () => {
    const eth = injectedProvider();
    if (!eth) return;
    const hex = `0x${robinhood.id.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 4902) throw err;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: robinhood.name,
            nativeCurrency: robinhood.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [robinhood.blockExplorers.default.url],
          },
        ],
      });
    }
    await refresh();
  }, [refresh]);

  const walletClient = useMemo(() => {
    const eth = injectedProvider();
    if (!eth || !address) return undefined;
    return createWalletClient({
      account: address,
      chain: robinhood,
      transport: custom(eth),
    });
  }, [address]);

  const value = useMemo(
    () => ({
      address,
      chainId,
      connecting,
      connect,
      disconnect,
      switchToRobinhood,
      walletClient,
    }),
    [address, chainId, connecting, connect, disconnect, switchToRobinhood, walletClient],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet");
  return ctx;
}
