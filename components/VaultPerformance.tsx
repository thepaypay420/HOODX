"use client";

import { useEffect, useMemo, useState } from "react";
import { decodeEventLog, formatEther, parseAbi, parseAbiItem, zeroAddress, type Address, type Log } from "viem";
import { basketHoldReturnFromValue, excessReturnBps } from "@/lib/basketBenchmark";
import { publicClient } from "@/lib/wallet";
import { launchReturnBps, walletReturn } from "@/lib/v2Performance";

const events = parseAbi([
  "event Deposit(address indexed user,uint256 gross,uint256 shares,uint256 fee)",
  "event Withdraw(address indexed user,uint256 shares,uint256 ethOut)",
  "event InKindReserved(address indexed user,uint256 shares)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const depositEvent = parseAbiItem("event Deposit(address indexed user,uint256 gross,uint256 shares,uint256 fee)");
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const benchmarkVaultAbi = parseAbi([
  "function constituents() view returns (address[])",
  "function policy() view returns (address)",
  "function configId(address) view returns (bytes32)",
  "function weth() view returns (address)",
]);
const policyAbi = parseAbi(["function config(bytes32) view returns (address token,address oracle,bytes buy,bytes sell)"]);
const oracleAbi = parseAbi(["function value(address,uint256) view returns (uint256)"]);
const startBlock = 67761602n;
const history = new Map<string, { block: bigint; logs: Log[] }>();
const benchmarks = new Map<string, bigint>();
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

async function loadOriginalBasketReturn(vault: Address, firstDeposit: Log, currentBlock: bigint) {
  if (!firstDeposit.transactionHash) return undefined;
  const deposit = decodeEventLog({ abi: [depositEvent], data: firstDeposit.data, topics: firstDeposit.topics });
  const initialNet = deposit.args.gross - deposit.args.fee;
  const receipt = await publicClient.getTransactionReceipt({ hash: firstDeposit.transactionHash });
  const flows = new Map<string, bigint>();
  for (const log of receipt.logs) {
    try {
      const transfer = decodeEventLog({ abi: [transferEvent], data: log.data, topics: log.topics });
      const token = log.address.toLowerCase();
      let net = flows.get(token) || 0n;
      if (transfer.args.to.toLowerCase() === vault.toLowerCase()) net += transfer.args.value;
      if (transfer.args.from.toLowerCase() === vault.toLowerCase()) net -= transfer.args.value;
      flows.set(token, net);
    } catch {}
  }
  const [tokens, policy, weth] = await Promise.all([
    publicClient.readContract({ address: vault, abi: benchmarkVaultAbi, functionName: "constituents", blockNumber: currentBlock }),
    publicClient.readContract({ address: vault, abi: benchmarkVaultAbi, functionName: "policy", blockNumber: currentBlock }),
    publicClient.readContract({ address: vault, abi: benchmarkVaultAbi, functionName: "weth", blockNumber: currentBlock }),
  ]);
  const allowed = new Set(tokens.map((token) => token.toLowerCase()));
  let currentValue = flows.get(weth.toLowerCase()) || 0n;
  for (const [token, amount] of flows) {
    if (amount <= 0n || token.toLowerCase() === weth.toLowerCase()) continue;
    if (!allowed.has(token.toLowerCase())) return undefined;
    const tokenAddress = token as Address;
    const id = await publicClient.readContract({ address: vault, abi: benchmarkVaultAbi, functionName: "configId", args: [tokenAddress], blockNumber: currentBlock });
    const [, oracle] = await publicClient.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [id], blockNumber: currentBlock });
    currentValue += await publicClient.readContract({ address: oracle, abi: oracleAbi, functionName: "value", args: [tokenAddress, amount], blockNumber: currentBlock });
  }
  return basketHoldReturnFromValue(initialNet, currentValue);
}

