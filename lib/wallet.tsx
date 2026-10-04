"use client";

import { Component, Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address, WalletClient } from "viem";

export { publicClient } from "@/lib/publicClient";

/* The app's wallet API. Every page talks to this small context; the wallet stack behind it (wagmi, WalletConnect and the
 * RainbowKit sheet in lib/walletStack.tsx) is the heaviest code on the site, so it loads just after the page is up — in time
 * to reconnect a returning wallet — or at once when someone taps Connect. First paint never waits for it. */
const WalletStack = lazy(() => import("@/lib/walletStack"));

export type Eip1193 = { request: (a: { method: string; params?: unknown }) => Promise<unknown> };
export type StackState = {
  address?: Address;
  chainId?: number;
  connecting: boolean;
  walletClient?: WalletClient;
  provider?: Eip1193;
  open: () => void;
  disconnect: () => void;
  switchToRobinhood: () => Promise<void>;
};

type WalletState = {
  address?: Address;
  chainId?: number;
  connecting: boolean;
  /** Opens the wallet sheet. Resolves at once; the connection lands through `address`. */
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToRobinhood: () => Promise<void>;
  walletClient?: WalletClient;
};

const Ctx = createContext<WalletState | null>(null);

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

/** The connected wallet's provider, for the few calls that go straight to the wallet (wallet_watchAsset). */
let activeProvider: Eip1193 | undefined;
export const connectedProvider = () => activeProvider;

/** A failure inside the wallet stack (a wallet extension misbehaving, a network error) must never take the page down. */
class WalletBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("[wallet]", error); this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState(false);
  const [stack, setStack] = useState<StackState | null>(null);
  const [openSignal, setOpenSignal] = useState(0);

  useEffect(() => {
    if ("requestIdleCallback" in window) { const id = window.requestIdleCallback(() => setLoad(true), { timeout: 2500 }); return () => window.cancelIdleCallback(id); }
    const id = setTimeout(() => setLoad(true), 1200);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => { activeProvider = stack?.address ? stack.provider : undefined; }, [stack]);

  const connect = useCallback(async () => { setLoad(true); setOpenSignal((n) => n + 1); }, []);
  const disconnect = useCallback(() => stack?.disconnect(), [stack]);
  const switchToRobinhood = useCallback(async () => { await stack?.switchToRobinhood(); }, [stack]);

  const value = useMemo<WalletState>(
    () => ({
      address: stack?.address,
      chainId: stack?.chainId,
      // a Connect tap while the stack is still loading shows as connecting
      connecting: stack ? stack.connecting : openSignal > 0,
      connect,
      disconnect,
      switchToRobinhood,
      walletClient: stack?.walletClient,
    }),
    [stack, openSignal, connect, disconnect, switchToRobinhood],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {load && <WalletBoundary onFail={() => { setStack(null); setOpenSignal(0); }}><Suspense fallback={null}><WalletStack onState={setStack} openSignal={openSignal} /></Suspense></WalletBoundary>}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet");
  return ctx;
}
