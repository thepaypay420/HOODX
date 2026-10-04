"use client";



import { useCallback, useEffect, useRef, useState } from "react";

import { BaseError, erc20Abi, formatEther, parseEther, parseUnits, zeroAddress, type Address } from "viem";

import { robinhood } from "@/lib/chain";
import { readIntent, INTENT_NOTE } from "@/lib/intent";

import { publicClient, useWallet } from "@/lib/wallet";

import { blockedPriceReferences, blockedReferenceMessage, preflightV2Routes, type BlockedReference } from "@/lib/v2Preflight";

import { V2CuratorDesk } from "@/components/V2CuratorDesk";

import { VaultPerformance } from "@/components/VaultPerformance";

import { VaultOverview } from "@/components/VaultOverview";

import { v2VaultAbi } from "@/lib/v2";

import { withdrawalFloor } from "@/lib/withdrawMinimum";
import { classifyWithdrawalQuoteFailure, protectedWithdrawalMinimum, quoteWithdrawalWithRetry, type WithdrawalQuoteFailure } from "@/lib/v2WithdrawalQuote";
import { rebalanceControllerAbi, resolveVaultAuthority } from "@/lib/rebalanceController";


type Snapshot = { account: Address; vault: Address; owner: Address; curator: Address; controller?: Address; walletEth?: bigint; block: bigint; firstMinimum: bigint; shares: bigint; supply: bigint; paused: boolean; assets?: bigint; valuationFailed?: boolean; quoteAssets?: bigint; quoteSupply?: bigint; quoteTime?: number; tokens: Address[]; claims: { token: Address; amount: bigint }[]; blocked?: BlockedReference[] };
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);