export function VaultPerformance({ vault, account, assets, shares, supply, block, valuationFailed, estimated }: { vault: Address; account?: Address; assets?: bigint; shares?: bigint; supply?: bigint; block?: bigint; valuationFailed?: boolean; estimated?: boolean }) {
  const [result, setResult] = useState<HistoryResult>();
  const [benchmark, setBenchmark] = useState<bigint>();
  const [benchmarkDone, setBenchmarkDone] = useState(false);
  const [error, setError] = useState(false);
  const key = `${vault.toLowerCase()}:${account?.toLowerCase() || "viewer"}`;

  useEffect(() => {
    if (block === undefined) return;
    let active = true;
    setError(false);
    const cachedBenchmark = benchmarks.get(vault.toLowerCase());
    setBenchmark(cachedBenchmark);
    setBenchmarkDone(cachedBenchmark !== undefined);
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
      let firstDeposit: Log | undefined;
      for (const log of logs) {
        let event;
        try { event = decodeEventLog({ abi: events, data: log.data, topics: log.topics }); } catch { continue; }
        if (event.eventName === "Deposit") {
          if (log.blockNumber !== null && (firstDepositBlock === undefined || log.blockNumber < firstDepositBlock)) { firstDepositBlock = log.blockNumber; firstDeposit = log; }
          if (account && event.args.user.toLowerCase() === account.toLowerCase()) deposited += event.args.gross;
        }
        if (account && event.eventName === "Withdraw" && event.args.user.toLowerCase() === account.toLowerCase()) withdrawn += event.args.ethOut;
        if (account && event.eventName === "InKindReserved" && event.args.user.toLowerCase() === account.toLowerCase()) uncertain = true;
        if (account && event.eventName === "Transfer" && event.args.value > 0n && event.args.from !== zeroAddress && event.args.to !== zeroAddress && (event.args.from.toLowerCase() === account.toLowerCase() || event.args.to.toLowerCase() === account.toLowerCase())) uncertain = true;
      }
      if (!active) return;
      history.set(key, { block: block!, logs });
      setResult({ key, block: block!, deposited, withdrawn, uncertain, firstDepositBlock });
      if (firstDepositBlock !== undefined && firstDeposit) {
        try {
          const nextBenchmark = await loadOriginalBasketReturn(vault, firstDeposit, block!);
          if (nextBenchmark !== undefined) benchmarks.set(vault.toLowerCase(), nextBenchmark);
          setBenchmark(nextBenchmark);
          setBenchmarkDone(true);
        }
        catch { setBenchmark(undefined); setBenchmarkDone(true); }
      } else setBenchmarkDone(true);
    }
    void load().catch(() => { if (active) { setError(true); setBenchmarkDone(true); } });
    return () => { active = false; };
  }, [vault, account, block, key]);

  const current = result?.key === key && result.block === block ? result : undefined;
  const launch = assets !== undefined && supply !== undefined ? launchReturnBps(assets, supply) : undefined;
  const personal = current && account && !current.uncertain && assets !== undefined && supply !== undefined && shares !== undefined
    ? walletReturn(assets, supply, shares, current.deposited, current.withdrawn) : undefined;
  const excess = useMemo(() => excessReturnBps(launch, benchmark), [launch, benchmark]);

  return <section className="vault-performance holo">
    <div><p className="vault-eyebrow">{estimated ? "ESTIMATED VAULT PERFORMANCE" : "VAULT PERFORMANCE"}</p><strong className={launch !== undefined && launch < 0n ? "vault-loss" : ""}>{pct(launch)}</strong><p>{valuationFailed ? "Waiting for validated asset prices" : "Per-share return since launch"}</p></div>
    <div><p className="vault-eyebrow">VS ORIGINAL BASKET</p><strong className={excess !== undefined && excess < 0n ? "vault-loss" : ""}>{pct(excess)}</strong><p>{benchmark === undefined ? benchmarkDone ? "Original basket benchmark unavailable" : "Building the launch-weight benchmark" : `Original basket ${pct(benchmark)}`}</p></div>
    <div><p className="vault-eyebrow">{estimated ? "YOUR ESTIMATED RETURN" : "YOUR TOTAL RETURN"}</p><strong className={personal && personal.bps < 0n ? "vault-loss" : ""}>{pct(personal?.bps)}</strong><p>{!account ? "Connect wallet to view" : valuationFailed ? "Return unavailable while asset pricing is unavailable" : error ? "History unavailable — refresh to retry" : current?.uncertain ? "Transfers / in-kind exits need cost basis" : personal ? `${Number(formatEther(personal.pnl)).toLocaleString(undefined,{maximumFractionDigits:6})} ETH profit / loss` : current ? "No direct deposits recorded" : "Reading your on-chain history…"}</p></div>
    <details><summary>How returns are calculated</summary><p>Vault return compares current ETH value per share with the 0.04 ETH launch price. Original basket return tracks the launch allocation without later curator changes; “vs original basket” is the difference. Wallet return is current share value plus ETH withdrawals minus gross deposits, divided by gross deposits. Includes deposit fees; excludes gas. Values use oracle NAV when available; otherwise they use a labeled estimate from current Uniswap sale quotes. Transferred shares and in-kind exits require a separate cost basis.</p></details>
  </section>;
}
