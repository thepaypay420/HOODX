"use client";

import { useCallback, useEffect, useState } from "react";
import { BaseError, formatEther, formatUnits, parseAbi, parseAbiItem, parseUnits, type Address } from "viem";
import { publicClient, useWallet } from "@/lib/wallet";
import { robinhood } from "@/lib/chain";
import { allocation, equalAllocation } from "@/lib/v2Allocation";

const abi = parseAbi([
  "function policy() view returns (address)", "function totalAssets() view returns (uint256)", "function configId(address) view returns (bytes32)", "function config(bytes32) view returns (address token,address oracle,bytes buy,bytes sell)", "function value(address,uint256) view returns (uint256)",
  "function owner() view returns (address)", "function constituents() view returns (address[])",
  "function targetBps(address) view returns (uint16)", "function cashTargetBps() view returns (uint16)",
  "function freeBalance(address) view returns (uint256)", "function weth() view returns (address)",
  "function setTargets(uint16 cashBps,uint16[] weights)",
  "function rebalance(address token,bool buy,uint256 amount,uint256 minOut,uint256 deadline)",
  "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "function reserved(address) view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function addConstituent(bytes32 id)", "function removeConstituent(address token)",
]);
type Row = { token: Address; symbol: string; decimals: number; balance: bigint; held: bigint; reserved: bigint; target: string; value?: bigint; nav?: bigint };

