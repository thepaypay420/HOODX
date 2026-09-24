"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, erc20Abi, formatEther, parseEther, parseUnits, zeroAddress, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { publicClient, useWallet } from "@/lib/wallet";
import { preflightV2Routes } from "@/lib/v2Preflight";
import { V2CuratorDesk } from "@/components/V2CuratorDesk";
import { VaultPerformance } from "@/components/VaultPerformance";
import { VaultOverview } from "@/components/VaultOverview";
import { v2VaultAbi } from "@/lib/v2";
import { withdrawalFloor } from "@/lib/withdrawMinimum";
import { classifyWithdrawalQuoteFailure, protectedWithdrawalMinimum, withdrawalQuoteFailureMessage, type WithdrawalQuoteFailure } from "@/lib/v2WithdrawalQuote";
import { rebalanceControllerAbi, resolveVaultAuthority } from "@/lib/rebalanceController";

type Snapshot = { account: Address; vault: Address; owner: Address; curator: Address; controller?: Address; walletEth?: bigint; block: bigint; firstMinimum: bigint; shares: bigint; supply: bigint; paused: boolean; assets?: bigint; valuationFailed?: boolean; quoteAssets?: bigint; quoteSupply?: bigint; quoteTime?: number; tokens: Address[]; claims: { token: Address; amount: bigint }[] };
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);

