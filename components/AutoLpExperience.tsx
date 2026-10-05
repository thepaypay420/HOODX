"use client";

import Link from "next/link";
import { WhyChip } from "@/components/agent/Companion";
import { readIntent, INTENT_NOTE } from "@/lib/intent";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { BaseError, ContractFunctionRevertedError, formatEther, parseEther, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { EXPLORER } from "@/lib/config";
import { publicClient, useWallet } from "@/lib/wallet";
import { walletPnl } from "@/lib/autolpNav";
import {
  AUTO_LP, AUTO_LP_V1, AUTO_LP_V2, deadline, initialProbeShares, minOut, sizeShares,
  stockLpControllerAbi, stockLpSleeveAbi, stockLpVaultAbi,
} from "@/lib/stockLp";
import { fmtPct, fmtUsd, useAutoLpStats, useCountUp, useReveal, type AutoLpSleeveStat } from "@/lib/useAutoLp";
import { AutoLpOrbit } from "@/components/AutoLpOrbit";

const ZERO = 0n;
const addr = (a: string) => `${EXPLORER}/address/${a}`;
const errName = (e: unknown) => {
  if (!(e instanceof BaseError)) return "";
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? "" : "";
};
const short = (e: unknown) => errName(e) || (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message.slice(0, 140) : "failed");

/** Plain-language status for one stock. */
function describe(s: AutoLpSleeveStat, now: number) {
  if (!s.referenceAgrees) return { tone: "warn", label: "Price check paused", hint: "Pool and TWAP disagree; automation waits for them to agree." };
  if (s.inRange) return { tone: "good", label: "Earning", hint: `Price is inside its ${AUTO_LP.bandLabel} band, so every trade pays this position.` };
  if (s.rebandReady) return { tone: "info", label: "Rebalance due", hint: "The autopilot moves it next to the price on its next run (every 15 minutes)." };
  if (s.breachStart > 0) {
    const left = Math.ceil((AUTO_LP.breachDelaySec - (now - s.breachStart)) / 60);
    if (left <= 0) return { tone: "wait", label: "At the band edge", hint: "Just past its band: a move would land on the same range, so it waits for the price to move clearly." };
    return { tone: "wait", label: `Out of range · ${left} min to rebalance`, hint: `Waits ${AUTO_LP.breachDelaySec / 60} minutes before moving, so a brief spike doesn't trigger a move.` };
  }
  return { tone: "wait", label: "Waiting for price", hint: "Positioned next to the price, ready for it to come back." };
}

function Stat({ label, value, sub, tone, why }: { label: string; value: string; sub?: string; tone?: "up" | "down"; why?: string }) {
  return <div className="ap-stat"><span>{label}{why && <WhyChip question={why} />}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

export function AutoLpExperience() {
  const { address, chainId, walletClient, connect, switchToRobinhood } = useWallet();
  const { stats, failed } = useAutoLpStats();
  const vault = AUTO_LP.vault!, controller = AUTO_LP.controller!;
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // a deposit or withdrawal an AI assistant prepared (MCP review link): pre-fill only, the user still confirms
  const [intentPct, setIntentPct] = useState<bigint | null>(null);
  useEffect(() => {
    const i = readIntent();
    if (i.deposit) { setTab("deposit"); setAmount(i.deposit); setMsg(INTENT_NOTE); }
    else if (i.withdraw) { setTab("withdraw"); setIntentPct(BigInt(i.withdraw)); setMsg(INTENT_NOTE); }
  }, []);
  const [mine, setMine] = useState<{ shares: bigint; valueWei: bigint | null; ethBal: bigint; deposited: bigint; withdrawn: bigint }>(
    { shares: ZERO, valueWei: null, ethBal: ZERO, deposited: ZERO, withdrawn: ZERO });
  /** Shares this wallet still holds in retired vaults (exit-only): shown with a one-click ETH withdrawal. */
  const [retired, setRetired] = useState<{ label: string; vault: Address; shares: bigint }[]>([]);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const isCurator = !!address && address.toLowerCase() === AUTO_LP.curator.toLowerCase();
  const heroRef = useReveal<HTMLDivElement>(), boardRef = useReveal<HTMLDivElement>(), howRef = useReveal<HTMLDivElement>(), chainRef = useReveal<HTMLDivElement>();

  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000); return () => clearInterval(id); }, []);

  const loadMine = useCallback(async () => {
    if (!address) return;
    const [shares, ethBal, basis] = await Promise.all([
      publicClient.readContract({ address: vault, abi: stockLpVaultAbi, functionName: "balanceOf", args: [address] }),
      publicClient.getBalance({ address }),
      fetch(`/api/autolp-wallet?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    let valueWei: bigint | null = null;
    if (shares > ZERO) {
      try {
        valueWei = (await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, address, 1n, deadline()] })).result;
      } catch { valueWei = null; }
    }
    // "average" means shares also moved by transfer or in-kind exit: measure against the cost of the shares held now
    const avg = basis?.mode === "average" && basis.basisWei;
    setMine({ shares, valueWei, ethBal, deposited: BigInt(avg ? basis.basisWei : basis?.depositedWei ?? 0), withdrawn: avg ? 0n : BigInt(basis?.withdrawnWei ?? 0) });
    const old = [{ label: "V2", vault: AUTO_LP_V2.vault }, { label: "V1", vault: AUTO_LP_V1.vault }];
    const held = await Promise.all(old.map((o) => publicClient.readContract({ address: o.vault, abi: stockLpVaultAbi, functionName: "balanceOf", args: [address] }).catch(() => ZERO)));
    setRetired(old.map((o, i) => ({ ...o, shares: held[i] })).filter((o) => o.shares > ZERO));
    if (isCurator) {
      setPaused(await publicClient.readContract({ address: AUTO_LP.sleeves[0].sleeve, abi: stockLpSleeveAbi, functionName: "managementPaused" }));
    }
  }, [address, vault, isCurator]);
  useEffect(() => { void loadMine().catch(() => {}); }, [loadMine]);

  const ready = async () => {
    if (!address || !walletClient) { await connect(); return false; }
    if (chainId !== robinhood.id) { await switchToRobinhood(); return false; }
    return true;
  };
  const send = async (label: string, fn: () => Promise<`0x${string}`>) => {
    setBusy(true); setMsg(`${label}: confirm in your wallet…`);
    try {
      const hash = await fn();
      setMsg(`${label}: confirming…`);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      setMsg(r.status === "success" ? `${label} complete.` : `${label} reverted.`);
      await loadMine();
    } catch (e) { setMsg(`${label}: ${short(e)}`); } finally { setBusy(false); }
  };

  const deposit = async () => {
    if (!stats || !(await ready()) || !address || !walletClient) return;
    let value: bigint;
    try { value = parseEther(amount || "0"); } catch { setMsg("Enter an ETH amount."); return; }
    if (value <= ZERO) { setMsg("Enter an ETH amount."); return; }
    setBusy(true); setMsg("Finding the best entry…");
    try {
      // Probe near the real size: too small reverts BelowMinimum (grow), too large reverts on ETH (shrink).
      let probe = initialProbeShares(value, stats.perShareEth), used = ZERO, last = "", lo = ZERO, hi = ZERO, flaky = 0;
      if (probe === ZERO) probe = BigInt(Math.floor(stats.supply * 1e6)) * 10n ** 12n / 50n;
      for (let k = 0; k < 12 && used === ZERO && probe > ZERO; k++) {
        try { used = (await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "depositEth", args: [probe, address, deadline()], value })).result; }
        catch (e) {
          // An RPC hiccup (no revert) says nothing about size: retry the same probe.
          if (!(e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError)) && flaky++ < 3) { k--; continue; }
          // Bisect between the largest size known too small and the smallest known too large.
          last = errName(e);
          if (last === "BelowMinimum") lo = probe; else hi = probe;
          probe = lo > ZERO && hi > ZERO ? (lo + hi) / 2n : last === "BelowMinimum" ? probe * 2n : probe / 2n;
        }
      }
      if (used === ZERO) {
        setMsg(lo > ZERO ? "That amount is too close to the $10 minimum to enter. Try a little more ETH."
          : last === "CapExceeded" ? "The vault is at its $10,000 cap right now."
          : last === "Illiquid" || last === "Slippage" || last === "Divergence" ? "A stock pool can't take this size right now. Try a smaller amount or retry shortly."
          : `Entry unavailable right now${last ? ` (${last})` : ""}. Try another amount.`);
        setBusy(false); return;
      }
      const shares = sizeShares(probe, used, value);
      await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "depositEth", args: [shares, address, deadline()], value });
      setBusy(false);
      await send("Deposit", () => walletClient.writeContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "depositEth", args: [shares, address, deadline()], value, chain: robinhood }));
      setAmount("");
    } catch (e) { setMsg(`Deposit: ${short(e)}`); setBusy(false); }
  };
  const withdraw = async (pct: bigint) => {
    if (!(await ready()) || !address || !walletClient) return;
    const shares = (mine.shares * pct) / 100n;
    if (shares <= ZERO) return;
    setBusy(true); setMsg("Quoting your ETH exit…");
    try {
      const sim = await publicClient.simulateContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, address, 1n, deadline()] });
      setBusy(false);
      await send(`Withdraw ${pct}%`, () => walletClient.writeContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [shares, address, minOut(sim.result), deadline()], chain: robinhood }));
    } catch (e) { setMsg(`Withdraw: ${short(e)}. If ETH exit is unavailable, use the emergency exit.`); setBusy(false); }
  };
  const emergency = async () => {
    if (!(await ready()) || !address || !walletClient || mine.shares <= ZERO) return;
    await send("Emergency exit", () => walletClient.writeContract({ account: address, address: vault, abi: stockLpVaultAbi, functionName: "exitToSleeveShares", args: [mine.shares, address], chain: robinhood }));
  };
  const runAutopilot = async () => {
    if (!(await ready()) || !address || !walletClient) return;
    await send("Autopilot check", () => walletClient.writeContract({ account: address, address: controller, abi: stockLpControllerAbi, functionName: "signalAll", chain: robinhood }));
    for (let i = 0; i < AUTO_LP.sleeves.length; i++) {
      const s = await publicClient.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "status", args: [BigInt(i)] });
      if (s[4]) await send(`Rebalance ${AUTO_LP.sleeves[i].symbol}`, () => walletClient.writeContract({ account: address, address: controller, abi: stockLpControllerAbi, functionName: "executeReband", args: [BigInt(i)], chain: robinhood }));
    }
  };
  const togglePause = async () => {
    if (!(await ready()) || !address || !walletClient) return;
    await send(paused ? "Resume" : "Pause", () => walletClient.writeContract({ account: address, address: controller, abi: stockLpControllerAbi, functionName: "setManagementPaused", args: [!paused], chain: robinhood }));
  };
  const claimAll = async () => {
    if (!(await ready()) || !address || !walletClient) return;
    for (const s of AUTO_LP.sleeves) {
      const [o0, o1] = await Promise.all([
        publicClient.readContract({ address: s.sleeve, abi: stockLpSleeveAbi, functionName: "feeOwed0" }),
        publicClient.readContract({ address: s.sleeve, abi: stockLpSleeveAbi, functionName: "feeOwed1" }),
      ]);
      if (o0 + o1 > ZERO) await send(`Claim ${s.symbol} fees`, () => walletClient.writeContract({ account: address, address: s.sleeve, abi: stockLpSleeveAbi, functionName: "claimFees", chain: robinhood }));
    }
  };
  const withdrawRetired = async (r: { label: string; vault: Address; shares: bigint }) => {
    if (!(await ready()) || !address || !walletClient || r.shares <= ZERO) return;
    try {
      const sim = await publicClient.simulateContract({ account: address, address: r.vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [r.shares, address, 1n, deadline()] });
      await send(`Withdraw from retired ${r.label}`, () => walletClient.writeContract({ account: address, address: r.vault, abi: stockLpVaultAbi, functionName: "withdrawEth", args: [r.shares, address, minOut(sim.result), deadline()], chain: robinhood }));
    } catch (e) { setMsg(`Retired ${r.label} withdraw: ${short(e)}`); }
  };

  const since = useCountUp(stats?.sinceLaunchUsdPct), tvl = useCountUp(stats?.navUsd), price = useCountUp(stats?.perShareUsd);
  const earning = stats?.sleeves.filter((s) => s.inRange && s.referenceAgrees).length;
  const estUsd = (() => { try { return stats && amount ? Number(formatEther(parseEther(amount))) * stats.ethUsd : undefined; } catch { return undefined; } })();
  const pnl = mine.valueWei !== null ? walletPnl(mine.valueWei, mine.deposited, mine.withdrawn) : undefined;
  const maxEth = mine.ethBal > 400_000_000_000_000n ? mine.ethBal - 400_000_000_000_000n : ZERO; // keep gas
  const updated = stats ? Math.max(0, Math.round((now - stats.updatedAt) / 60)) : undefined;
  const sleeves = stats?.sleeves;
  const board = useMemo(() => (sleeves ?? []).map((s, i) => ({ s, i, d: describe(s, now) })), [sleeves, now]);

  return <>
    <section className="ap-hero" ref={heroRef}>
      <div className="ap-hero-copy">
        <Link href="/explore" className="ap-back">← Explore</Link>
        <div className="ap-eyebrow"><span className="autolp-badge"><i aria-hidden /> Autopilot</span><span>Automated LP strategy</span><span className="ap-live"><i aria-hidden />Live on Robinhood Chain</span></div>
        <h1 className="ap-title"><span>Stock LP,</span><span>on autopilot.</span></h1>
        <p className="ap-thesis">Deposit ETH once. Your capital provides liquidity on eight tokenized stocks, earns their trading fees, and is rebalanced and compounded by on-chain rules, not by anyone&apos;s discretion.</p>
        <div className="ap-hero-stats">
          <Stat label="Since launch" why="How does Hands-free LP earn, and how has it done since launch?" value={stats ? fmtPct(since) : "—"} tone={stats ? (stats.sinceLaunchUsdPct >= 0 ? "up" : "down") : undefined} sub={stats ? `${fmtPct(stats.sinceLaunchEthPct)} in ETH terms` : undefined} />
          <Stat label="Vault value" value={stats ? fmtUsd(tvl) : "—"} sub={stats ? `${stats.navEth.toFixed(4)} ETH` : undefined} />
          <Stat label="Share price" value={stats ? `$${price.toFixed(4)}` : "—"} sub={earning !== undefined ? `${earning} of 8 stocks earning now` : undefined} />
        </div>
        <div className="ap-cta"><a href="#trade" className="landing-btn-primary">Deposit ETH</a><a href={addr(vault)} target="_blank" rel="noreferrer" className="ap-link-btn">View vault on explorer ↗</a></div>
      </div>
      <AutoLpOrbit sleeves={sleeves} symbols={AUTO_LP.stocks} now={now} />
    </section>

    <section className="ap-strip" aria-label="Capacity">
      <div className="ap-cap"><div className="ap-cap-head"><span>Capacity</span><b>{stats ? `${fmtUsd(stats.navUsd, 0)} of ${fmtUsd(stats.capUsd, 0)}` : "—"}</b></div>
        <div className="ap-cap-track"><i style={{ width: `${Math.max(1.5, stats?.capacityPct ?? 0)}%` }} /></div></div>
      <p className="ap-fresh">{failed ? "Live stats temporarily unavailable." : updated !== undefined ? `Live on-chain data · updated ${updated === 0 ? "just now" : `${updated}m ago`}` : "Loading live data…"}</p>
    </section>

    <section id="trade" className="ap-trade">
      <div className="ap-card ap-trade-card">
        <div className="ap-tabs" role="tablist">
          {(["deposit", "withdraw"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{t === "deposit" ? "Deposit" : "Withdraw"}</button>)}
        </div>
        {tab === "deposit" ? <div className="ap-pane">
          <label className="ap-input"><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="ETH amount" /><span>ETH</span></label>
          <div className="ap-chips">{["0.01", "0.05", "0.1"].map((v) => <button key={v} onClick={() => setAmount(v)}>{v}</button>)}
            {maxEth > ZERO && <button onClick={() => setAmount(Number(formatEther(maxEth)).toFixed(5))}>Max</button>}</div>
          <p className="ap-est">{estUsd !== undefined && stats ? `≈ ${fmtUsd(estUsd)} · ≈ ${(estUsd / stats.perShareUsd).toFixed(2)} ${AUTO_LP.symbol}` : "One click: ETH is split across all 8 stocks for you."}</p>
          <button className="landing-btn-primary ap-go" disabled={busy} onClick={deposit}>{address ? "Deposit ETH" : "Connect wallet"}</button>
          <p className="ap-fine">Min $10 · capacity $10,000 · unused ETH is refunded in the same transaction.</p>
        </div> : <div className="ap-pane">
          <p className="ap-est">{mine.shares > ZERO ? "Receive ETH back in one transaction." : "You have no position to withdraw yet."}</p>
          <div className="ap-chips ap-chips-wide">{[...new Set([...(intentPct ? [intentPct] : []), 25n, 50n, 100n])].sort((a, b) => Number(a - b)).map((p) => <button key={String(p)} aria-pressed={p === intentPct} disabled={busy || mine.shares <= ZERO} onClick={() => withdraw(p)}>Withdraw {String(p)}%</button>)}</div>
          <button className="ap-text-btn" disabled={busy || mine.shares <= ZERO} onClick={emergency}>Emergency exit · receive the underlying positions</button>
        </div>}
        {retired.map((r) => <div key={r.vault} className="ap-retired">
          <p>You still hold {Number(formatEther(r.shares)).toFixed(2)} shares in the retired {r.label} vault. It is exit-only; withdraw them to ETH in one transaction.</p>
          <button className="landing-btn-primary" disabled={busy} onClick={() => withdrawRetired(r)}>Withdraw {r.label} to ETH</button>
        </div>)}
        {msg && <p className="ap-msg" role="status">{msg}</p>}
      </div>
      <div className="ap-card ap-pos-card">
        <span className="ap-label">Your position</span>
        <p className="ap-big">{mine.valueWei !== null ? `${Number(formatEther(mine.valueWei)).toFixed(5)} ETH` : address ? "0 ETH" : "Connect to view"}</p>
        {mine.valueWei !== null && stats && <p className="ap-sub">{fmtUsd(Number(formatEther(mine.valueWei)) * stats.ethUsd)} · {Number(formatEther(mine.shares)).toFixed(4)} {AUTO_LP.symbol}</p>}
        <div className="ap-pnl">
          <div><span>P/L</span><b className={pnl ? (pnl.pnlWei >= 0n ? "is-up" : "is-down") : ""}>{pnl ? `${pnl.pnlWei >= 0n ? "+" : ""}${Number(formatEther(pnl.pnlWei)).toFixed(5)} ETH (${fmtPct(pnl.pct)})` : mine.shares > ZERO && mine.deposited === ZERO ? "Seed position" : "—"}</b></div>
          <div><span>Deposited</span><b>{Number(formatEther(mine.deposited)).toFixed(5)} ETH</b></div>
          <div><span>Withdrawn</span><b>{Number(formatEther(mine.withdrawn)).toFixed(5)} ETH</b></div>
        </div>
        <p className="ap-fine">P/L = current exit value + ETH withdrawn − ETH deposited, from the vault&apos;s on-chain events.</p>
      </div>
    </section>

    <section className="ap-board" ref={boardRef}>
      <div className="ap-sec-head"><div><p className="landing-eyebrow">Autopilot status</p><h2>Eight engines, one rulebook.</h2></div>
        <p>Each stock earns while its price sits inside its {AUTO_LP.bandLabel} band. If it stays outside for {AUTO_LP.breachDelaySec / 60} minutes and the pool agrees with an independent TWAP, the autopilot moves it next to the price. No swaps, no discretion.</p></div>
      <div className="ap-grid">
        {(board.length ? board : AUTO_LP.stocks.map((sym, i) => ({ s: undefined, i, d: { tone: "idle", label: "Loading…", hint: "" }, sym }))).map(({ s, i, d }) => {
          const sym = s?.symbol ?? AUTO_LP.stocks[i];
          const span = s ? s.tickUpper - s.tickLower : 0;
          const pos = s && span > 0 ? Math.min(100, Math.max(0, ((s.tick - s.tickLower) / span) * 100)) : 50;
          const sl = AUTO_LP.sleeves[i];
          return <article key={sym} className={`ap-tile is-${d.tone}`} style={{ "--d": `${i * 60}ms` } as CSSProperties} title={d.hint}>
            <div className="ap-tile-head"><b>{sym}</b><a href={addr(sl.sleeve)} target="_blank" rel="noreferrer" aria-label={`${sym} position on explorer`}>↗</a></div>
            <span className="ap-state"><i aria-hidden />{d.label}</span>
            <div className="ap-track" aria-hidden><span className="ap-band" /><i style={{ left: `${pos}%` }} /></div>
            {s && <small>{fmtUsd(s.valueUsd)} in this position</small>}
          </article>;
        })}
      </div>
    </section>

    <section className="ap-how" ref={howRef}>
      <div className="ap-sec-head"><div><p className="landing-eyebrow">How it works</p><h2>Rules, not discretion.</h2></div></div>
      <ol className="ap-steps">
        {[
          ["Provide", `Your ETH becomes ${AUTO_LP.bandLabel} Uniswap V4 liquidity on 8 tokenized stocks, in their higher-fee pools, quoted in USDG, earning every trade's fee.`],
          ["Wait", `If a stock leaves its band for ${AUTO_LP.breachDelaySec / 60} minutes, and the pool agrees with an independent 30-minute TWAP, a rebalance unlocks.`],
          ["Rebalance", "The contracts move the position next to the price, on the side it already holds. No swaps, no human choosing amounts."],
          ["Compound", "Earned fees are reinvested daily. 10% of LP fees (never principal) goes to the HOODX treasury."],
        ].map(([h, p], i) => <li key={h} style={{ "--d": `${i * 120}ms` } as CSSProperties}><span>0{i + 1}</span><h3>{h}</h3><p>{p}</p></li>)}
      </ol>
    </section>

    <section className="ap-chain" ref={chainRef}>
      <div className="ap-sec-head"><div><p className="landing-eyebrow">Verify on-chain</p><h2>Everything is public.</h2></div>
        <p>Open source, fork-tested, internally reviewed. Exits never depend on the website, the keeper or a price feed.</p></div>
      <div className="ap-links">
        <a href={addr(vault)} target="_blank" rel="noreferrer"><span>Vault · STKX</span><code>{vault.slice(0, 6)}…{vault.slice(-4)}</code><i>↗</i></a>
        <a href={addr(controller)} target="_blank" rel="noreferrer"><span>Autopilot controller</span><code>{controller.slice(0, 6)}…{controller.slice(-4)}</code><i>↗</i></a>
        <a href="https://github.com/thepaypay420/HOODX/blob/main/deployments/STOCK-LP-VAULT-SECURITY-REVIEW.md" target="_blank" rel="noreferrer"><span>Security review</span><code>GitHub</code><i>↗</i></a>
      </div>
      <div className="ap-sleeve-links">{AUTO_LP.sleeves.map((s) => <a key={s.symbol} href={addr(s.sleeve)} target="_blank" rel="noreferrer">{s.symbol} position ↗</a>)}</div>
    </section>

    <section className="ap-risks">
      <p className="landing-eyebrow">Know the risks</p>
      <ul>
        <li>LP positions hold the stocks: prices can fall, and narrow ranges can lose value to arbitrage when prices move fast.</li>
        <li>Returns are not guaranteed and no APR is quoted. Performance shown is measured on-chain since launch.</li>
        <li>Tokenized stocks are issuer-controlled tokens. If one is paused, ETH entry and exit pause; the emergency exit still works.</li>
        <li>Capacity is capped at $10,000 while the strategy is new. Minimum deposit $10.</li>
      </ul>
    </section>

    {isCurator && <section className="ap-curator">
      <h3>Curator panel</h3>
      <p className="ap-fine">Rebalances and compounding run automatically every hour. These controls are for oversight and emergencies.</p>
      <div className="ap-chips">
        <button disabled={busy} onClick={runAutopilot}>Run autopilot now</button>
        <button disabled={busy} onClick={claimAll}>Claim fees to treasury</button>
        <button disabled={busy} onClick={togglePause}>{paused ? "Resume management" : "Pause management"}</button>
      </div>
      {msg && <p className="ap-msg" role="status">{msg}</p>}
    </section>}
  </>;
}
