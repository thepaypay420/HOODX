"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, erc20Abi, formatEther, parseEther, parseUnits, zeroAddress, type Address } from "viem";
import { robinhood } from "@/lib/chain";
import { publicClient, useWallet } from "@/lib/wallet";
import { preflightV2Routes } from "@/lib/v2Preflight";
import { v2VaultAbi } from "@/lib/v2";

type Snapshot = { account: Address; vault: Address; owner: Address; firstMinimum: bigint; shares: bigint; supply: bigint; paused: boolean; assets?: bigint; tokens: Address[]; claims: { token: Address; amount: bigint }[] };
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);

export function V2VaultDesk({ vault, slug }: { vault: Address; slug: string }) {
  const { address, walletClient, chainId, connect, switchToRobinhood } = useWallet();
  const [snapshot, setSnap] = useState<Snapshot>();
  const snap = snapshot?.account === (address ?? zeroAddress) && snapshot.vault === vault ? snapshot : undefined;
  const generation = useRef(0);
  const [eth, setEth] = useState("0.02");
  const [minimum, setMinimum] = useState("");
  const [percent, setPercent] = useState(100);
  const [recipient, setRecipient] = useState<Address>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [unwindToken, setUnwindToken] = useState<Address>();
  const [unwindAmount, setUnwindAmount] = useState("");
  const [unwindMinimum, setUnwindMinimum] = useState("");
  const read = useCallback(async () => {
    const ticket = ++generation.current;
    const account = address ?? zeroAddress;
    // Price failures must not hide shares or direct asset redemption.
    const [shares, supply, paused, tokens, weth, firstMinimum, owner] = await Promise.all([
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "balanceOf", args: [account] }),
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "totalSupply" }),
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "paused" }),
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "constituents" }),
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "weth" }),
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "minFirstDeposit" }),
      publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "owner" }),
    ]);
    const claimTokens = [zeroAddress, weth, ...tokens];
    const amounts = await Promise.all(claimTokens.map(token => publicClient.readContract({
      address: vault, abi: v2VaultAbi, functionName: "claimable", args: [account, token],
    })));
    if (ticket !== generation.current) return;
    setSnap({ account, vault, owner, firstMinimum, shares, supply, paused, tokens: [...tokens], claims: claimTokens.map((token, i) => ({ token, amount: amounts[i] })) });
    const assets = await publicClient.readContract({ address: vault, abi: v2VaultAbi, functionName: "totalAssets" }).catch(() => undefined);
    if (ticket !== generation.current) return;
    setSnap({ account, vault, owner, firstMinimum, shares, supply, paused, assets, tokens: [...tokens], claims: claimTokens.map((token, i) => ({ token, amount: amounts[i] })) });
  }, [address, vault]);
  useEffect(() => { let cancelled = false; setSnap(undefined); setRecipient(address); read().catch(() => { if (!cancelled) setMessage("Unable to read vault balances. Retry before transacting."); }); return () => { cancelled = true; generation.current++; }; }, [read, address]);
  useEffect(() => {
    if (snap?.supply === 0n) setEth(formatEther(snap.firstMinimum));
  }, [snap?.supply, snap?.firstMinimum, vault]);
  async function transact(action: "deposit" | "withdraw" | "assets" | "claim" | "pause" | "unwind", token?: Address) {
    if (!address || !walletClient || !snap) return;
    if (chainId !== robinhood.id) { await switchToRobinhood(); return; }
    setBusy(true); setMessage("");
    try {
      const common = { address: vault, abi: v2VaultAbi, account: address, chain: robinhood } as const;
      const selectedShares = snap.shares * BigInt(percent) / 100n;
      let hash: `0x${string}`;
      if (action === "unwind") {
        if (address.toLowerCase() !== snap.owner.toLowerCase() || !snap.paused) throw new Error("The curator must pause deposits first.");
        if (!unwindToken || !snap.tokens.includes(unwindToken)) throw new Error("Select a constituent.");
        const decimals = await publicClient.readContract({ address: unwindToken, abi: erc20Abi, functionName: "decimals" });
        const amount = parseUnits(unwindAmount, decimals), floor = parseEther(unwindMinimum);
        if (amount <= 0n || floor <= 0n) throw new Error("Enter a positive token amount and minimum WETH output.");
        const { request } = await publicClient.simulateContract({ ...common, functionName: "emergencyUnwind", args: [unwindToken, amount, floor, deadline()] });
        hash = await walletClient.writeContract(request);
      } else if (action === "pause") {
        if (address.toLowerCase() !== snap.owner.toLowerCase()) throw new Error("Only the curator can pause deposits.");
        const { request } = await publicClient.simulateContract({ ...common, functionName: "setPaused", args: [!snap.paused] });
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
  const button = "rounded-lg border border-white/20 px-4 py-3 disabled:opacity-40";
  return <section className="space-y-5 rounded-2xl border border-white/15 bg-black/50 p-6">
    <h1 className="text-2xl">{slug.toUpperCase()} · V2</h1>
    <p className="break-all text-xs">{vault}</p>
    {!address ? <button className={button} onClick={() => void connect()}>Connect wallet</button> : chainId !== robinhood.id ? <button className={button} onClick={() => void switchToRobinhood()}>Switch to Robinhood Chain</button> : null}
    {snap && <>
      <p>Your shares: {formatEther(snap.shares)}</p>
      <p>{snap.assets === undefined ? "Pricing is unavailable. Direct asset redemption remains available." : `Vault value: ${formatEther(snap.assets)} ETH`}</p>
      {snap.paused && <p>Deposits are paused. You can still withdraw.</p>}
      {address?.toLowerCase() === snap.owner.toLowerCase() && <button className={button} disabled={busy} onClick={() => void transact("pause")}>{snap.paused ? "Resume deposits" : "Pause deposits"}</button>}
      {address?.toLowerCase() === snap.owner.toLowerCase() && snap.paused && <div className="space-y-2 border border-white/20 p-4">
        <h2>Curator emergency unwind</h2>
        <p>Sell a constituent into WETH kept inside the vault. This does not send shareholder assets to your wallet. Oracle and output protections still apply.</p>
        <label className="block">Constituent <select className="w-full bg-black" value={unwindToken ?? ""} onChange={e => setUnwindToken(e.target.value as Address)}><option value="">Select an asset</option>{snap.tokens.map(token => <option key={token} value={token}>{token}</option>)}</select></label>
        <label className="block">Token amount <input className="bg-black" value={unwindAmount} onChange={e => setUnwindAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="block">Minimum WETH received by vault <input className="bg-black" value={unwindMinimum} onChange={e => setUnwindMinimum(e.target.value)} inputMode="decimal" /></label>
        <button className={button} disabled={busy || !unwindToken || !unwindAmount || !unwindMinimum} onClick={() => void transact("unwind")}>Review emergency unwind</button>
      </div>}
      <div className="space-y-2">
        <label className="block">Deposit ETH <input aria-label="Deposit ETH" className="ml-2 bg-black p-2" value={eth} onChange={e => setEth(e.target.value)} inputMode="decimal" /></label>
        <p className="text-sm">Minimum deposit: {formatEther(snap.supply === 0n ? snap.firstMinimum : parseEther("0.02"))} ETH.</p>
        <p className="text-sm">Up to 1% fewer shares than the current preview. Your wallet shows the transaction before signing.</p>
        <button className={button} disabled={busy || !address || snap.paused || snap.assets === undefined} onClick={() => void transact("deposit")}>Deposit ETH</button>
      </div>
      <div className="space-y-2">
        <label className="block">Minimum ETH to receive <input aria-label="Minimum ETH to receive" className="ml-2 bg-black p-2" value={minimum} onChange={e => setMinimum(e.target.value)} inputMode="decimal" /></label>
        <p className="text-sm">Redeems the selected portion of your shares. If any required sale fails, the whole withdrawal reverts and your shares stay intact.</p>
        <button className={button} disabled={busy || !address || snap.shares === 0n || !minimum} onClick={() => void transact("withdraw")}>Withdraw {percent}% as ETH</button>
      </div>
      <label className="block">Portion to redeem: {percent}% <input aria-label="Portion to redeem" type="range" min="1" max="100" value={percent} disabled={busy} onChange={e => setPercent(Number(e.target.value))} /></label>
      <div className="space-y-2 border-t border-white/15 pt-4">
        <h2 className="text-lg">Receive assets directly</h2>
        <p>Redeem the selected portion of your shares for your proportional tokens and cash without selling through a router. This works while paused and does not need prices. Any token that cannot transfer remains separately claimable by you.</p>
        <button className={button} disabled={busy || !address || snap.shares === 0n} onClick={() => void transact("assets")}>Redeem {percent}% as tokens and cash</button>
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
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
