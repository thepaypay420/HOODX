"use client";

import { useEffect, useState } from "react";
import { decodeEventLog, formatEther, parseAbi, parseAbiItem, zeroAddress, type Address, type Log } from "viem";
import { publicClient } from "@/lib/wallet";
import { launchReturnBps, walletReturn } from "@/lib/v2Performance";

const events = parseAbi([
  "event Deposit(address indexed user,uint256 gross,uint256 shares,uint256 fee)",
  "event Withdraw(address indexed user,uint256 shares,uint256 ethOut)",
  "event InKindReserved(address indexed user,uint256 shares)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const depositEvent = parseAbiItem("event Deposit(address indexed user,uint256 gross,uint256 shares,uint256 fee)");
const startBlock = 67761602n;
const history = new Map<string, { block: bigint; logs: Log[] }>();
const pct = (bps?: bigint) => bps === undefined ? "—" : `${bps > 0n ? "+" : ""}${(Number(bps) / 100).toFixed(2)}%`;

type HistoryResult = { key: string; block: bigint; deposited: bigint; withdrawn: bigint; uncertain: boolean; firstDepositBlock?: bigint };

async function firstDepositLog(vault: Address, currentBlock: bigint): Promise<Log | undefined> {
  let low = startBlock;
  let high = currentBlock;
  try {
    while (low < high) {
      const mid = (low + high) / 2n;
      const code = await publicClient.getBytecode({ address: vault, blockNumber: mid });
      if (code && code !== "0x") high = mid;
      else low = mid + 1n;
    }
  } catch {
    low = startBlock;
  }
  for (let from = low; from <= currentBlock; from += 10_000n) {
    const end = from + 9_999n > currentBlock ? currentBlock : from + 9_999n;
    const logs = await publicClient.getLogs({ address: vault, event: depositEvent, fromBlock: from, toBlock: end });
    if (logs.length) return logs[0] as Log;
  }
}

function PerformanceGlyph({kind}:{kind:"vault"|"wallet"}){
  return kind==="vault"?<svg className="performance-glyph" viewBox="0 0 120 90" aria-hidden="true"><circle cx="61" cy="45" r="31"/><path d="M28 58 47 43l14 9 27-27"/><path d="m80 25 8 0 0 8"/><circle className="glyph-pulse" cx="88" cy="25" r="4"/></svg>:<svg className="performance-glyph" viewBox="0 0 120 90" aria-hidden="true"><path d="M27 30h62a9 9 0 0 1 9 9v31H34a10 10 0 0 1-10-10V34a8 8 0 0 1 8-8h49"/><path d="M77 43h25v18H77a9 9 0 0 1 0-18Z"/><circle className="glyph-pulse" cx="82" cy="52" r="3"/><path d="M42 49h22M42 58h15"/></svg>;
}

export function VaultPerformance({ vault, account, assets, shares, supply, block, valuationFailed, estimated }: { vault: Address; account?: Address; assets?: bigint; shares?: bigint; supply?: bigint; block?: bigint; valuationFailed?: boolean; estimated?: boolean }) {
  const [result, setResult] = useState<HistoryResult>();
  const [error, setError] = useState(false);
  const key = `${vault.toLowerCase()}:${account?.toLowerCase() || "viewer"}`;

  useEffect(() => {
    if (block === undefined) return;
    let active = true;
    setError(false);
    async function load() {
      const cached = history.get(key);
      let logs: Log[];
      if (!account) {
        const first = cached?.logs[0] || await firstDepositLog(vault, block!);
        logs = first ? [first] : [];
      } else {
        const from = cached && cached.block <= block! ? (cached.block > startBlock + 100n ? cached.block - 100n : startBlock) : startBlock;
        logs = cached && cached.block <= block! ? cached.logs.filter((log) => log.blockNumber !== null && log.blockNumber < from) : [];
        try {
          logs.push(...await publicClient.getLogs({ address: vault, fromBlock: from, toBlock: block! }));
        } catch {
          for (let cursor = from; cursor <= block!; cursor += 10000n) {
            if (!active) return;
            const end = cursor + 9999n > block! ? block! : cursor + 9999n;
            logs.push(...await publicClient.getLogs({ address: vault, fromBlock: cursor, toBlock: end }));
            if (active) history.set(key, { block: end, logs: [...logs] });
          }
        }
      }
      let deposited = 0n;
      let withdrawn = 0n;
      let uncertain = false;
      let firstDepositBlock: bigint | undefined;
      for (const log of logs) {
        let event;
        try { event = decodeEventLog({ abi: events, data: log.data, topics: log.topics }); } catch { continue; }
        if (event.eventName === "Deposit") {
          if (log.blockNumber !== null && (firstDepositBlock === undefined || log.blockNumber < firstDepositBlock)) firstDepositBlock = log.blockNumber;
          if (account && event.args.user.toLowerCase() === account.toLowerCase()) deposited += event.args.gross;
        }
        if (account && event.eventName === "Withdraw" && event.args.user.toLowerCase() === account.toLowerCase()) withdrawn += event.args.ethOut;
        if (account && event.eventName === "InKindReserved" && event.args.user.toLowerCase() === account.toLowerCase()) uncertain = true;
        if (account && event.eventName === "Transfer" && event.args.value > 0n && event.args.from !== zeroAddress && event.args.to !== zeroAddress && (event.args.from.toLowerCase() === account.toLowerCase() || event.args.to.toLowerCase() === account.toLowerCase())) uncertain = true;
      }
      if (!active) return;
      history.set(key, { block: block!, logs });
      setResult({ key, block: block!, deposited, withdrawn, uncertain, firstDepositBlock });
    }
    void load().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [vault, account, block, key]);

  const current = result?.key === key && result.block === block ? result : undefined;
  const launch = assets !== undefined && supply !== undefined ? launchReturnBps(assets, supply) : undefined;
  const personal = current && account && !current.uncertain && assets !== undefined && supply !== undefined && shares !== undefined
    ? walletReturn(assets, supply, shares, current.deposited, current.withdrawn) : undefined;
  return <section className="vault-performance holo">
    <div className="performance-reading"><div><p className="vault-eyebrow">{estimated ? "ESTIMATED VAULT PERFORMANCE" : "VAULT PERFORMANCE"}</p><strong className={launch !== undefined && launch < 0n ? "vault-loss" : ""}>{pct(launch)}</strong><p>{valuationFailed ? "Waiting for validated asset prices" : "Per-share return since launch"}</p></div><PerformanceGlyph kind="vault"/></div>
    <div className="performance-reading"><div><p className="vault-eyebrow">{estimated ? "YOUR ESTIMATED RETURN" : "YOUR TOTAL RETURN"}</p><strong className={personal && personal.bps < 0n ? "vault-loss" : ""}>{pct(personal?.bps)}</strong><p>{!account ? "Connect wallet to view" : valuationFailed ? "Return unavailable while asset pricing is unavailable" : error ? "History unavailable — refresh to retry" : current?.uncertain ? "Transfers / in-kind exits need cost basis" : personal ? `${Number(formatEther(personal.pnl)).toLocaleString(undefined,{maximumFractionDigits:6})} ETH profit / loss` : current ? "No direct deposits recorded" : "Reading your on-chain history…"}</p></div><PerformanceGlyph kind="wallet"/></div>
    <details><summary>How returns are calculated</summary><p>Vault return compares current ETH value per share with the 0.04 ETH launch price. Wallet return is current share value plus ETH withdrawals minus gross deposits, divided by gross deposits. Includes deposit fees; excludes gas. Values use oracle NAV when available; otherwise they use a labeled estimate from current Uniswap sale quotes. Transferred shares and in-kind exits require a separate cost basis.</p></details>
  </section>;
}