export function V2CuratorDesk({ vault, paused, busy, onBusy, onRefresh }: { vault: Address; paused: boolean; busy: boolean; onBusy: (value: boolean) => void; onRefresh: () => Promise<void> }) {
  const { address, chainId, walletClient, switchToRobinhood } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [cash, setCash] = useState("25");
  const [weights, setWeights] = useState<string[]>([]);
  const [wethBalance, setWethBalance] = useState<bigint>();
  const [selected, setSelected] = useState("");
  const [buy, setBuy] = useState(false);
  const [amount, setAmount] = useState("");
  const [minimum, setMinimum] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [removeToken, setRemoveToken] = useState("");
  const [config, setConfig] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [tokens, cashBps, weth, policy, nav] = await Promise.all([
      publicClient.readContract({ address: vault, abi, functionName: "constituents" }),
      publicClient.readContract({ address: vault, abi, functionName: "cashTargetBps" }),
      publicClient.readContract({ address: vault, abi, functionName: "weth" }),
      publicClient.readContract({ address: vault, abi, functionName: "policy" }),
      publicClient.readContract({ address: vault, abi, functionName: "totalAssets" }).catch(() => undefined),
    ]);
    const list = await Promise.all(tokens.map(async token => {
      const [symbol, decimals, balance, target, held, reserved] = await Promise.all([
        publicClient.readContract({ address: token, abi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi, functionName: "decimals" }),
        publicClient.readContract({ address: vault, abi, functionName: "freeBalance", args: [token] }),
        publicClient.readContract({ address: vault, abi, functionName: "targetBps", args: [token] }),
        publicClient.readContract({ address: token, abi, functionName: "balanceOf", args: [vault] }),
        publicClient.readContract({ address: vault, abi, functionName: "reserved", args: [token] }),
      ]);
      const value = await (async () => {
        const id = await publicClient.readContract({address:vault,abi,functionName:"configId",args:[token]});
        const [,oracle] = await publicClient.readContract({address:policy,abi,functionName:"config",args:[id]});
        return publicClient.readContract({address:oracle,abi,functionName:"value",args:[token,balance]});
      })().catch(() => undefined);
      return { token, symbol, decimals, balance, held, reserved, value, nav, target: (target / 100).toFixed(2) };
    }));
    const balance = await publicClient.readContract({ address: vault, abi, functionName: "freeBalance", args: [weth] });
    return { list, balance, cash: (cashBps / 100).toFixed(2) };
  }, [vault]);
  const apply = (data: Awaited<ReturnType<typeof load>>) => {
    setRows(data.list); setWeights(data.list.map(r => r.target)); setCash(data.cash); setWethBalance(data.balance); setLoaded(true);
  };
  useEffect(() => { let active = true; setLoaded(false); void load().then(data => { if (active) apply(data); }).catch(() => { if (active) setMessage("Unable to read curator data. Reload this page to retry."); }); return () => { active = false; }; }, [load]);
  const row = rows.find(r => r.token === selected);
  const removal = rows.find(r => r.token === removeToken);
  const removalReason = !removal ? "Select a token to remove." : rows.length <= 2 ? "At least two configured assets must remain." : removal.target !== "0.00" ? "Set this token’s target to 0% and save allocations first." : removal.held > 0n ? "Sell its remaining holdings into WETH first." : removal.reserved > 0n ? "Reserved shareholder claims must be cleared first." : "Ready to remove. No holdings, targets or claims remain.";
  const canRemove = !!removal && rows.length > 2 && removal.target === "0.00" && removal.held === 0n && removal.reserved === 0n;
  async function findApprovedToken() {
    if (busy) return;
    setConfig(""); setMessage("");
    if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) { setMessage("Enter a valid token contract address."); return; }
    if (rows.some(r => r.token.toLowerCase() === tokenAddress.toLowerCase())) { setMessage("This token is already configured. Set its target in the allocation planner."); return; }
    onBusy(true);
    try {
      const policy = await publicClient.readContract({address:vault,abi,functionName:"policy"});
      const end = await publicClient.getBlockNumber();
      const event = parseAbiItem("event ConfigApproved(bytes32 indexed id,address indexed token,address oracle,bytes32 evidence)");
      let approved: `0x${string}` | undefined;
      for (let from = 67761602n; from <= end; from += 10000n) {
        const logs = await publicClient.getLogs({address:policy,event,args:{token:tokenAddress as Address},fromBlock:from,toBlock:from+9999n>end?end:from+9999n});
        if (logs.length) approved = logs[logs.length-1].args.id;
      }
      if (!approved) throw new Error("No approved V2 route found. This token needs route/oracle approval before it can be added; pasting an address cannot bypass that requirement.");
      const [token] = await publicClient.readContract({address:policy,abi,functionName:"config",args:[approved]});
      if (token.toLowerCase() !== tokenAddress.toLowerCase()) throw new Error("Route does not match this token.");
      setConfig(approved); setMessage("Approved route found. Review adding this token below, then assign its allocation.");
    } catch(e) { setMessage(e instanceof BaseError ? e.shortMessage : (e as Error).message); } finally { onBusy(false); }
  }
  let valid = false, validation = "";
  try { allocation(cash, weights); valid = loaded; } catch (e) { validation = (e as Error).message; }
  async function submit(action: "targets" | "trade" | "add" | "remove") {
    if (!walletClient || !address || !loaded || busy) return;
    if (chainId !== robinhood.id) { await switchToRobinhood(); return; }
    onBusy(true); setMessage("");
    try {
      const owner = await publicClient.readContract({ address: vault, abi, functionName: "owner" });
      if (owner.toLowerCase() !== address.toLowerCase()) throw new Error("Only the current curator can manage this vault.");
      const common = { address: vault, abi, account: address, chain: robinhood } as const;
      let hash: `0x${string}`;
      if (action === "targets") {
        const fresh = await publicClient.readContract({ address: vault, abi, functionName: "constituents" });
        if (fresh.length !== rows.length || fresh.some((t, i) => t.toLowerCase() !== rows[i].token.toLowerCase())) throw new Error("The basket changed. Reload before setting targets.");
        const draft = allocation(cash, weights);
        const { request } = await publicClient.simulateContract({ ...common, functionName: "setTargets", args: [draft.cashBps, draft.weights] });
        hash = await walletClient.writeContract(request);
      } else if (action === "trade") {
        if (!row) throw new Error("Choose an asset.");
        const input = parseUnits(amount, buy ? 18 : row.decimals), floor = parseUnits(minimum, buy ? row.decimals : 18);
        if (input <= 0n || floor <= 0n) throw new Error("Amount and minimum output must be positive.");
        if (buy && paused) throw new Error("Resume deposits before buying assets.");
        const { request } = await publicClient.simulateContract({ ...common, functionName: "rebalance", args: [row.token, buy, input, floor, BigInt(Math.floor(Date.now() / 1000) + 600)] });
        hash = await walletClient.writeContract(request);
      } else if (action === "add") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(config)) throw new Error("Enter an approved route configuration ID.");
        const { request } = await publicClient.simulateContract({ ...common, functionName: "addConstituent", args: [config as `0x${string}`] });
        hash = await walletClient.writeContract(request);
      } else {
        if (!removal || !canRemove) throw new Error(removalReason);
        const { request } = await publicClient.simulateContract({ ...common, functionName: "removeConstituent", args: [removal.token] });
        hash = await walletClient.writeContract(request);
      }
      setMessage("Transaction submitted. Waiting for confirmation.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted. Refresh before retrying.");
      apply(await load()); await onRefresh(); setAmount(""); setMinimum(""); setMessage("Confirmed. Vault balances and targets refreshed.");
    } catch (e) { setMessage(e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "Transaction failed."); }
    finally { onBusy(false); }
  }
  return <section id="curator" className="vault-actions holo">
    <div className="vault-section-heading"><div><p className="vault-eyebrow">CURATOR WORKSPACE</p><h2>Manage the basket.</h2></div><span className="vault-tag">Owner access</span></div>
    <p className="vault-footnote">Plan targets, save them on-chain, then trade to move the basket toward them. Saving targets does not move assets. All trades stay inside the vault.</p>
    {!loaded ? <p>Loading curator tools…</p> : <>
      <div className="vault-recovery"><h3>1. Plan your allocation</h3>
        <label>Cash reserve (%)<input className="vault-input" inputMode="decimal" value={cash} disabled={busy} onChange={e => setCash(e.target.value)} /></label>
        <div className="vault-presets"><button className="vault-button" disabled={busy} onClick={() => { try { setWeights(equalAllocation(cash, rows.length)); } catch(e) { setMessage((e as Error).message); } }}>Equal weight assets</button><button className="vault-button" disabled={busy} onClick={() => { onBusy(true); void load().then(apply).catch(() => setMessage("Unable to reload targets.")).finally(() => onBusy(false)); }}>Reset to on-chain</button></div>
        <div className="vault-table-scroll"><table className="vault-table"><thead><tr><th>Asset / free balance</th><th>Current / target</th><th>New target %</th></tr></thead><tbody>{rows.map((r,i) => <tr key={r.token}><td>{r.symbol}<small title={formatUnits(r.balance,r.decimals)}>{Number(formatUnits(r.balance,r.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})}</small></td><td>{r.value !== undefined && r.nav ? `${(Number(r.value * 10000n / r.nav)/100).toFixed(2)}%` : "—"}<small>Target {r.target}%</small></td><td><input className="vault-target-input" aria-label={`${r.symbol} target percent`} inputMode="decimal" value={weights[i] ?? ""} disabled={busy} onChange={e => setWeights(weights.map((w,j) => j===i ? e.target.value : w))} /></td></tr>)}</tbody></table></div>
        <p className="vault-footnote">{valid ? "Total: 100%. Ready to save." : validation} Cash must stay between 20% and 50%.</p>
        <button className="vault-button" disabled={busy || !valid} onClick={() => void submit("targets")}>Review and save targets</button>
      </div>
      <div className="vault-recovery"><h3>2. Rebalance holdings</h3><p>Vault WETH available: {wethBalance === undefined ? "—" : formatEther(wethBalance)}. Buys must preserve the target cash reserve. Sales and buys retain the contract’s oracle and minimum-output protections.</p>
        <label>Asset<select className="vault-input" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setAmount(""); setMinimum(""); }}><option value="">Choose an asset</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}</option>)}</select></label>
        <div className="vault-presets">{[false,true].map(value => <button className="vault-button" aria-pressed={buy===value} key={String(value)} disabled={busy} onClick={() => { setBuy(value); setAmount(""); setMinimum(""); }}>{value ? "Buy with vault WETH" : "Sell into vault WETH"}</button>)}</div>
        <label>Amount ({buy ? "WETH" : row?.symbol ?? "tokens"})<input className="vault-input" value={amount} disabled={busy} inputMode="decimal" onChange={e => setAmount(e.target.value)} /></label>
        {row && !buy && <button className="vault-button" disabled={busy} onClick={() => setAmount(formatUnits(row.balance,row.decimals))}>Max available {row.symbol}</button>}
        <label>Minimum output ({buy ? row?.symbol ?? "tokens" : "WETH"})<input className="vault-input" value={minimum} disabled={busy} inputMode="decimal" onChange={e => setMinimum(e.target.value)} /></label>
        <button className="vault-button" disabled={busy || !row || !amount || !minimum || (buy && paused)} onClick={() => void submit("trade")}>Simulate and review rebalance</button>
      </div>
      <div className="vault-recovery"><h3>3. Add or remove tokens</h3>
        <p>Configured tokens remain in the curator planner even when their balance is zero. Adding a token does not buy it automatically.</p>
        <div className="vault-trade-grid"><div><h4>Add token</h4><label>Token contract address<input className="vault-input" aria-label="New token address" value={tokenAddress} disabled={busy} onChange={e => {setTokenAddress(e.target.value);setConfig("");}} placeholder="0x…" /></label><button className="vault-button" disabled={busy || !tokenAddress} onClick={() => void findApprovedToken()}>Find approved route</button><p>{config ? "Approved route ready for review." : "Paste a token address to check its approved V2 route."}</p><button className="vault-button" disabled={busy || paused || !config || rows.length >= 24} onClick={() => void submit("add")}>Review adding token</button>{paused && <p>Resume deposits before adding tokens.</p>}</div>
        <div><h4>Remove token</h4><label>Configured token<select className="vault-input" aria-label="Token to remove" value={removeToken} disabled={busy} onChange={e => setRemoveToken(e.target.value)}><option value="">Choose a token</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}{r.held === 0n ? " — no holdings" : ""}</option>)}</select></label><p>{removalReason}</p><button className="vault-button" disabled={busy || !canRemove} onClick={() => void submit("remove")}>Review removing token</button></div></div>
      </div>
    </>}
    <p role="status" aria-live="polite" className={message ? "vault-notice" : ""}>{message}</p>
  </section>;
}
