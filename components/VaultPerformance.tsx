"use client";

import { useEffect, useState } from "react";
import { decodeEventLog, formatEther, parseAbi, zeroAddress, type Address, type Log } from "viem";
import { publicClient } from "@/lib/wallet";
import { verifiedV2Vaults } from "@/lib/v2";
import { launchReturnBps, walletReturn } from "@/lib/v2Performance";

const events = parseAbi([
  "event Deposit(address indexed user,uint256 gross,uint256 shares,uint256 fee)",
  "event Withdraw(address indexed user,uint256 shares,uint256 ethOut)",
  "event InKindReserved(address indexed user,uint256 shares)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
// Both official vaults were created by the production factory deployment after this block.
const startBlock = 67761602n;
const history = new Map<string, { block: bigint; logs: Log[] }>();
const pct = (bps?: bigint) => bps === undefined ? "—" : `${bps > 0n ? "+" : ""}${(Number(bps) / 100).toFixed(2)}%`;

export function VaultPerformance({ vault, account, assets, shares, supply, block, valuationFailed, estimated }: { vault: Address; account?: Address; assets?: bigint; shares?: bigint; supply?: bigint; block?: bigint; valuationFailed?: boolean; estimated?: boolean }) {
  const [result, setResult] = useState<{ key: string; block: bigint; deposited: bigint; withdrawn: bigint; uncertain: boolean }>();
  const [error, setError] = useState(false);
  const official = Object.values(verifiedV2Vaults).some(a => a.toLowerCase() === vault.toLowerCase());
  const key = `${vault.toLowerCase()}:${account?.toLowerCase()}`;
  useEffect(() => {
    if (!account || block === undefined || !official) return;
    let active = true; setError(false);
    async function load() {
      const cached = history.get(vault.toLowerCase());
      // Re-read the trailing 100 blocks to avoid retaining a short reorg.
      const from = cached && cached.block <= block! ? (cached.block > startBlock + 100n ? cached.block - 100n : startBlock) : startBlock;
      const logs = cached && cached.block <= block! ? cached.logs.filter(l => l.blockNumber !== null && l.blockNumber < from) : [];
      for (let cursor = from; cursor <= block!; cursor += 10000n) {
        if (!active) return;
        const end = cursor + 9999n > block! ? block! : cursor + 9999n;
        logs.push(...await publicClient.getLogs({ address: vault, fromBlock: cursor, toBlock: end }));
        // Preserve completed pages so the next balance refresh resumes instead of restarting launch history.
        if (active) history.set(vault.toLowerCase(), { block: end, logs: [...logs] });
      }
      let deposited = 0n, withdrawn = 0n, uncertain = false;
      for (const log of logs) {
        let event;
        try { event = decodeEventLog({ abi: events, data: log.data, topics: log.topics }); } catch { continue; }
        if (event.eventName === "Deposit" && event.args.user.toLowerCase() === account!.toLowerCase()) deposited += event.args.gross;
        if (event.eventName === "Withdraw" && event.args.user.toLowerCase() === account!.toLowerCase()) withdrawn += event.args.ethOut;
        if (event.eventName === "InKindReserved" && event.args.user.toLowerCase() === account!.toLowerCase()) uncertain = true;
        if (event.eventName === "Transfer" && event.args.value > 0n && event.args.from !== zeroAddress && event.args.to !== zeroAddress && (event.args.from.toLowerCase() === account!.toLowerCase() || event.args.to.toLowerCase() === account!.toLowerCase())) uncertain = true;
      }
      if (active) { history.set(vault.toLowerCase(), { block: block!, logs }); setResult({ key, block: block!, deposited, withdrawn, uncertain }); }
    }
    void load().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [vault, account, block, key, official]);
  const current = result?.key === key && result.block === block ? result : undefined;
  const launch = assets !== undefined && supply !== undefined && official ? launchReturnBps(assets,supply) : undefined;
  const personal = current && !current.uncertain && assets !== undefined && supply !== undefined && shares !== undefined ? walletReturn(assets,supply,shares,current.deposited,current.withdrawn) : undefined;
  return <section className="vault-performance holo"><div><p className="vault-eyebrow">{estimated ? "ESTIMATED VAULT PERFORMANCE" : "VAULT PERFORMANCE"}</p><strong className={launch !== undefined && launch < 0n ? "vault-loss" : ""}>{pct(launch)}</strong><p>{valuationFailed ? "Waiting for validated asset prices" : "Per-share return since launch"}</p></div><div><p className="vault-eyebrow">{estimated ? "YOUR ESTIMATED RETURN" : "YOUR TOTAL RETURN"}</p><strong className={personal && personal.bps < 0n ? "vault-loss" : ""}>{pct(personal?.bps)}</strong><p>{!account ? "Connect wallet to view" : !official ? "History unavailable for this vault" : valuationFailed ? "Return unavailable while asset pricing is unavailable" : error ? "History unavailable — refresh to retry" : current?.uncertain ? "Transfers / in-kind exits need cost basis" : personal ? `${Number(formatEther(personal.pnl)).toLocaleString(undefined,{maximumFractionDigits:6})} ETH profit / loss` : current ? "No direct deposits recorded" : "Reading your on-chain history…"}</p></div><details><summary>How returns are calculated</summary><p>Vault return compares current ETH value per share with the 0.04 ETH launch price. Wallet return is current share value plus ETH withdrawals minus gross deposits, divided by gross deposits. Includes deposit fees; excludes gas. Values use oracle NAV when available; otherwise they use a labeled estimate from current Uniswap sale quotes. Neither is a guaranteed withdrawal amount. Switching valuation methods can change the displayed return. Transferred shares and in-kind exits require a separate cost basis and are not assigned an estimated gain. An empty vault has no current per-share return.</p></details></section>;
}

