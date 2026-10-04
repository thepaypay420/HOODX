"use client";

/* The wallet stack (wagmi, WalletConnect, RainbowKit's sheet). It is the heaviest code on the site, so lib/wallet.tsx loads
 * it just after the page is up, or at once on the first Connect tap. It reports its state upward; nothing renders through it. */
import "@rainbow-me/rainbowkit/styles.css";
import { memo, useEffect, useMemo, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { RainbowKitProvider, connectorsForWallets, useConnectModal } from "@rainbow-me/rainbowkit";
import {
  binanceWallet,
  bitgetWallet,
  bybitWallet,
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { robinhood } from "@/lib/chain";
import { RPC_URL, SITE_URL } from "@/lib/config";
import type { Eip1193, StackState } from "@/lib/wallet";
import { HoodxWalletTheme, WalletDisclaimer } from "@/lib/walletTheme";

/* Browser extensions are found automatically (EIP-6963) and listed first. Phone wallets connect over WalletConnect: tapping
 * one opens that wallet app to approve, then returns to the browser. WalletConnect needs a project id from cloud.reown.com
 * (public, not a secret). Without one, only extensions and wallets' own in-app browsers can connect. */
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// Robinhood Chain is a custom network that Coinbase's smart wallet does not serve, so Coinbase connects as the regular app.
coinbaseWallet.preference = "eoaOnly";

const connectors = connectorsForWallets(
  WC_PROJECT_ID
    ? [
        { groupName: "Popular", wallets: [metaMaskWallet, coinbaseWallet, rabbyWallet, trustWallet, rainbowWallet, okxWallet] },
        { groupName: "More wallets", wallets: [binanceWallet, bybitWallet, bitgetWallet, walletConnectWallet] },
      ]
    : [{ groupName: "Wallets", wallets: [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet] }],
  { appName: "HOODX", projectId: WC_PROJECT_ID || "unset", appUrl: SITE_URL, appIcon: `${SITE_URL}/icon.png`, appDescription: "Index tokens and vaults on Robinhood Chain" },
);

// ssr: true makes WagmiProvider restore a stored session once, in an effect. With it off, wagmi re-runs that restore on
// every render of the provider, and each restore re-renders it again.
const wagmiConfig = createConfig({ chains: [robinhood], connectors, transports: { [robinhood.id]: http(RPC_URL) }, ssr: true });
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Bridge({ onState, openSignal }: { onState: (s: StackState) => void; openSignal: number }) {
  const { address, chainId, connector, isConnecting, isReconnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { data: walletClient } = useWalletClient();

  // the library hands back fresh function objects on many renders; route through a ref so state is only reported on real changes
  const fns = useRef({ openConnectModal, disconnect, switchChainAsync });
  fns.current = { openConnectModal, disconnect, switchChainAsync };
  const api = useMemo(() => ({
    open: () => fns.current.openConnectModal?.(),
    disconnect: () => fns.current.disconnect(),
    // adds Robinhood Chain to the wallet first when the wallet does not know it yet (wallet_addEthereumChain)
    switchToRobinhood: async () => { await fns.current.switchChainAsync({ chainId: robinhood.id }); },
  }), []);

  // a Connect tap that arrived before the sheet was ready opens it as soon as it is
  const handled = useRef(0);
  const canOpen = Boolean(openConnectModal);
  useEffect(() => {
    if (address) { handled.current = openSignal; return; }
    if (openSignal > handled.current && canOpen) { handled.current = openSignal; fns.current.openConnectModal?.(); }
  }, [openSignal, canOpen, address]);

  const connecting = isConnecting && !isReconnecting;
  useEffect(() => {
    let live = true;
    const push = (provider?: Eip1193) => { if (live) onState({ address, chainId, connecting, walletClient: address ? walletClient : undefined, provider, ...api }); };
    push();
    // while a stored session is being restored, wagmi can report a connector that is not yet a live object
    if (typeof connector?.getProvider === "function") void connector.getProvider().then((p) => push(p as Eip1193)).catch(() => undefined);
    return () => { live = false; };
  }, [address, chainId, connector, connecting, walletClient, api, onState]);
  return null;
}

function WalletStack({ onState, openSignal }: { onState: (s: StackState) => void; openSignal: number }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={HoodxWalletTheme}
          initialChain={robinhood}
          modalSize="compact"
          appInfo={{ appName: "HOODX", learnMoreUrl: "https://ethereum.org/en/wallets/", disclaimer: WalletDisclaimer }}
        >
          <Bridge onState={onState} openSignal={openSignal} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// the page re-renders often; the stack only needs to when its own two props change
export default memo(WalletStack);