export function V2VaultDesk({ vault, slug }: { vault: Address; slug: string }) {
  const { address, walletClient, chainId, connect, switchToRobinhood } = useWallet();
  const [snapshot, setSnap] = useState<Snapshot>();
  const snap = snapshot?.account === (address ?? zeroAddress) && snapshot.vault === vault ? snapshot : undefined;
  const generation = useRef(0);
  const [eth, setEth] = useState("0.02");
  const [minimum, setMinimum] = useState("");
  const [percent, setPercent] = useState(100);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [quoteMessage, setQuoteMessage] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [withdrawalFailure, setWithdrawalFailure] = useState<WithdrawalQuoteFailure>();
  const manualMinimum = useRef("");
  const minimumScope = `${address}:${vault}:${percent}:${snap?.shares}`;
  const [recipient, setRecipient] = useState<Address>();
  const [busy, setBusy] = useState(false);
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
    setSnap({ account, vault, owner, curator: authority.curator, controller: authority.controller, walletEth, block, firstMinimum, shares, supply, paused, assets, quoteAssets, quoteSupply, quoteTime, valuationFailed: assets === undefined, tokens: [...tokens], claims: claimTokens.map((token, i) => ({ token, amount: amounts[i] })) });
  }, [address, vault]);
  useEffect(() => { let cancelled = false; setSnap(undefined); setRecipient(address); read().catch(() => { if (!cancelled) setMessage("Unable to read vault balances. Retry before transacting."); }); return () => { cancelled = true; generation.current++; }; }, [read, address]);
  useEffect(() => {
    if (snap?.supply === 0n) setEth(formatEther(snap.firstMinimum));
  }, [snap?.supply, snap?.firstMinimum, vault]);
  useEffect(() => { if (!address) return; const timer = setInterval(() => { if (!busy) void read().catch(() => {}); }, 30000); return () => clearInterval(timer); }, [address, busy, read]);
  useEffect(() => {
    let active = true;
    if (manualMinimum.current === minimumScope) return;
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
      void publicClient.simulateContract({ address: vault, abi: v2VaultAbi, account: address, functionName: "withdraw", args: [selected, navFloor, deadline()] }).then(({ result }) => {
        if (!active) return;
        const protectedQuote = protectedWithdrawalMinimum(result, navFloor);
        setMinimum(protectedQuote.minimum);
        setWithdrawalFailure(undefined);
        setQuoteMessage(protectedQuote.message);
      }).catch(error => {
        if (!active) return;
        const failure = classifyWithdrawalQuoteFailure(error);
        setWithdrawalFailure(failure);
        setQuoteMessage(withdrawalQuoteFailureMessage(failure));
      }).finally(() => { if (active) setQuoting(false); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [address, vault, percent, snap?.shares, snap?.assets, snap?.supply, quoteRefresh, minimumScope]);
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
        if (withdrawalFailure) throw new Error(withdrawalQuoteFailureMessage(withdrawalFailure));
        await preflightV2Routes(vault);
        const minOut = parseEther(minimum);
        if (minOut <= 0n) throw new Error("Enter the minimum ETH you will accept.");
        const { request } = await publicClient.simulateContract({ ...common, functionName: "withdraw", args: [selectedShares, minOut, deadline()] });
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
      setMessage(error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "Transaction failed.");
    } finally { setBusy(false); }
  }
  const button = "vault-button";
  return <section className="vault-dashboard">
    <VaultOverview vault={vault} slug={slug} shares={snap?.shares} assets={snap?.assets ?? snap?.quoteAssets} quoteTime={snap?.quoteTime} valuationFailed={snap?.valuationFailed} supply={snap?.supply} paused={snap?.paused} connected={!!address} curator={!!address && address.toLowerCase() === snap?.curator.toLowerCase()}>
    <VaultPerformance estimated={snap?.quoteAssets !== undefined} valuationFailed={snap?.valuationFailed && snap?.quoteAssets === undefined} vault={vault} account={address} assets={snap?.assets ?? snap?.quoteAssets} shares={snap?.shares} supply={snap?.quoteSupply ?? snap?.supply} block={snap?.block} />
    </VaultOverview>
    {snap && address?.toLowerCase() === snap.curator.toLowerCase() && <details id="curator-workspace" className="vault-curator-panel"><summary>Curator workspace <span>Allocation, rebalancing & basket management</span></summary><V2CuratorDesk key={`${vault}:${address}:${snap.controller ?? "direct"}`} vault={vault} controller={snap.controller} paused={snap.paused} busy={busy} onBusy={setBusy} onRefresh={read} /></details>}
    <div id="wallet-actions" className="vault-actions desk">
    <div className="vault-section-heading"><div><p className="vault-eyebrow">YOUR POSITION</p><h2>Make your next move.</h2></div><span className="vault-tag">{slug.toUpperCase()}</span></div>

    {!address ? <button className={button} onClick={() => void connect()}>Connect wallet</button> : chainId !== robinhood.id ? <button className={button} onClick={() => void switchToRobinhood()}>Switch to Robinhood Chain</button> : null}
    {snap && <>

      {snap.assets === undefined && <p className="vault-notice">Pricing is unavailable. Direct asset redemption remains available.</p>}
      {snap.paused && <p>Deposits are paused. You can still withdraw.</p>}
      {address?.toLowerCase() === snap.curator.toLowerCase() && <button className={button} disabled={busy} onClick={() => void transact("pause")}>{snap.paused ? "Resume deposits" : "Pause deposits"}</button>}
      {address?.toLowerCase() === snap.curator.toLowerCase() && snap.paused && <div className="vault-recovery">
        <h2>Curator emergency unwind</h2>
        <p>Sell a constituent into WETH kept inside the vault. This does not send shareholder assets to your wallet. Oracle and output protections still apply.</p>
        <label className="block">Constituent <select className="w-full bg-black" value={unwindToken ?? ""} onChange={e => setUnwindToken(e.target.value as Address)}><option value="">Select an asset</option>{snap.tokens.map(token => <option key={token} value={token}>{token}</option>)}</select></label>
        <label className="block">Token amount <input className="vault-input" value={unwindAmount} onChange={e => setUnwindAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="block">Minimum WETH received by vault <input className="vault-input" value={unwindMinimum} onChange={e => setUnwindMinimum(e.target.value)} inputMode="decimal" /></label>
        <button className={button} disabled={busy || !unwindToken || !unwindAmount || !unwindMinimum} onClick={() => void transact("unwind")}>Review emergency unwind</button>
      </div>}
      <div className="vault-trade-grid"><div className="vault-trade-card">
        <p className="vault-eyebrow">01 / JOIN THE BASKET</p><h3>Deposit</h3>
        <p>Wallet: {address ? (snap.walletEth === undefined ? "Balance unavailable" : `${formatEther(snap.walletEth)} ETH`) : "Connect wallet"}</p>
        <label className="block">Deposit ETH <input aria-label="Deposit ETH" className="vault-input" value={eth} onChange={e => setEth(e.target.value)} inputMode="decimal" /></label>
        <div className="vault-presets">{["0.02", "0.05", "0.08", "0.1"].map(value => <button className="vault-button" key={value} disabled={busy || parseEther(value) < (snap.supply === 0n ? snap.firstMinimum : parseEther("0.02")) || (snap.walletEth !== undefined && parseEther(value) > snap.walletEth)} onClick={() => setEth(value)}>{value} ETH</button>)}</div>
        <p className="text-sm">Minimum deposit: {formatEther(snap.supply === 0n ? snap.firstMinimum : parseEther("0.02"))} ETH.</p>
        <p className="text-sm">Up to 1% fewer shares than the current preview. Your wallet shows the transaction before signing.</p>
        <button className={button} disabled={busy || !address || snap.paused || snap.assets === undefined} onClick={() => void transact("deposit")}>Deposit ETH</button>
      </div>
      <div className="vault-trade-card">
        <p className="vault-eyebrow">02 / TAKE YOUR SHARE</p><h3>Withdraw</h3>
        <p>Wallet: {formatEther(snap.shares)} {slug.toUpperCase()}</p>
        <div className="vault-presets">{[25,50,75,100].map(value => <button className="vault-button" aria-pressed={percent === value} key={value} disabled={busy} onClick={() => { manualMinimum.current = ""; setMinimum(""); setWithdrawalFailure(undefined); setPercent(value); setQuoteRefresh(n => n + 1); }}>{value === 100 ? "Max" : `${value}%`}</button>)}</div>
        <p>Sell: {formatEther(snap.shares * BigInt(percent) / 100n)} {slug.toUpperCase()}</p>
        <label className="block">Minimum ETH to receive <input aria-label="Minimum ETH to receive" className="vault-input" value={minimum} disabled={busy || quoting || withdrawalFailure === "invalid-reference"} placeholder={quoting ? "Calculating protected minimum…" : withdrawalFailure === "invalid-reference" ? "ETH exit unavailable" : "Minimum ETH"} onChange={e => { manualMinimum.current = minimumScope; setWithdrawalFailure(undefined); setMinimum(e.target.value); }} inputMode="decimal" /></label>
        <p role="status">{quoting ? "Checking the full withdrawal…" : quoteMessage}</p>
        <button className={button} disabled={busy || quoting || !address || !snap.shares} onClick={() => { manualMinimum.current = ""; setMinimum(""); setQuoteRefresh(n => n + 1); }}>Refresh withdrawal quote</button>
        <p className="text-sm">Redeems the selected portion of your shares. If any required sale fails, the whole withdrawal reverts and your shares stay intact.</p>
        <button className={button} disabled={busy || quoting || !!withdrawalFailure || !address || snap.shares === 0n || !minimum} onClick={() => void transact("withdraw")}>Withdraw {percent}% as ETH</button>
      </div>
      </div><label className="vault-percent">Portion to redeem: {percent}% <input aria-label="Portion to redeem" type="range" min="1" max="100" value={percent} disabled={busy} onChange={e => { manualMinimum.current = ""; setMinimum(""); setPercent(Number(e.target.value)); }} /></label>
      <div className="vault-recovery">
        <h2 className="text-lg">Receive assets directly</h2>
        <p>Redeem the selected portion of your shares for your proportional tokens and cash without selling through a router. This works while paused and does not need prices. Any token that cannot transfer remains separately claimable by you.</p>
        <button className={button} disabled={busy || !address || snap.shares === 0n} onClick={() => void transact("assets")}>{withdrawalFailure === "invalid-reference" ? `Exit ${percent}% safely as tokens and cash` : `Redeem ${percent}% as tokens and cash`}</button>
      </div>
      {snap.claims.some(c => c.amount > 0n) && <div className="space-y-2">
        <h2>Pending asset claims</h2>
        <label>Recipient <input aria-label="Claim recipient" className="w-full bg-black p-2" value={recipient ?? ""} onChange={e => setRecipient(e.target.value as Address)} /></label>
        {snap.claims.filter(c => c.amount > 0n).map(c => <div key={c.token} className="break-all">
          <p>{c.token === zeroAddress ? "Native ETH" : c.token}: {c.amount.toString()} base units</p>
          <button className={button} disabled={busy} onClick={() => void transact("claim", c.token)}>Retry this claim</button>
        </div>)}
      </div>}
    </>}
    <button className={button} disabled={busy} onClick={() => void read().catch(() => setMessage("Unable to refresh balances."))}>Refresh balances</button>
    <p className={message ? "vault-notice" : ""} role="status" aria-live="polite">{message}</p>
    </div>
  </section>;
}
