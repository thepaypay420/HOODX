"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { BaseError, ContractFunctionRevertedError, erc20Abi, formatEther, parseEther, parseAbiItem, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { EXPLORER } from "@/lib/config";
import { publicClient, useWallet } from "@/lib/wallet";
import { walletPnl } from "@/lib/autolpNav";
import { BOOST, BOOST_BACKTEST, boostSignalAbi, boostVaultAbi, deadline, minOut, regime } from "@/lib/boost";
import { useBoostStats } from "@/lib/useBoost";
import { fmtPct, fmtUsd, useCountUp, useReveal } from "@/lib/useAutoLp";
import { BoostGauge } from "@/components/BoostGauge";

const ZERO = 0n;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const addr = (a: string) => `${EXPLORER}/address/${a}`;
const errName = (e: unknown) => {
  if (!(e instanceof BaseError)) return "";
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? "" : "";
};
const short = (e: unknown) => errName(e) || (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message.slice(0, 140) : "failed");
const FRIENDLY: Record<string, string> = {
  Paused: "Deposits are paused right now. Withdrawals always work.",
  CapExceeded: "The vault is at its capacity cap right now.",
  Divergence: "The ETH pool and the Chainlink price disagree right now, so entry waits. Try again shortly.",
  Slippage: "Price moved during entry. Try again or use a smaller amount.",
  Invalid: "That amount is below the minimum deposit.",
};
const deposited = parseAbiItem("event Deposited(address indexed account, address indexed receiver, uint256 ethIn, uint256 shares, uint256 navAddedUsdg)");
const withdrawn = parseAbiItem("event Withdrawn(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut)");

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return <div className="ap-stat"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

