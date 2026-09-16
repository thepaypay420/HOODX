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
    setChainId(Number.parseInt(chain, 16));
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
      setChainId(Number.parseInt(id, 16));
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
    if (!eth) throw new Error("No injected wallet. Install Rabby, MetaMask, or Robinhood Wallet.");
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
