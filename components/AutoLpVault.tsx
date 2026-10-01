"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BaseError, ContractFunctionRevertedError, formatEther, parseEther, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { publicClient, useWallet } from "@/lib/wallet";
import {
  AUTO_LP, AUTO_LP_V1, deadline, minOut, sizeShares, sleeveState,
  stockLpControllerAbi, stockLpSleeveAbi, stockLpVaultAbi,
} from "@/lib/stockLp";

type Holding = { sleeve: Address; stock: Address; tickLower: number; tickUpper: number; tick: number };
type Status = { inRange: boolean; referenceAgrees: boolean; breachStart: bigint; rebandReady: boolean };
type Snapshot = { supply: bigint; holdings: Holding[]; statuses: Status[]; paused: boolean; curator: Address; sleeves: Address[] };

const ZERO = 0n;
const short = (e: unknown) => {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message.slice(0, 140) : "failed";
};
const revertName = (e: unknown) => {
  if (!(e instanceof BaseError)) return "";
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? "" : "";
};

export function AutoLpVault() {
  const { address, chainId, walletClient, connect, switchToRobinhood } = useWallet();
  const vault = AUTO_LP.vault;
  const controller = AUTO_LP.controller;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mine, setMine] = useState<{ shares: bigint; ethValue: bigint | null }>({ shares: ZERO, ethValue: null });
  const [v1Shares, setV1Shares] = useState<bigint>(ZERO);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const now = Math.floor(Date.now() / 1000);
  const isCurator = !!address && address.toLowerCase() === AUTO_LP.curator.toLowerCase();

  const load = useCallback(async () => {
    if (!vault || !controller) return;
    const [supply, holdingsRaw, curator, sleeves] = await Promise.all([
      publicClient.readContract({ address: vault, abi: stockLpVaultAbi, functionName: "totalSupply" }),
      publicClient.readContract({ address: vault, abi: stockLpVaultAbi, functionName: "holdings" }),
      publicClient.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "curator" }),
      publicClient.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "sleeves" }),
    ]);
    const statuses = await Promise.all(sleeves.map((_, i) =>
      publicClient.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "status", args: [BigInt(i)] })
        .then(([inRange, referenceAgrees, breachStart, , rebandReady]) => ({ inRange, referenceAgrees, breachStart: BigInt(breachStart), rebandReady }))));
    const paused = sleeves.length ? await publicClient.readContract({ address: sleeves[0], abi: stockLpSleeveAbi, functionName: "managementPaused" }) : false;
    setSnap({
      supply, curator, sleeves: [...sleeves], statuses, paused,
      holdings: holdingsRaw.map((h) => ({ sleeve: h.sleeve, stock: h.stock, tickLower: h.tickLower, tickUpper: h.tickUpper, tick: h.tick })),
    });
  }, [vault, controller]);

  const loadMine = useCallback(async () => {
    if (!address) return;
    if (vault) {
      const shares = await publicClient.readContract({ address: vault, abi: stockLpVaultAbi, functionName: "balanceOf", args: [address] });
      let ethValue: bigint | null = null;
      if (shares > ZERO) {
        try {
          const sim = await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, address, 1n, deadline()] });
          ethValue = sim.result;
        } catch { ethValue = null; }
      }
      setMine({ shares, ethValue });
    }
    if (isCurator) {
      setV1Shares(await publicClient.readContract({ address: AUTO_LP_V1.vault, abi: stockLpVaultAbi, functionName: "balanceOf", args: [address] }));
    }
  }, [address, vault, isCurator]);

  useEffect(() => { void load().catch(() => setMsg("Could not read the vault right now.")); }, [load]);
  useEffect(() => { void loadMine().catch(() => {}); }, [loadMine]);

  const ready = async (): Promise<boolean> => {
    if (!address || !walletClient) { await connect(); return false; }
    if (chainId !== robinhood.id) { await switchToRobinhood(); return false; }
    return true;
  };
  const send = async (label: string, fn: () => Promise<`0x${string}`>) => {
    setBusy(true); setMsg(`${label}: confirm in your wallet…`);
    try {
      const hash = await fn();
      setMsg(`${label}: waiting for confirmation…`);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      setMsg(r.status === "success" ? `${label}: done.` : `${label}: reverted.`);
      await Promise.all([load(), loadMine()]);
    } catch (e) { setMsg(`${label}: ${short(e)}`); } finally { setBusy(false); }
  };

  const deposit = async () => {
    if (!vault || !snap || !(await ready()) || !address || !walletClient) return;
    let value: bigint;
    try { value = parseEther(amount || "0"); } catch { setMsg("Enter an ETH amount."); return; }
    if (value <= ZERO) { setMsg("Enter an ETH amount."); return; }
    setBusy(true); setMsg("Quoting the best entry…");
    try {
      // Probe how many shares this ETH buys right now, then request slightly fewer (unused ETH is refunded).
      let probe = snap.supply / 50n;
      let used = ZERO;
      for (let k = 0; k < 8 && used === ZERO; k++) {
        try {
          const sim = await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "depositEth", args: [probe, address, deadline()], value });
          used = sim.result;
        } catch (e) {
          const name = revertName(e);
          if (name === "BelowMinimum") probe = probe * 3n; else probe = probe / 3n;
          if (probe === ZERO) break;
        }
      }
      if (used === ZERO) { setMsg("Entry unavailable right now (minimum $10, cap $10k, or a pool is thin). Try another amount."); setBusy(false); return; }
      const shares = sizeShares(probe, used, value);
      await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "depositEth", args: [shares, address, deadline()], value });
      setBusy(false);
      await send("Deposit", () => walletClient.writeContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "depositEth", args: [shares, address, deadline()], value, chain: robinhood }));
      setAmount("");
    } catch (e) { setMsg(`Deposit: ${short(e)}`); setBusy(false); }
  };

  const withdraw = async (pct: bigint) => {
    if (!vault || !(await ready()) || !address || !walletClient) return;
    const shares = (mine.shares * pct) / 100n;
    if (shares <= ZERO) return;
    setBusy(true); setMsg("Quoting your ETH exit…");
    try {
      const sim = await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, address, 1n, deadline()] });
      const floor = minOut(sim.result);
      setBusy(false);
      await send(`Withdraw ${pct}%`, () => walletClient.writeContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, address, floor, deadline()], chain: robinhood }));
    } catch (e) { setMsg(`Withdraw: ${short(e)}. If ETH exit is unavailable, use the emergency exit below.`); setBusy(false); }
  };

  const emergencyExit = async () => {
    if (!vault || !(await ready()) || !address || !walletClient || mine.shares <= ZERO) return;
    await send("Emergency exit", () => walletClient.writeContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "exitToSleeveShares", args: [mine.shares, address], chain: robinhood }));
  };

  // ---------------------------------------------------------------- curator / autopilot
  const runAutopilot = async () => {
    if (!controller || !snap || !(await ready()) || !address || !walletClient) return;
    await send("Autopilot check", () => walletClient.writeContract({ account: address, address: controller, abi: stockLpControllerAbi, functionName: "signalAll", chain: robinhood }));
    for (let i = 0; i < snap.sleeves.length; i++) {
      const s = await publicClient.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "status", args: [BigInt(i)] });
      if (s[4]) await send(`Rebalance ${i + 1}`, () => walletClient.writeContract({ account: address, address: controller, abi: stockLpControllerAbi, functionName: "executeReband", args: [BigInt(i)], chain: robinhood }));
    }
  };
  const setPaused = async (paused: boolean) => {
    if (!controller || !(await ready()) || !address || !walletClient) return;
    await send(paused ? "Pause" : "Resume", () => walletClient.writeContract({ account: address, address: controller, abi: stockLpControllerAbi, functionName: "setManagementPaused", args: [paused], chain: robinhood }));
  };
  const claimAll = async () => {
    if (!snap || !(await ready()) || !address || !walletClient) return;
    for (const sleeve of snap.sleeves) {
      const [o0, o1] = await Promise.all([
        publicClient.readContract({ address: sleeve, abi: stockLpSleeveAbi, functionName: "feeOwed0" }),
        publicClient.readContract({ address: sleeve, abi: stockLpSleeveAbi, functionName: "feeOwed1" }),
      ]);
      if (o0 + o1 > ZERO) await send("Claim fees", () => walletClient.writeContract({ account: address, address: sleeve, abi: stockLpSleeveAbi, functionName: "claimFees", chain: robinhood }));
    }
  };
  const withdrawV1 = async () => {
    if (!(await ready()) || !address || !walletClient || v1Shares <= ZERO) return;
    try {
      const sim = await publicClient.simulateContract({ account: address, address: AUTO_LP_V1.vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [v1Shares, address, 1n, deadline()] });
      await send("Withdraw V1 seed", () => walletClient.writeContract({ account: address, address: AUTO_LP_V1.vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [v1Shares, address, minOut(sim.result), deadline()], chain: robinhood }));
    } catch (e) { setMsg(`V1 withdraw: ${short(e)}`); }
  };

  const symbols = useMemo(() => AUTO_LP.stocks, []);

  if (!vault || !controller) {
    return <section className="autolp-panel" aria-label="Vault">
      <div className="autolp-launching"><span className="autolp-badge"><i aria-hidden /> Launching</span>
        <p>The autopilot vault is being deployed. Deposits open here as soon as it is live and verified on-chain.</p></div>
      <div className="autolp-sleeves">{symbols.map((s) => <article key={s}><b>{s}</b><span>±1% range</span></article>)}</div>
      {isCurator && v1Shares > ZERO && <div className="autolp-curator"><h3>Curator</h3>
        <button type="button" disabled={busy} onClick={withdrawV1}>Withdraw V1 seed ({formatEther(v1Shares)} shares) to ETH</button>
        {msg && <p className="autolp-msg" role="status">{msg}</p>}</div>}
    </section>;
  }

  return <section className="autolp-panel" aria-label="Vault">
    <div className="autolp-actions">
      <div className="autolp-box">
        <h3>Deposit ETH</h3>
        <div className="autolp-input"><input inputMode="decimal" placeholder="0.05" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="ETH amount" /><span>ETH</span></div>
        <button type="button" className="landing-btn-primary" disabled={busy} onClick={deposit}>{address ? "Deposit" : "Connect wallet"}</button>
        <p className="autolp-fine">Min ${AUTO_LP.minUsd} · cap ${AUTO_LP.capUsd.toLocaleString()} total · unused ETH is refunded.</p>
      </div>
      <div className="autolp-box">
        <h3>Your position</h3>
        <p className="autolp-big">{mine.ethValue !== null ? `${Number(formatEther(mine.ethValue)).toFixed(5)} ETH` : mine.shares > ZERO ? "—" : "0 ETH"}</p>
        <p className="autolp-fine">{formatEther(mine.shares)} {AUTO_LP.symbol}</p>
        <div className="autolp-row">{[25n, 50n, 100n].map((p) => <button key={String(p)} type="button" disabled={busy || mine.shares <= ZERO} onClick={() => withdraw(p)}>Withdraw {String(p)}%</button>)}</div>
        <button type="button" className="autolp-link" disabled={busy || mine.shares <= ZERO} onClick={emergencyExit}>Emergency exit (receive the underlying positions)</button>
      </div>
    </div>
    {msg && <p className="autolp-msg" role="status">{msg}</p>}
    <div className="autolp-status-head"><h3>Autopilot status</h3>{snap?.paused && <span className="autolp-paused">Management paused · exits open</span>}</div>
    <div className="autolp-sleeves">
      {(snap?.holdings ?? []).map((h, i) => {
        const st = snap!.statuses[i];
        const state = st ? sleeveState(st, now) : { label: "…", tone: "info" as const };
        const span = h.tickUpper - h.tickLower;
        const pos = span > 0 ? Math.min(100, Math.max(0, ((h.tick - h.tickLower) / span) * 100)) : 50;
        return <article key={h.sleeve} className={`is-${state.tone}`}>
          <b>{symbols[i] ?? `#${i + 1}`}</b><span>{state.label}</span>
          <div className="autolp-range" aria-hidden><i style={{ left: `${pos}%` }} /></div>
        </article>;
      })}
    </div>
    {isCurator && <div className="autolp-curator">
      <h3>Curator panel</h3>
      <p className="autolp-fine">Rebalances and compounding run automatically. These controls are for oversight and emergencies.</p>
      <div className="autolp-row">
        <button type="button" disabled={busy} onClick={runAutopilot}>Run autopilot now</button>
        <button type="button" disabled={busy} onClick={claimAll}>Claim fees to treasury</button>
        <button type="button" disabled={busy} onClick={() => setPaused(!snap?.paused)}>{snap?.paused ? "Resume management" : "Pause management"}</button>
        {v1Shares > ZERO && <button type="button" disabled={busy} onClick={withdrawV1}>Withdraw V1 seed</button>}
      </div>
    </div>}
  </section>;
}
