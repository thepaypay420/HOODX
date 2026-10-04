"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { robinhood } from "@/lib/chain";
import { publicClient } from "@/lib/publicClient";
import { useWallet } from "@/lib/wallet";

/** Below this a wallet cannot make a first deposit plus gas, so it is shown how to bring ETH over. */
const LOW = parseEther("0.003");
/** The routes Robinhood's own docs list (docs.robinhood.com/chain/bridging): two fast partner bridges and the canonical one. */
const ROUTES = [
  { name: "Relay", short: "Relay", href: "https://relay.link/bridge/robinhood", note: "seconds" },
  { name: "Across", short: "Across", href: "https://across.to/?to=robinhood", note: "seconds" },
  { name: "Official bridge", short: "Official", href: "https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum", note: "~10 min" },
];
const DISMISS_KEY = "hoodx.fundNotice.dismissed";

/** One quiet line under the header, only while a connected wallet has (almost) no ETH on Robinhood Chain. It re-checks
 *  every 20 s while shown and when the tab regains focus, so it leaves by itself once the bridged ETH lands. */
export function FundNotice({ wide }: { wide: boolean }) {
  const { address, chainId } = useWallet();
  const [low, setLow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const on = Boolean(address) && chainId === robinhood.id;

  useEffect(() => {
    try { setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1"); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (!on || !address) { setLow(false); return; }
    let live = true;
    const check = () => publicClient.getBalance({ address }).then((b) => { if (live) setLow(b < LOW); }).catch(() => undefined);
    void check();
    const id = setInterval(check, 20_000);
    window.addEventListener("focus", check);
    return () => { live = false; clearInterval(id); window.removeEventListener("focus", check); };
  }, [on, address]);

  if (!on || !low || dismissed) return null;
  return (
    <div className={`fund-notice mx-auto px-4 sm:px-6 ${wide ? "max-w-6xl" : "max-w-5xl"}`} role="status">
      <div className="fund-notice-inner">
        <span className="fund-notice-dot" aria-hidden />
        <p>
          <strong>Add ETH on Robinhood Chain</strong>
          <span>Bridge from Ethereum, Base or Arbitrum to this wallet.</span>
        </p>
        <nav aria-label="Bridges">
          {ROUTES.map((r) => (
            <a key={r.name} href={r.href} target="_blank" rel="noopener noreferrer" className={r.name === "Official bridge" ? "is-quiet" : undefined}>
              <span className="fund-long">{r.name}</span><span className="fund-short">{r.short}</span><small>{r.note}</small>
            </a>
          ))}
        </nav>
        <button type="button" aria-label="Dismiss" onClick={() => { setDismissed(true); try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ } }}>×</button>
      </div>
    </div>
  );
}