export function BoostExperience() {
  const { address, chainId, walletClient, connect, switchToRobinhood } = useWallet();
  const { stats, failed } = useBoostStats();
  // A configured vault renders as live from the first paint (values fill in when stats arrive); never flashes "launching soon".
  const live = !!(BOOST.vault && BOOST.signal) && stats?.live !== false;
  const vault = BOOST.vault as Address, signal = BOOST.signal as Address;
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [mine, setMine] = useState<{ shares: bigint; valueWei: bigint | null; ethBal: bigint; deposited: bigint; withdrawn: bigint }>(
    { shares: ZERO, valueWei: null, ethBal: ZERO, deposited: ZERO, withdrawn: ZERO });
  const isCurator = !!address && address.toLowerCase() === BOOST.curator.toLowerCase();
  const [pendingOwner, setPendingOwner] = useState<string>("");
  const heroRef = useReveal<HTMLDivElement>(), howRef = useReveal<HTMLDivElement>(),
    recRef = useReveal<HTMLDivElement>(), chainRef = useReveal<HTMLDivElement>();

  const loadMine = useCallback(async () => {
    if (!address || !live) return;
    const [shares, ethBal, ins, outs] = await Promise.all([
      publicClient.readContract({ address: vault, abi: boostVaultAbi, functionName: "balanceOf", args: [address] }),
      publicClient.getBalance({ address }),
      publicClient.getLogs({ address: vault, event: deposited, args: { receiver: address }, fromBlock: BOOST.deployBlock }).catch(() => []),
      publicClient.getLogs({ address: vault, event: withdrawn, args: { account: address }, fromBlock: BOOST.deployBlock }).catch(() => []),
    ]);
    let valueWei: bigint | null = null;
    if (shares > ZERO) {
      try { valueWei = (await publicClient.simulateContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "withdraw", args: [shares, address, 1n, deadline()] })).result; }
      catch { valueWei = null; }
    }
    const dep = ins.reduce((a, l) => a + (l.args.ethIn ?? ZERO), ZERO), wd = outs.reduce((a, l) => a + (l.args.ethOut ?? ZERO), ZERO);
    setMine({ shares, valueWei, ethBal, deposited: dep, withdrawn: wd });
  }, [address, live, vault]);
  useEffect(() => { void loadMine().catch(() => {}); }, [loadMine]);
  useEffect(() => {
    if (!isCurator || !live) return;
    void publicClient.readContract({ address: vault, abi: boostVaultAbi, functionName: "pendingOwner" }).then(setPendingOwner).catch(() => {});
  }, [isCurator, live, vault, msg]);
  const mustAccept = !!address && pendingOwner.toLowerCase() === address.toLowerCase();

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
    } catch (e) { setMsg(`${label}: ${FRIENDLY[errName(e)] ?? short(e)}`); } finally { setBusy(false); }
  };

  const deposit = async () => {
    if (!live || !(await ready()) || !address || !walletClient) return;
    let value: bigint;
    try { value = parseEther(amount || "0"); } catch { setMsg("Enter an ETH amount."); return; }
    if (value <= ZERO) { setMsg("Enter an ETH amount."); return; }
    setBusy(true); setMsg("Simulating your entry…");
    try {
      const sim = await publicClient.simulateContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "deposit", args: [address, 1n, deadline()], value });
      setBusy(false);
      await send("Deposit", () => walletClient.writeContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "deposit", args: [address, minOut(sim.result), deadline()], value, chain: robinhood }));
      setAmount("");
    } catch (e) { setMsg(`Deposit: ${FRIENDLY[errName(e)] ?? short(e)}`); setBusy(false); }
  };
  const withdraw = async (pct: bigint) => {
    if (!(await ready()) || !address || !walletClient) return;
    const shares = (mine.shares * pct) / 100n;
    if (shares <= ZERO) return;
    setBusy(true); setMsg("Quoting your ETH exit…");
    try {
      const sim = await publicClient.simulateContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "withdraw", args: [shares, address, 1n, deadline()] });
      setBusy(false);
      await send(`Withdraw ${pct}%`, () => walletClient.writeContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "withdraw", args: [shares, address, minOut(sim.result), deadline()], chain: robinhood }));
    } catch (e) { setMsg(`Withdraw: ${short(e)}. If the ETH exit is unavailable, use the in-kind exit below.`); setBusy(false); }
  };
  const exitInKind = async () => {
    if (!(await ready()) || !address || !walletClient || mine.shares <= ZERO) return;
    try {
      const [, usdgIn] = await publicClient.readContract({ address: vault, abi: boostVaultAbi, functionName: "previewExitInKind", args: [mine.shares] });
      if (usdgIn > ZERO) {
        const need = usdgIn + usdgIn / 1000n + 1n; // a little room for interest accruing before the transaction lands
        await send("Approve USDG for your share of the loan", () => walletClient.writeContract({ account: address, address: USDG, abi: erc20Abi, functionName: "approve", args: [vault, need], chain: robinhood }));
      }
      await send("In-kind exit", () => walletClient.writeContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "exitInKind", args: [mine.shares, address], chain: robinhood }));
    } catch (e) { setMsg(`In-kind exit: ${short(e)}`); }
  };
  const crank = async () => {
    if (!(await ready()) || !address || !walletClient) return;
    try { await publicClient.simulateContract({ account: address, address: signal, abi: boostSignalAbi, functionName: "poke" }); await send("Update signal", () => walletClient.writeContract({ account: address, address: signal, abi: boostSignalAbi, functionName: "poke", chain: robinhood })); } catch { /* already this hour */ }
    try { await publicClient.simulateContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "rebalance" }); await send("Rebalance", () => walletClient.writeContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "rebalance", chain: robinhood })); }
    catch (e) { setMsg(`Rebalance not needed now (${errName(e) || "inside the band"}).`); }
  };
  const accept = async () => {
    if (!(await ready()) || !address || !walletClient) return;
    await send("Accept ownership", () => walletClient.writeContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "acceptOwnership", chain: robinhood }));
  };
  const togglePause = async () => {
    if (!(await ready()) || !address || !walletClient || !stats) return;
    await send(stats.depositsPaused ? "Resume deposits" : "Pause deposits", () => walletClient.writeContract({ account: address, address: vault, abi: boostVaultAbi, functionName: "setDepositsPaused", args: [!stats.depositsPaused], chain: robinhood }));
  };

  const since = useCountUp(stats?.sinceLaunchUsdPct), tvl = useCountUp(stats?.navUsd);
  const pnl = mine.valueWei !== null ? walletPnl(mine.valueWei, mine.deposited, mine.withdrawn) : undefined;
  const maxEth = mine.ethBal > 400_000_000_000_000n ? mine.ethBal - 400_000_000_000_000n : ZERO;
  const estUsd = (() => { try { return stats && amount ? Number(formatEther(parseEther(amount))) * stats.ethUsd : undefined; } catch { return undefined; } })();
  const reg = regime(live ? stats?.leverage ?? 0 : stats?.target ?? 0);
  const bits = (x: number) => x.toString(2).split("").filter((b) => b === "1").length;
  const trendUp = stats ? bits(stats.ethFlags & 15) + bits(stats.btcFlags & 15) : undefined;   // slow averages: the core
  const momentumUp = stats ? bits(stats.ethFlags >> 4) + bits(stats.btcFlags >> 4) : undefined; // fast averages: the booster
  const volPct = stats ? stats.sigma * 100 : undefined;
  const volWord = volPct === undefined ? "" : volPct < 60 ? "calm" : volPct < 90 ? "normal" : "high";
  const maxBar = Math.max(...BOOST_BACKTEST.years.map((r) => Math.max(Math.abs(r.vault), Math.abs(r.eth))));
  const bar = (x: number) => `${Math.max(2, (Math.sqrt(Math.abs(x)) / Math.sqrt(maxBar)) * 82)}%`; // leave room for the labels

  return <>
    <section className="ap-hero bx-hero" ref={heroRef}>
      <div className="ap-hero-copy">
        <Link href="/explore" className="ap-back">← Explore</Link>
        <div className="ap-eyebrow"><span className="bx-badge"><i aria-hidden /> Boosted</span><span>Smart ETH leverage</span>
          {live ? <span className="ap-live"><i aria-hidden />Live on Robinhood Chain</span> : <span className="ap-live bx-soon"><i aria-hidden />Launching soon</span>}</div>
        <h1 className="ap-title"><span>ETH, boosted.</span><span>Off when it breaks.</span></h1>
        <p className="ap-thesis">Deposit ETH. When crypto trends up, the vault rides ETH up to 2x with cheap on-chain leverage. When the trend breaks, it steps aside into dollars earning Robinhood Earn yield, then buys back in. Every move is computed on-chain from Chainlink prices.</p>
        <div className="ap-hero-stats">
          {live ? <>
            <Stat label="Since launch" value={stats ? fmtPct(since) : "—"} tone={stats ? (stats.sinceLaunchUsdPct >= 0 ? "up" : "down") : undefined} sub={stats ? `${fmtPct(stats.sinceLaunchEthPct)} in ETH terms` : undefined} />
            <Stat label="Vault value" value={stats ? fmtUsd(tvl) : "—"} sub={stats ? `${stats.navEth.toFixed(4)} ETH · ${stats.markedAt === "market" ? "live price" : "Chainlink price"}` : undefined} />
            <Stat label="Right now" value={reg.label} sub={stats ? `${stats.leverage.toFixed(2)}x ETH exposure` : undefined} />
          </> : <>
            <Stat label="Backtest 2022-26" value={`+${BOOST_BACKTEST.test.vault}%/yr`} tone="up" sub={`ETH held: ${BOOST_BACKTEST.test.eth}%/yr`} />
            <Stat label="Beat ETH" value={`${BOOST_BACKTEST.monteCarlo.beatEth}%`} sub="of 300 simulated 4-year paths" />
            <Stat label="Signal now" value={reg.label} sub={stats ? `${stats.target.toFixed(2)}x if launched today` : undefined} />
          </>}
        </div>
        <div className="ap-cta"><a href={live ? "#trade" : "#how"} className="landing-btn-primary">{live ? "Deposit ETH" : "See how it works"}</a>
          {live && <a href={addr(vault)} target="_blank" rel="noreferrer" className="ap-link-btn">View vault on explorer ↗</a>}</div>
      </div>
      <BoostGauge leverage={stats?.leverage} target={stats?.target} live={live} />
    </section>

    {live && <section className="ap-strip" aria-label="Capacity">
      <div className="ap-cap"><div className="ap-cap-head"><span>Capacity</span><b>{stats ? `${fmtUsd(stats.navUsd, 0)} of ${fmtUsd(stats.capUsd, 0)}` : "—"}</b></div>
        <div className="ap-cap-track"><i style={{ width: `${Math.max(1.5, stats?.capacityPct ?? 0)}%` }} /></div></div>
      <p className="ap-fresh">{failed ? "Live stats temporarily unavailable." : stats ? `Live on-chain data · signal ${stats.fresh ? "fresh" : "awaiting its hourly update"}` : "Loading live data…"}</p>
    </section>}

    {live && <section id="trade" className="ap-trade">
      <div className="ap-card ap-trade-card">
        <div className="ap-tabs" role="tablist">
          {(["deposit", "withdraw"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{t === "deposit" ? "Deposit" : "Withdraw"}</button>)}
        </div>
        {tab === "deposit" ? <div className="ap-pane">
          <label className="ap-input"><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="ETH amount" /><span>ETH</span></label>
          <div className="ap-chips">{["0.01", "0.05", "0.25"].map((v) => <button key={v} onClick={() => setAmount(v)}>{v}</button>)}
            {maxEth > ZERO && <button onClick={() => setAmount(Number(formatEther(maxEth)).toFixed(5))}>Max</button>}</div>
          <p className="ap-est">{estUsd !== undefined && stats ? `≈ ${fmtUsd(estUsd)} · ≈ ${(estUsd / stats.perShareUsd).toFixed(2)} ${BOOST.symbol}` : `Your ETH joins the vault exactly as it stands now (${reg.label.toLowerCase()}).`}</p>
          <button className="landing-btn-primary ap-go" disabled={busy || stats?.depositsPaused} onClick={deposit}>{address ? stats?.depositsPaused ? "Deposits paused" : "Deposit ETH" : "Connect wallet"}</button>
          <p className="ap-fine">Min {BOOST.minDepositEth} ETH · capacity {fmtUsd(BOOST.capUsd, 0)} · you pay only your own entry swap; other holders are never diluted.</p>
        </div> : <div className="ap-pane">
          <p className="ap-est">{mine.shares > ZERO ? "Receive ETH back in one transaction, any time." : "You have no position to withdraw yet."}</p>
          <div className="ap-chips ap-chips-wide">{[25n, 50n, 100n].map((p) => <button key={String(p)} disabled={busy || mine.shares <= ZERO} onClick={() => withdraw(p)}>Withdraw {String(p)}%</button>)}</div>
          <button className="ap-text-btn" disabled={busy || mine.shares <= ZERO} onClick={exitInKind}>In-kind exit · receive WETH and steakUSDG directly, no swap</button>
        </div>}
        {msg && <p className="ap-msg" role="status">{msg}</p>}
      </div>
      <div className="ap-card ap-pos-card">
        <span className="ap-label">Your position</span>
        <p className="ap-big">{mine.valueWei !== null ? `${Number(formatEther(mine.valueWei)).toFixed(5)} ETH` : address ? "0 ETH" : "Connect to view"}</p>
        {mine.valueWei !== null && stats && <p className="ap-sub">{fmtUsd(Number(formatEther(mine.valueWei)) * stats.ethUsd)} · {Number(formatEther(mine.shares)).toFixed(2)} {BOOST.symbol}</p>}
        <div className="ap-pnl">
          <div><span>P/L</span><b className={pnl ? (pnl.pnlWei >= 0n ? "is-up" : "is-down") : ""}>{pnl ? `${pnl.pnlWei >= 0n ? "+" : ""}${Number(formatEther(pnl.pnlWei)).toFixed(5)} ETH (${fmtPct(pnl.pct)})` : mine.shares > ZERO && mine.deposited === ZERO ? "Seed position" : "—"}</b></div>
          <div><span>Deposited</span><b>{Number(formatEther(mine.deposited)).toFixed(5)} ETH</b></div>
          <div><span>Withdrawn</span><b>{Number(formatEther(mine.withdrawn)).toFixed(5)} ETH</b></div>
        </div>
        <p className="ap-fine">P/L in ETH = current exit value + ETH withdrawn − ETH deposited, from the vault&apos;s on-chain events.</p>
      </div>
    </section>}

    <section id="how" className="ap-how bx-how" ref={howRef}>
      <div className="ap-sec-head"><div><p className="landing-eyebrow">How it works</p><h2>Rides the trend.<br />Steps aside.</h2></div>
        <p>One rule, run on-chain every hour from Chainlink prices. Nobody decides; the contracts do.</p></div>
      <div className="bx-now" aria-label="Why the vault is positioned this way right now">
        <span className="bx-now-label">Right now</span>
        <div><b>{trendUp ?? "—"}<small>/8</small></b><span>long-term trends up</span></div>
        <div><b>{momentumUp ?? "—"}<small>/8</small></b><span>short-term trends up</span></div>
        <div><b>{volPct !== undefined ? `${volPct.toFixed(0)}%` : "—"}</b><span>ETH volatility{volWord ? ` · ${volWord}` : ""}</span></div>
        <div className={`is-result is-${reg.key}`}><b>{stats ? `${stats.target.toFixed(2)}x` : "—"}</b><span>{reg.label}</span></div>
      </div>
      <ol className="ap-steps bx-steps">
        {[
          ["Read", "Every hour the vault reads ETH and BTC prices and checks whether both are trending up, and how volatile ETH is."],
          ["Position", "Strong, calm uptrend: up to 2x ETH, borrowed cheaply on Morpho. Trend breaks: it sells to dollars earning Robinhood Earn yield."],
          ["Protect", "It moves in hourly steps of up to $100k at oracle-checked prices, never above 2x. You can withdraw at any time."],
        ].map(([h, p], i) => <li key={h} style={{ "--d": `${i * 120}ms` } as CSSProperties}><span>0{i + 1}</span><h3>{h}</h3><p>{p}</p></li>)}
      </ol>
    </section>

    <section className="ap-board bx-record" ref={recRef}>
      <div className="ap-sec-head"><div><p className="landing-eyebrow">The research</p><h2>Ten years, every cost in.</h2></div>
        <p>Hourly backtest from 2016, rules fixed before the 2022-26 test, then checked on BTC and SOL, re-tuned walk-forward and run on 300 simulated histories. The on-chain contract reproduces it to the hour.</p></div>
      <div className="bx-record-grid">
        <div className="bx-bars" role="table" aria-label="Yearly returns, vault vs ETH">
          {BOOST_BACKTEST.years.map((r, i) => <div key={r.y} className="bx-bar-row" role="row" style={{ "--d": `${i * 80}ms` } as CSSProperties}>
            <span role="cell">{r.y}</span>
            <div className="bx-bar-pair" role="cell">
              <i className={`is-vault ${r.vault < 0 ? "is-neg" : ""}`} style={{ width: bar(r.vault) }}><b>{r.vault > 0 ? "+" : ""}{r.vault}%</b></i>
              <i className={`is-eth ${r.eth < 0 ? "is-neg" : ""}`} style={{ width: bar(r.eth) }}><b>{r.eth > 0 ? "+" : ""}{r.eth}%</b></i>
            </div>
          </div>)}
          <p className="bx-legend"><i className="is-vault" /> Boosted ETH <i className="is-eth" /> Holding ETH · bar length on a square-root scale</p>
        </div>
        <div className="bx-facts">
          <div><b>×{BOOST_BACKTEST.compounded.vault}</b><span>2019-26 compounded, vs ×{BOOST_BACKTEST.compounded.eth} holding ETH</span></div>
          <div><b>+{BOOST_BACKTEST.test.vault}%/yr</b><span>2022-26 test, worst drop {BOOST_BACKTEST.test.vaultDd}% (ETH {BOOST_BACKTEST.test.eth}%/yr, {BOOST_BACKTEST.test.ethDd}%)</span></div>
          <div><b>{BOOST_BACKTEST.monteCarlo.beatEth}%</b><span>of simulated 4-year paths beat holding ETH; median +{BOOST_BACKTEST.monteCarlo.median}%/yr</span></div>
          <div><b>0</b><span>liquidations in 10 years of hourly data and 300 simulated paths</span></div>
        </div>
      </div>
      <p className="ap-fine">A backtest, not a promise. It lags straight-up rallies (2023: +57% vs ETH +91%) and earns its keep by stepping aside in crashes. Drawdowns of 60-75% happen along the way.</p>
    </section>

    {live && <section className="ap-chain" ref={chainRef}>
      <div className="ap-sec-head"><div><p className="landing-eyebrow">Verify on-chain</p><h2>Everything is public.</h2></div>
        <p>Open source, fork-tested against live Morpho, Uniswap, Chainlink and steakUSDG, internally reviewed. Exits never depend on the website, the keeper or the signal.</p></div>
      <div className="ap-links">
        <a href={addr(vault)} target="_blank" rel="noreferrer"><span>Vault · {BOOST.symbol}</span><code>{vault.slice(0, 6)}…{vault.slice(-4)}</code><i>↗</i></a>
        <a href={addr(signal)} target="_blank" rel="noreferrer"><span>On-chain signal</span><code>{signal.slice(0, 6)}…{signal.slice(-4)}</code><i>↗</i></a>
        <a href="https://github.com/thepaypay420/HOODX/blob/main/deployments/BOOST-ETH-VAULT-SECURITY-REVIEW.md" target="_blank" rel="noreferrer"><span>Security review</span><code>GitHub</code><i>↗</i></a>
      </div>
      <div className="ap-sleeve-links">
        <a href={addr(BOOST.morpho)} target="_blank" rel="noreferrer">Morpho Blue ↗</a><a href={addr(BOOST.pool)} target="_blank" rel="noreferrer">Uniswap ETH pool ↗</a>
        <a href={addr(BOOST.cash)} target="_blank" rel="noreferrer">steakUSDG ↗</a><a href={addr(BOOST.ethFeed)} target="_blank" rel="noreferrer">Chainlink ETH/USD ↗</a><a href={addr(BOOST.btcFeed)} target="_blank" rel="noreferrer">Chainlink BTC/USD ↗</a>
      </div>
    </section>}

    <section className="ap-risks">
      <p className="landing-eyebrow">Know the risks</p>
      <ul>
        <li>This is leveraged ETH. At 2x a 30% ETH fall costs about 60% before the vault can cut; deep drawdowns are normal.</li>
        <li>Trend following lags sudden reversals: a crash out of a strong uptrend can hurt more than holding ETH.</li>
        <li>It relies on Morpho, Uniswap, Chainlink and the steakUSDG vault. A failure in any of them can cause losses. No formal audit yet.</li>
        <li>Returns are not guaranteed. The research figures are a backtest; live performance is shown above once launched. 10% performance fee above a high-water mark.</li>
      </ul>
    </section>

    {isCurator && live && <section className="ap-curator">
      <h3>Curator panel</h3>
      <p className="ap-fine">The keeper pokes the signal and rebalances automatically. These controls are for oversight. The curator cannot move funds or change rules.</p>
      {mustAccept && <p className="ap-msg">The deployer has handed this vault to the treasury. Accept ownership to complete the launch.</p>}
      <div className="ap-chips">
        {mustAccept && <button disabled={busy} onClick={accept}>Accept vault ownership</button>}
        <button disabled={busy} onClick={crank}>Update signal and rebalance now</button>
        <button disabled={busy} onClick={togglePause}>{stats?.depositsPaused ? "Resume deposits" : "Pause deposits"}</button>
      </div>
      {msg && <p className="ap-msg" role="status">{msg}</p>}
    </section>}
  </>;
}