export function V2VaultDesk({ vault, slug }: { vault: Address; slug: string }) {

  const { address, walletClient, chainId, connect, switchToRobinhood } = useWallet();

  const [snapshot, setSnap] = useState<Snapshot>();

  const snap = snapshot?.account === (address ?? zeroAddress) && snapshot.vault === vault ? snapshot : undefined;

  const generation = useRef(0);

  const [eth, setEth] = useState("0.02");

  const [minimum, setMinimum] = useState("");

  const [percent, setPercent] = useState(100);

  const [quoteMessage, setQuoteMessage] = useState("");

  const [quoting, setQuoting] = useState(false);
  const [withdrawalFailure, setWithdrawalFailure] = useState<WithdrawalQuoteFailure>();
  const [recipient, setRecipient] = useState<Address>();

  const [busy, setBusy] = useState(false);
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  // a deposit or withdrawal an AI assistant prepared (MCP review link): pre-fill only, the user still confirms
  useEffect(() => { const i = readIntent(); if (!i.deposit && !i.withdraw) return; if (i.deposit) { setTab("deposit"); setEth(i.deposit); } else { setTab("withdraw"); setPercent(i.withdraw!); } setMessage(INTENT_NOTE); }, []);
  const [message, setMessage] = useState("");

  const [unwindToken, setUnwindToken] = useState<Address>();

  const [unwindAmount, setUnwindAmount] = useState("");

  const [unwindMinimum, setUnwindMinimum] = useState("");

  const read = useCallback(async () => {

    const ticket = ++generation.current;

    const account = address ?? zeroAddress;

    const block = await publicClient.getBlockNumber();

    // Price failures must not hide shares or direct asset redemption.

    const [shares, supply, paused, tokens, weth, firstMinimum, owner, walletEth] = await Promise.all([

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "balanceOf", args: [account] }),

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "totalSupply" }),

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "paused" }),

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "constituents" }),

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "weth" }),

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "minFirstDeposit" }),

      publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "owner" }),

      address ? publicClient.getBalance({ address, blockNumber: block }).catch(() => undefined) : Promise.resolve(undefined),

    ]);

    const claimTokens = [zeroAddress, weth, ...tokens];

    const authority = await resolveVaultAuthority(publicClient, vault, owner, block);
    const amounts = await Promise.all(claimTokens.map(token => publicClient.readContract({

      address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "claimable", args: [account, token],

    })));

    if (ticket !== generation.current) return;

    setSnap({ account, vault, owner, curator: authority.curator, controller: authority.controller, walletEth, block, firstMinimum, shares, supply, paused, tokens: [...tokens], claims: claimTokens.map((token, i) => ({ token, amount: amounts[i] })) });
    const assets = await publicClient.readContract({ address: vault, abi: v2VaultAbi, blockNumber: block, functionName: "totalAssets" }).catch(() => undefined);
    // Name the constituents whose price check fails, so holders know why ETH paths are closed.
    const blocked = assets === undefined ? await blockedPriceReferences(vault).catch(() => undefined) : [];

    let quoteAssets: bigint | undefined, quoteSupply: bigint | undefined, quoteTime: number | undefined;

    if (assets === undefined) {

      try {

        const response = await fetch(`/api/vault-quote?vault=${vault}`);

        if (!response.ok) throw new Error("Quote unavailable");

        const q = await response.json();

        if (q.vault.toLowerCase() !== vault.toLowerCase() || !Number.isFinite(q.timestamp) || Date.now()-q.timestamp > 180000 || q.timestamp > Date.now()+30000) throw new Error("Stale quote");

        quoteAssets=BigInt(q.assets); quoteSupply=BigInt(q.supply); quoteTime=q.timestamp;

      } catch { /* Never substitute a partial or stale valuation. */ }

    }

    if (ticket !== generation.current) return;

    setSnap({ account, vault, owner, curator: authority.curator, controller: authority.controller, walletEth, block, firstMinimum, shares, supply, paused, assets, quoteAssets, quoteSupply, quoteTime, valuationFailed: assets === undefined, tokens: [...tokens], claims: claimTokens.map((token, i) => ({ token, amount: amounts[i] })), blocked });
  }, [address, vault]);

  useEffect(() => { let cancelled = false; setSnap(undefined); setRecipient(address); read().catch(() => { if (!cancelled) setMessage("Unable to read vault balances. Retry before transacting."); }); return () => { cancelled = true; generation.current++; }; }, [read, address]);

  useEffect(() => {

    if (snap?.supply === 0n) setEth(formatEther(snap.firstMinimum));

  }, [snap?.supply, snap?.firstMinimum, vault]);

  useEffect(() => { if (!address) return; const timer = setInterval(() => { if (!busy) void read().catch(() => {}); }, 30000); return () => clearInterval(timer); }, [address, busy, read]);

  useEffect(() => {

    let active = true;

    setMinimum(""); setQuoteMessage(""); setWithdrawalFailure(undefined); setQuoting(false);
    const shares = snap?.shares, assets = snap?.assets, supply = snap?.supply;

    if (!address || !shares || !supply) return;
    const selected = shares * BigInt(percent) / 100n;
    // A full eth_call rehearsal can still quote an exit when totalAssets() is unavailable.
    // One wei is used only for this read-only rehearsal; success is replaced by the
    // displayed 99% protected minimum before a wallet request is built.
    const navFloor = assets === undefined ? 1n : withdrawalFloor(assets, shares, supply, percent).floor;
    if (selected === 0n || navFloor === 0n) { setQuoteMessage("This portion is too small to quote safely."); return; }

    setQuoting(true);

    const timer = setTimeout(() => {

      // Read-only full withdrawal rehearsal, with a positive NAV protection floor.

      // The broadcast path independently simulates again with the displayed minimum.

      void quoteWithdrawalWithRetry(async () => {
        const { result } = await publicClient.simulateContract({ address: vault, abi: v2VaultAbi, account: address, functionName: "withdraw", args: [selected, navFloor, deadline()] });
        return result;
      }).then((result) => {
        if (!active) return;

        const protectedQuote = protectedWithdrawalMinimum(result, navFloor);
        setMinimum(protectedQuote.minimum);
        setWithdrawalFailure(undefined);
        setQuoteMessage(protectedQuote.message);
      }).catch(error => {
        if (!active) return;
        const failure = classifyWithdrawalQuoteFailure(error);
        setWithdrawalFailure(failure);
        setQuoteMessage(failure === "invalid-reference" ? blockedReferenceMessage(snap?.blocked ?? []) : failure === "protected-floor" ? "Protected route floor not met · use direct assets below" : "Route unavailable · try again");
      }).finally(() => { if (active) setQuoting(false); });
    }, 400);

    return () => { active = false; clearTimeout(timer); };

  }, [address, vault, percent, snap?.shares, snap?.assets, snap?.supply, snap?.block, snap?.blocked]);
  async function transact(action: "deposit" | "withdraw" | "assets" | "claim" | "pause" | "unwind", token?: Address) {

    if (!address || !walletClient || !snap) return;

    if (chainId !== robinhood.id) { await switchToRobinhood(); return; }

    setBusy(true); setMessage("");

    try {

      const common = { address: vault, abi: v2VaultAbi, account: address, chain: robinhood } as const;
      const selectedShares = snap.shares * BigInt(percent) / 100n;
      let hash: `0x${string}`;

      if (action === "unwind") {

        if (address.toLowerCase() !== snap.curator.toLowerCase() || !snap.paused) throw new Error("The curator must pause deposits first.");
        if (!unwindToken || !snap.tokens.includes(unwindToken)) throw new Error("Select a constituent.");

        const decimals = await publicClient.readContract({ address: unwindToken, abi: erc20Abi, functionName: "decimals" });

        const amount = parseUnits(unwindAmount, decimals), floor = parseEther(unwindMinimum);

        if (amount <= 0n || floor <= 0n) throw new Error("Enter a positive token amount and minimum WETH output.");

        const unwindArgs=[unwindToken,amount,floor,deadline()] as const;
        const { request } = snap.controller
          ? await publicClient.simulateContract({address:snap.controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"emergencyUnwind",args:unwindArgs})
          : await publicClient.simulateContract({...common,functionName:"emergencyUnwind",args:unwindArgs});
        hash = await walletClient.writeContract(request);

      } else if (action === "pause") {

        if (address.toLowerCase() !== snap.curator.toLowerCase()) throw new Error("Only the curator can pause deposits.");
        const { request } = snap.controller
          ? await publicClient.simulateContract({address:snap.controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"setPaused",args:[!snap.paused]})
          : await publicClient.simulateContract({...common,functionName:"setPaused",args:[!snap.paused]});
        hash = await walletClient.writeContract(request);

      } else if (action === "deposit") {

        const checks = await preflightV2Routes(vault);

        if (checks.some(c => c.targetBps > 0 && (!c.buyAvailable || !c.sellAvailable))) throw new Error("An intended asset route is unavailable. Retry later; direct redemption remains available.");

        const value = parseEther(eth);

        const minimumDeposit = snap.supply === 0n ? snap.firstMinimum : parseEther("0.02");

        if (value < minimumDeposit) throw new Error("The minimum deposit is " + formatEther(minimumDeposit) + " ETH.");

        const preview = await publicClient.readContract({ ...common, functionName: "previewDeposit", args: [value] });

        const floor = preview * 99n / 100n;

        const { request } = await publicClient.simulateContract({ ...common, functionName: "deposit", args: [floor, deadline()], value });

        hash = await walletClient.writeContract(request);

      } else if (action === "withdraw") {
        const latestBlock = await publicClient.getBlockNumber();
        const [latestShares, latestSupply, latestAssets] = await Promise.all([
          publicClient.readContract({ ...common, blockNumber: latestBlock, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ ...common, blockNumber: latestBlock, functionName: "totalSupply" }),
          publicClient.readContract({ ...common, blockNumber: latestBlock, functionName: "totalAssets" }).catch(() => undefined),
        ]);
        const freshShares = latestShares * BigInt(percent) / 100n;
        if (freshShares <= 0n) throw new Error("Choose shares to withdraw.");
        const navFloor = latestAssets === undefined ? 1n : withdrawalFloor(latestAssets, latestShares, latestSupply, percent).floor;
        if (navFloor <= 0n) throw new Error("This withdrawal is too small to protect.");
        const result = await quoteWithdrawalWithRetry(async () => {
          const rehearsal = await publicClient.simulateContract({ ...common, blockNumber: latestBlock, functionName: "withdraw", args: [freshShares, navFloor, deadline()] });
          return rehearsal.result;
        });
        const protectedQuote = protectedWithdrawalMinimum(result, navFloor);
        setMinimum(protectedQuote.minimum); setQuoteMessage(""); setWithdrawalFailure(undefined);
        await preflightV2Routes(vault);
        const { request } = await publicClient.simulateContract({ ...common, functionName: "withdraw", args: [freshShares, protectedQuote.floor, deadline()] });
        hash = await walletClient.writeContract(request);

      } else if (action === "assets") {

        const { request } = await publicClient.simulateContract({ ...common, functionName: "emergencyRedeemInKind", args: [selectedShares, address] });

        hash = await walletClient.writeContract(request);

      } else {
        if (!token || !recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("Enter a valid claim recipient.");

        const { request } = await publicClient.simulateContract({ ...common, functionName: "claim", args: [token, recipient] });

        hash = await walletClient.writeContract(request);

      }
      setMessage("Transaction submitted. Waiting for confirmation.");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") throw new Error("Transaction reverted. No completed exit was recorded.");

      await read(); setMessage("Transaction confirmed.");

    } catch (error) {

      if (action === "withdraw") {
        const failure = classifyWithdrawalQuoteFailure(error);
        setWithdrawalFailure(failure);
        setQuoteMessage(failure === "invalid-reference" ? blockedReferenceMessage(snap?.blocked ?? []) : failure === "protected-floor" ? "Protected route floor not met · use direct assets below" : "Route unavailable · try again");
        setMessage("Withdrawal was not submitted. Your shares are unchanged.");
      } else {
        setMessage(error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "Transaction failed.");
      }
    } finally { setBusy(false); }

  }

  const button = "vault-button";
  const symbol = slug.toUpperCase();
  const isCurator = !!address && address.toLowerCase() === snap?.curator.toLowerCase();
  const exitAsTokens = withdrawalFailure === "invalid-reference" || !!snap?.blocked?.length;
  const lowest = snap ? (snap.supply === 0n ? snap.firstMinimum : parseEther("0.02")) : parseEther("0.02");
  const selected = snap ? snap.shares * BigInt(percent) / 100n : 0n;
  const eth6 = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const pick = (value: number) => { setMinimum(""); setQuoteMessage(""); setWithdrawalFailure(undefined); setPercent(value); };
  const tokenExit = snap && <div className={exitAsTokens ? "vp-token-exit" : undefined}>
    <h3>{exitAsTokens ? "Recommended exit right now" : "Withdraw as tokens"}</h3>
    <p>Exit without swaps. Receive your share of every asset and the cash reserve. This works even when prices are unavailable.</p>
    <button className={exitAsTokens ? "vp-primary" : button} disabled={busy || !address || snap.shares === 0n} onClick={() => void transact("assets")}>Withdraw {percent}% as tokens and cash</button>
  </div>;
  const connectButton = !address ? <button className="vp-primary" onClick={() => void connect()}>Connect wallet</button> : chainId !== robinhood.id ? <button className="vp-primary" onClick={() => void switchToRobinhood()}>Switch to Robinhood Chain</button> : null;
  const trade = <section id="wallet-actions" className="vp-trade desk">
    <div className="vp-tabs" role="tablist">{(["deposit", "withdraw"] as const).map(name => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => { setMessage(""); setTab(name); }}>{name === "deposit" ? "Deposit" : "Withdraw"}</button>)}</div>
    {snap?.assets === undefined && snap && <p className="vp-hint is-warn">{snap.blocked?.length ? `ETH deposits and ETH exits are paused while ${snap.blocked.map(b => b.symbol).join(", ")} ${snap.blocked.length === 1 ? "is" : "are"} below safe pricing liquidity. You can still exit as tokens and cash.` : "Pricing is unavailable. You can still exit as tokens and cash."}</p>}
    {tab === "deposit" ? <>
      <label className="vp-field"><span className="vp-field-top"><span>You pay</span><span>{address && snap?.walletEth !== undefined ? `Balance ${eth6(snap.walletEth)} ETH` : ""}</span></span><span className="vp-amount"><input aria-label="Deposit ETH" value={eth} onChange={e => setEth(e.target.value)} inputMode="decimal" /><b>ETH</b></span></label>
      <div className="vp-chips">{["0.02", "0.05", "0.1", "0.25"].map(value => <button type="button" key={value} aria-pressed={eth === value} disabled={busy || parseEther(value) < lowest || (snap?.walletEth !== undefined && parseEther(value) > snap.walletEth)} onClick={() => setEth(value)}>{value}</button>)}</div>
      {connectButton ?? <button className="vp-primary" disabled={busy || !snap || snap.paused || snap.assets === undefined} onClick={() => void transact("deposit")}>{snap?.paused ? "Deposits paused" : busy ? "Working…" : "Deposit"}</button>}
      <p className="vp-hint">One deposit buys the whole basket. Minimum {formatEther(lowest)} ETH, plus gas.</p>
    </> : <>
      <div className="vp-field"><span className="vp-field-top"><span>You withdraw</span><span>{address && snap ? `Balance ${eth6(snap.shares)} ${symbol}` : ""}</span></span><span className="vp-amount"><output>{eth6(selected)}</output><b>{symbol}</b></span></div>
      <div className="vp-chips">{[25,50,75,100].map(value => <button type="button" aria-pressed={percent === value} key={value} disabled={busy} onClick={() => pick(value)}>{value === 100 ? "Max" : `${value}%`}</button>)}</div>
      <input className="vp-range" aria-label="Portion to redeem" type="range" min="1" max="100" value={percent} disabled={busy} onChange={e => pick(Number(e.target.value))} />
      <dl className="vp-lines"><div><dt>You receive at least</dt><dd>{quoting ? "Calculating…" : minimum ? `${minimum} ETH` : withdrawalFailure === "invalid-reference" ? "Unavailable" : "—"}</dd></div></dl>
      {withdrawalFailure && <p className="vp-hint is-warn" role="status">{quoteMessage}</p>}
      {exitAsTokens ? tokenExit : null}
      {connectButton ?? <button className={exitAsTokens ? button : "vp-primary"} disabled={busy || !snap || snap.shares === 0n} onClick={() => void transact("withdraw")}>{busy ? "Working…" : snap?.shares === 0n ? "Nothing to withdraw" : `Withdraw ${percent}% as ETH`}</button>}
      <p className="vp-hint">Sells your share of every holding for ETH in one transaction.</p>
    </>}
    {snap?.paused && <p className="vp-hint">Deposits are paused. You can still withdraw.</p>}
    {message && <p className="vp-message" role="status" aria-live="polite">{message}</p>}
    {snap?.claims.some(c => c.amount > 0n) && <div className="vp-claims">
      <h3>Pending asset claims</h3>
      <label>Recipient <input aria-label="Claim recipient" className="vault-input" value={recipient ?? ""} onChange={e => setRecipient(e.target.value as Address)} /></label>
      {snap.claims.filter(c => c.amount > 0n).map(c => <div key={c.token} className="vp-claim">
        <span>{c.token === zeroAddress ? "Native ETH" : c.token}: {c.amount.toString()} base units</span>
        <button className={button} disabled={busy} onClick={() => void transact("claim", c.token)}>Retry</button>
      </div>)}
    </div>}
    <details className="vp-more"><summary>More options</summary>
      {!exitAsTokens && tokenExit}
      {isCurator && snap?.paused && <div className="vault-recovery">
        <h2>Curator emergency unwind</h2>
        <p>Sell a constituent into WETH kept inside the vault. This does not send shareholder assets to your wallet. Oracle and output protections still apply.</p>
        <label className="block">Constituent <select className="w-full bg-black" value={unwindToken ?? ""} onChange={e => setUnwindToken(e.target.value as Address)}><option value="">Select an asset</option>{snap.tokens.map(token => <option key={token} value={token}>{token}</option>)}</select></label>
        <label className="block">Token amount <input className="vault-input" value={unwindAmount} onChange={e => setUnwindAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="block">Minimum WETH received by vault <input className="vault-input" value={unwindMinimum} onChange={e => setUnwindMinimum(e.target.value)} inputMode="decimal" /></label>
        <button className={button} disabled={busy || !unwindToken || !unwindAmount || !unwindMinimum} onClick={() => void transact("unwind")}>Review emergency unwind</button>
      </div>}
      <div className="vp-more-row">{isCurator && snap && <button className={button} disabled={busy} onClick={() => void transact("pause")}>{snap.paused ? "Resume deposits" : "Pause deposits"}</button>}<button className={button} disabled={busy} onClick={() => void read().catch(() => setMessage("Unable to refresh balances."))}>Refresh balances</button></div>
    </details>
  </section>;
  return <section className="vault-dashboard">
    <VaultOverview vault={vault} slug={slug} assets={snap?.assets ?? snap?.quoteAssets} quoteTime={snap?.quoteTime} valuationFailed={snap?.valuationFailed} supply={snap?.quoteSupply ?? snap?.supply} paused={snap?.paused} curator={isCurator} aside={trade}>
    <VaultPerformance estimated={snap?.quoteAssets !== undefined} valuationFailed={snap?.valuationFailed && snap?.quoteAssets === undefined} vault={vault} symbol={symbol} account={address} assets={snap?.assets ?? snap?.quoteAssets} shares={snap?.shares} supply={snap?.quoteSupply ?? snap?.supply} block={snap?.block} />
    </VaultOverview>
    {snap && isCurator && <details id="curator-workspace" className="vault-curator-panel" open={curatorOpen} onToggle={event=>setCuratorOpen(event.currentTarget.open)}><summary>Curator workspace <span>Allocation, rebalancing & basket management</span></summary>{curatorOpen&&<V2CuratorDesk key={`${vault}:${address}:${snap.controller ?? "direct"}`} vault={vault} controller={snap.controller} paused={snap.paused} busy={busy} onBusy={setBusy} onRefresh={read} />}</details>}
  </section>;
}
