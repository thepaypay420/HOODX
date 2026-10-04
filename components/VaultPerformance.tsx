"use client";

import { useEffect, useState } from "react";
import { decodeEventLog, formatEther, parseAbi, zeroAddress, type Address, type Log } from "viem";
import { publicClient } from "@/lib/publicClient";
import { walletReturn } from "@/lib/v2Performance";

const events = parseAbi([
  "event Deposit(address indexed user,uint256 gross,uint256 shares,uint256 fee)",
  "event Withdraw(address indexed user,uint256 shares,uint256 ethOut)",
  "event InKindReserved(address indexed user,uint256 shares)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const startBlock = 67761602n;
const history = new Map<string, { block: bigint; logs: Log[] }>();
const pct = (bps?: bigint) => bps === undefined ? "—" : `${bps > 0n ? "+" : ""}${(Number(bps) / 100).toFixed(2)}%`;

type HistoryResult = { key: string; block: bigint; deposited: bigint; withdrawn: bigint; uncertain: boolean; firstDepositBlock?: bigint };

export function VaultPerformance({ vault, symbol, account, assets, shares, supply, block, valuationFailed, estimated }: { vault: Address; symbol: string; account?: Address; assets?: bigint; shares?: bigint; supply?: bigint; block?: bigint; valuationFailed?: boolean; estimated?: boolean }) {
  const [result, setResult] = useState<HistoryResult>();
  const [error, setError] = useState(false);
  const key = `${vault.toLowerCase()}:${account?.toLowerCase() || "viewer"}`;

  useEffect(() => {
    if (block === undefined || !account) return;
    let active = true;
    setError(false);
    async function load() {
      const cached = history.get(key);
      let logs: Log[];
      {
        const from = cached && cached.block <= block! ? (cached.block > startBlock + 100n ? cached.block - 100n : startBlock) : startBlock;
        logs = cached && cached.block <= block! ? cached.logs.filter((log) => log.blockNumber !== null && log.blockNumber < from) : [];
        try {
          // The RPC answers an address-filtered range of up to 10M blocks in one call.
          const windows: Promise<Log[]>[] = [];
          for (let cursor = from; cursor <= block!; cursor += 9_000_000n) windows.push(publicClient.getLogs({ address: vault, fromBlock: cursor, toBlock: cursor + 8_999_999n > block! ? block! : cursor + 8_999_999n }));
          logs.push(...(await Promise.all(windows)).flat());
        } catch {
          // Fallback: 100k-block slices, ten at a time (the RPC accepts 100k-block ranges; 10k slices took ~1,200 calls).
          const slices: [bigint, bigint][] = [];
          for (let cursor = from; cursor <= block!; cursor += 100_000n) slices.push([cursor, cursor + 99_999n > block! ? block! : cursor + 99_999n]);
          for (let i = 0; i < slices.length; i += 10) {
            if (!active) return;
            const part = slices.slice(i, i + 10);
            logs.push(...(await Promise.all(part.map(([a, b]) => publicClient.getLogs({ address: vault, fromBlock: a, toBlock: b })))).flat());
            if (active) history.set(key, { block: part[part.length - 1][1], logs: [...logs] });
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
  const personal = current && account && !current.uncertain && assets !== undefined && supply !== undefined && shares !== undefined
    ? walletReturn(assets, supply, shares, current.deposited, current.withdrawn) : undefined;
  if (!account || !shares) return null;
  const value = assets !== undefined && supply ? assets * shares / supply : undefined;
  const eth = (v: bigint, digits: number) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: digits });
  return <section className="vp-position holo">
    <div><p>Your position{estimated ? " · est." : ""}</p><strong>{value === undefined ? "—" : eth(value, 5)}<small>ETH</small></strong><span>{eth(shares, 4)} {symbol} shares</span></div>
    <div className="vp-position-return"><p>Your return</p><strong className={personal ? personal.bps < 0n ? "is-down" : "is-up" : ""}>{pct(personal?.bps)}</strong><span>{valuationFailed ? "Waiting for prices" : error ? "History unavailable" : current?.uncertain ? "Needs cost basis" : personal ? `${personal.pnl > 0n ? "+" : ""}${eth(personal.pnl, 6)} ETH` : current ? "No deposits recorded" : "Reading history…"}</span></div>
  </section>;
}
