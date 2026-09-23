"use client";

import { useCallback, useEffect, useState } from "react";
import { BaseError, formatEther, formatUnits, parseAbi, parseAbiItem, parseUnits, type Address } from "viem";
import { publicClient, useWallet } from "@/lib/wallet";
import { robinhood } from "@/lib/chain";
import { allocation } from "@/lib/v2Allocation";
import { distribute, driftBps, plannedTrade, restorePlan, skippedAtMinimumDeposit, groupedAllocation, type AllocationGroup } from "@/lib/curatorPlanner";

const abi = parseAbi([
  "function policy() view returns (address)", "function totalAssets() view returns (uint256)", "function configId(address) view returns (bytes32)", "function config(bytes32) view returns (address token,address oracle,bytes buy,bytes sell)", "function value(address,uint256) view returns (uint256)",
  "function owner() view returns (address)", "function constituents() view returns (address[])",
  "function targetBps(address) view returns (uint16)", "function cashTargetBps() view returns (uint16)",
  "function freeBalance(address) view returns (uint256)", "function weth() view returns (address)",
  "function setTargets(uint16 cashBps,uint16[] weights)",
  "function rebalance(address token,bool buy,uint256 amount,uint256 minOut,uint256 deadline)",
  "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "function creatorFeeBps() view returns(uint16)", "function protocolFeeBps() view returns(uint16)",
  "function reserved(address) view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function addConstituent(bytes32 id)", "function removeConstituent(address token)",
]);
type Row = { token: Address; symbol: string; decimals: number; balance: bigint; held: bigint; reserved: bigint; target: string; value?: bigint; nav?: bigint };
type PortfolioStep = { token: Address; symbol: string; buy: boolean; amount: bigint; decimals: number; minimum: bigint; estimatedValue: bigint; gas?: bigint };

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
  const [fees,setFees]=useState(0);
  const [loaded, setLoaded] = useState(false);
  const [minimumTrade, setMinimumTrade] = useState("0.0001");
  const [tab, setTab] = useState("Overview");
  const [groups,setGroups]=useState<AllocationGroup[]>([]);
  const [discovery,setDiscovery]=useState("10");
  const [locked, setLocked] = useState<boolean[]>([]);
  const [query, setQuery] = useState("");
  const [onlyDrift, setOnlyDrift] = useState(false);
  const [threshold, setThreshold] = useState(100);
  const [savedCash, setSavedCash] = useState("25");
  const [updated, setUpdated] = useState(0);
  const [preview, setPreview] = useState<{ key: string; at: number; fee: string }>();
  const [lastHash, setLastHash] = useState<`0x${string}`>();
  const [portfolioPlan, setPortfolioPlan] = useState<PortfolioStep[]>([]);
  const [portfolioStep, setPortfolioStep] = useState(0);
  const [planGasPrice, setPlanGasPrice] = useState(0n);
  const previewKey = [vault,address,chainId,selected,buy,amount,minimum,updated].join(":");
  const baseline = JSON.stringify([savedCash, rows.map(r => [r.token.toLowerCase(),r.target])]);
  const draftKey = `hoodx:curator:1:${robinhood.id}:${vault.toLowerCase()}:${address?.toLowerCase()}`;
  const dirty = cash !== savedCash || weights.some((w,i) => w !== rows[i]?.target);
  const portfolioContext = JSON.stringify([updated, threshold, minimumTrade, savedCash, rows.map(r=>[r.token,r.target])]);
  const [plannedContext, setPlannedContext] = useState("");
  const load = useCallback(async () => {
    const blockNumber = await publicClient.getBlockNumber();
    const [tokens, cashBps, weth, policy, nav,creatorFee,protocolFee] = await Promise.all([
      publicClient.readContract({ blockNumber, address: vault, abi, functionName: "constituents" }),
      publicClient.readContract({ blockNumber, address: vault, abi, functionName: "cashTargetBps" }),
      publicClient.readContract({ blockNumber, address: vault, abi, functionName: "weth" }),
      publicClient.readContract({ blockNumber, address: vault, abi, functionName: "policy" }),
      publicClient.readContract({ blockNumber, address: vault, abi, functionName: "totalAssets" }).catch(() => undefined),
      publicClient.readContract({blockNumber,address:vault,abi,functionName:"creatorFeeBps"}),
      publicClient.readContract({blockNumber,address:vault,abi,functionName:"protocolFeeBps"}),
    ]);
    const list = await Promise.all(tokens.map(async token => {
      const [symbol, decimals, balance, target, held, reserved] = await Promise.all([
        publicClient.readContract({ blockNumber, address: token, abi, functionName: "symbol" }),
        publicClient.readContract({ blockNumber, address: token, abi, functionName: "decimals" }),
        publicClient.readContract({ blockNumber, address: vault, abi, functionName: "freeBalance", args: [token] }),
        publicClient.readContract({ blockNumber, address: vault, abi, functionName: "targetBps", args: [token] }),
        publicClient.readContract({ blockNumber, address: token, abi, functionName: "balanceOf", args: [vault] }),
        publicClient.readContract({ blockNumber, address: vault, abi, functionName: "reserved", args: [token] }),
      ]);
      const value = await (async () => {
        const id = await publicClient.readContract({ blockNumber,address:vault,abi,functionName:"configId",args:[token]});
        const [,oracle] = await publicClient.readContract({ blockNumber,address:policy,abi,functionName:"config",args:[id]});
        return publicClient.readContract({ blockNumber,address:oracle,abi,functionName:"value",args:[token,balance]});
      })().catch(() => undefined);
      return { token, symbol, decimals, balance, held, reserved, value, nav, target: (target / 100).toFixed(2) };
    }));
    const balance = await publicClient.readContract({ blockNumber, address: vault, abi, functionName: "freeBalance", args: [weth] });
    return { list, balance, fees:creatorFee+protocolFee, cash: (cashBps / 100).toFixed(2) };
  }, [vault]);
  const apply = (data: Awaited<ReturnType<typeof load>>) => {
    setFees(data.fees); setRows(data.list); setGroups(data.list.map(r=>r.target==="0.00"?"Excluded":"Core")); setLocked([]); setWeights(data.list.map(r => r.target)); setCash(data.cash); setSavedCash(data.cash); setWethBalance(data.balance); setLoaded(true); setUpdated(Date.now()); setPreview(undefined);
  };
  useEffect(() => { let active = true; setLoaded(false); void load().then(data => { if (active) apply(data); }).catch(() => { if (active) setMessage("Unable to read curator data. Reload this page to retry."); }); return () => { active = false; }; }, [load]);
  useEffect(() => {
    if(!dirty) return;
    const warn=(event: BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  const row = rows.find(r => r.token === selected);
  const nav = rows[0]?.nav;
  const currentCash = nav && wethBalance !== undefined ? Number(wethBalance*10000n/nav)/100 : undefined;
  const reserveNeeded = nav===undefined?undefined:nav*BigInt(Math.round(Number(savedCash)*100))/10000n;
  const cashShortfall = reserveNeeded!==undefined&&wethBalance!==undefined&&wethBalance<reserveNeeded;
  const availableToBuy = reserveNeeded!==undefined&&wethBalance!==undefined&&wethBalance>reserveNeeded?wethBalance-reserveNeeded:0n;
  const missingPrices = rows.filter(r => r.value === undefined).length;
  const valuationUnavailable = !nav || missingPrices>0;
  const smallTargets = weights.flatMap((w,i)=>{try{return skippedAtMinimumDeposit(w,fees)?[rows[i].symbol]:[];}catch{return [];}});
  const drifted = rows.filter(r => Math.abs(driftBps(r.value,r.nav,r.target) ?? 0) >= threshold);
  let tradeFloor = 0n; try { tradeFloor = parseUnits(minimumTrade,18); } catch {}
  const suggestions = rows.map(r => ({r, trade:plannedTrade(r.balance,r.value,r.nav,r.target)})).filter(({r,trade}) => trade && trade.value >= tradeFloor && Math.abs(driftBps(r.value,r.nav,r.target) ?? 0) >= threshold).sort((a,b) => Number(a.trade!.buy)-Number(b.trade!.buy) || (a.trade!.value>b.trade!.value?-1:1));
  function stage(r: Row, isBuy: boolean, input: bigint) {
    setSelected(r.token); setBuy(isBuy); setAmount(formatUnits(input,isBuy?18:r.decimals)); setMinimum(""); setPreview(undefined); setTab("Trades");
    setMessage("Trade staged. Calculate its protected minimum, then preview before signing.");
  }
  async function refreshSnapshot() {
    if(busy)return;onBusy(true);
    try {const data=await load();const fresh=JSON.stringify([data.cash,data.list.map(r=>[r.token.toLowerCase(),r.target])]);
      if(dirty&&fresh===baseline){setRows(data.list);setFees(data.fees);setWethBalance(data.balance);setUpdated(Date.now());setPreview(undefined);setMessage("Snapshot refreshed. Your allocation draft was preserved.");}
      else if(dirty){setMessage("On-chain targets changed. Your draft is still here. Export it, then reset to on-chain before continuing.");}
      else {apply(data);setMessage("Snapshot refreshed.");}
    }catch{setMessage("Refresh failed. Your draft has not changed.");}finally{onBusy(false);}
  }
  function savePlan() { try { localStorage.setItem(draftKey,JSON.stringify({version:1,tokens:rows.map(r=>r.token),baseline,cash,weights,groups,locked:rows.map((_,i)=>!!locked[i]),discovery})); setMessage("Draft saved on this browser. No targets or holdings changed."); return true; } catch { setMessage("Browser storage is unavailable. Export the allocation instead."); return false; } }
  function loadPlan() { try { const raw=localStorage.getItem(draftKey); if(!raw) throw new Error("No draft saved for this wallet and vault."); const p=restorePlan(raw,rows.map(r=>r.token),baseline); setCash(p.cash);setWeights(p.weights);if(p.groups)setGroups(p.groups);if(p.locked)setLocked(p.locked);if(p.discovery)setDiscovery(p.discovery);setMessage("Draft restored. Review its changes before saving targets."); } catch(e) { setMessage((e as Error).message); } }
  function exportPlan() {
    const csv = [["Token address","Symbol","Saved target %","Draft target %"],...rows.map((r,i)=>[r.token,r.symbol,r.target,weights[i]]),["WETH","Cash reserve",savedCash,cash]].map(r=>r.map(v=>`"${String(v).replace(/^[=+@-]/,"'").replaceAll('"','""')}"`).join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download=`hoodx-allocation-${vault.slice(2,8)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function protectedMinimum() {
    if(!row || busy) return; onBusy(true); setPreview(undefined);
    try {
      const input=parseUnits(amount,buy?18:row.decimals);if(input<=0n) throw new Error("Enter a positive trade amount.");
      const policy=await publicClient.readContract({address:vault,abi,functionName:"policy"});
      const id=await publicClient.readContract({address:vault,abi,functionName:"configId",args:[row.token]});
      const [,oracle]=await publicClient.readContract({address:policy,abi,functionName:"config",args:[id]});
      const value=await publicClient.readContract({address:oracle,abi,functionName:"value",args:[row.token,buy?10n**18n:input]});
      if(value<=0n) throw new Error("A valid oracle price is unavailable.");
      const floor=(buy?input*10n**18n/value:value)*9700n/10000n;
      if(floor<=0n) throw new Error("Trade is too small to calculate a protected output.");
      setMinimum(formatUnits(floor,buy?row.decimals:18));setMessage("Contract-protected minimum filled from a fresh oracle read. Preview checks whether the route can meet it.");
    } catch(e) {setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message);}finally{onBusy(false);}
  }
  async function previewTrade() {
    if(!row || !address || busy) return;onBusy(true);setPreview(undefined);
    try {
      const args=[row.token,buy,parseUnits(amount,buy?18:row.decimals),parseUnits(minimum,buy?row.decimals:18),BigInt(Math.floor(Date.now()/1000)+600)] as const;
      if(args[2]<=0n || args[3]<=0n) throw new Error("Enter positive input and minimum output amounts.");
      await publicClient.simulateContract({address:vault,abi,account:address,functionName:"rebalance",args});
      const gas=await publicClient.estimateContractGas({address:vault,abi,account:address,functionName:"rebalance",args});
      const price=await publicClient.getGasPrice();setPreview({key:previewKey,at:Date.now(),fee:formatEther(gas*price)});setMessage("Simulation passed. Review the trade below. Nothing has been signed.");
    }catch(e){setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message);}finally{onBusy(false);}
  }
  async function protectedFloor(r: Row, isBuy: boolean, input: bigint) {
    const policy=await publicClient.readContract({address:vault,abi,functionName:"policy"});
    const id=await publicClient.readContract({address:vault,abi,functionName:"configId",args:[r.token]});
    const [,oracle]=await publicClient.readContract({address:policy,abi,functionName:"config",args:[id]});
    const value=await publicClient.readContract({address:oracle,abi,functionName:"value",args:[r.token,isBuy?10n**18n:input]});
    if(value<=0n) throw new Error(`${r.symbol} has no valid oracle price.`);
    const floor=(isBuy?input*10n**18n/value:value)*9700n/10000n;
    if(floor<=0n) throw new Error(`${r.symbol} is too small to quote safely.`);
    return floor;
  }
  async function buildPortfolioPlan() {
    if (!address || busy || dirty) { if (dirty) setMessage("Save the target allocation before building its trade plan."); return; }
    onBusy(true); setMessage(""); setPortfolioPlan([]); setPortfolioStep(0); setPlannedContext("");
    try {
      if (!suggestions.length) throw new Error("No priced positions exceed the selected drift and trade-size filters.");
      const gasPrice=await publicClient.getGasPrice();
      const deadline=BigInt(Math.floor(Date.now()/1000)+600);
      const next: PortfolioStep[]=[];
      for (const {r,trade} of suggestions) {
        const minimumOut=await protectedFloor(r,trade!.buy,trade!.amount);
        const args=[r.token,trade!.buy,trade!.amount,minimumOut,deadline] as const;
        const gas=await publicClient.estimateContractGas({address:vault,abi,account:address,functionName:"rebalance",args}).catch(()=>undefined);
        next.push({token:r.token,symbol:r.symbol,buy:trade!.buy,amount:trade!.amount,decimals:r.decimals,minimum:minimumOut,estimatedValue:trade!.value,gas});
      }
      setPlanGasPrice(gasPrice); setPortfolioPlan(next); setPlannedContext(portfolioContext);
      setMessage(`Portfolio plan ready · ${next.filter(s=>!s.buy).length} sells, ${next.filter(s=>s.buy).length} buys. Nothing has been signed.`);
    } catch(e) { setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message); }
    finally { onBusy(false); }
  }
  async function executePortfolioStep() {
    if (!walletClient || !address || busy || portfolioStep>=portfolioPlan.length) return;
    if (chainId!==robinhood.id) { await switchToRobinhood(); return; }
    if (plannedContext!==portfolioContext) { setMessage("The portfolio snapshot or filters changed. Rebuild the plan before signing."); return; }
    onBusy(true); setMessage("");
    try {
      const step=portfolioPlan[portfolioStep];
      const deadline=BigInt(Math.floor(Date.now()/1000)+600);
      const minimumOut=await protectedFloor(rows.find(r=>r.token===step.token)!,step.buy,step.amount);
      const args=[step.token,step.buy,step.amount,minimumOut,deadline] as const;
      const {request}=await publicClient.simulateContract({address:vault,abi,account:address,chain:robinhood,functionName:"rebalance",args});
      const hash=await walletClient.writeContract(request); setLastHash(hash);
      setMessage(`Step ${portfolioStep+1}/${portfolioPlan.length} submitted. Waiting for confirmation.`);
      const receipt=await publicClient.waitForTransactionReceipt({hash});
      if(receipt.status!=="success") throw new Error("Portfolio step reverted. Remaining steps were stopped.");
      const next=portfolioStep+1; setPortfolioStep(next);
      if(next===portfolioPlan.length){apply(await load());await onRefresh();setMessage("Portfolio rebalance complete. Holdings and targets refreshed.");}
      else setMessage(`Step ${next}/${portfolioPlan.length} confirmed. Review the next protected trade in your wallet.`);
    } catch(e) { setMessage(e instanceof BaseError?e.shortMessage:e instanceof Error?e.message:"Portfolio step failed."); }
    finally { onBusy(false); }
  }
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
        const [latestCash,...latestWeights]=await Promise.all([publicClient.readContract({address:vault,abi,functionName:"cashTargetBps"}),...fresh.map(token=>publicClient.readContract({address:vault,abi,functionName:"targetBps",args:[token]}))]);
        if((latestCash/100).toFixed(2)!==savedCash||latestWeights.some((w,i)=>(w/100).toFixed(2)!==rows[i].target))throw new Error("Saved targets changed since this snapshot. Refresh before overwriting them.");
        const draft = allocation(cash, weights);
        const { request } = await publicClient.simulateContract({ ...common, functionName: "setTargets", args: [draft.cashBps, draft.weights] });
        hash = await walletClient.writeContract(request);
      } else if (action === "trade") {
        if (!preview || preview.key !== previewKey || Date.now()-preview.at>60000) throw new Error("Preview this trade again. Quotes expire after one minute.");
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
      setLastHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted. Refresh before retrying.");
      const savedDraft=dirty&&action!=="targets"?savePlan():false;
      apply(await load()); await onRefresh(); setAmount(""); setMinimum(""); setMessage(savedDraft?"Confirmed. Your previous allocation draft was saved on this browser. Vault data refreshed.":"Confirmed. Vault balances and targets refreshed.");
    } catch (e) { setMessage(e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "Transaction failed."); }
    finally { onBusy(false); }
  }
  return <section id="curator" className="vault-actions holo">
    <div className="vault-section-heading"><div><p className="vault-eyebrow">CURATOR WORKSPACE</p><h2>Your conviction. In control.</h2></div><span className="vault-tag">Curator access</span></div>
    <p className="vault-footnote">A clear view of your basket. A considered next move. Plan freely; every on-chain change stays yours to review.</p>
    {!loaded ? <p>Loading curator tools…</p> : <>
      <nav className="curator-tabs" aria-label="Curator workspace sections">{["Overview","Allocation","Trades","Basket"].map(t=><button key={t} aria-current={tab===t?"page":undefined} onClick={()=>setTab(t)}>{t}{t==="Allocation"&&dirty&&<span aria-label="Unsaved changes"> •</span>}</button>)}</nav>
      <div className="curator-toolbar"><span>{updated ? `Snapshot ${new Date(updated).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : "Loading"} · Refresh before acting</span><button className="vault-button" disabled={busy} title="Refresh holdings and preserve a compatible allocation draft" onClick={()=>void refreshSnapshot()}>Refresh snapshot</button></div>
      {tab==="Overview"&&<div className="curator-overview">
        <div className="curator-metrics"><div><span>Vault value</span><strong>{nav===undefined?"—":`${Number(formatEther(nav)).toFixed(5)} ETH`}</strong><small>Oracle valuation</small></div><div><span>Cash reserve</span><strong>{currentCash===undefined?"—":`${currentCash.toFixed(2)}%`}</strong><small>{savedCash}% saved target</small></div><div><span>Outside drift band</span><strong>{drifted.length}<em> / {rows.length}</em></strong><small>{(threshold/100).toFixed(1)} percentage-point band</small></div><div><span>Basket capacity</span><strong>{rows.length}<em> / 24</em></strong><small>{rows.filter(r=>r.balance>0n).length} assets currently held</small></div></div>
        <div className="curator-callout"><div><p className="vault-eyebrow">YOUR NEXT MOVE</p><h3>{valuationUnavailable?"A complete valuation is unavailable.":dirty?"Your allocation draft is ready to shape.":cashShortfall?"Cash is below its saved target.":drifted.length?"Review where the basket has drifted.":"Your basket is within the selected drift band."}</h3><p>{valuationUnavailable?"A complete valuation is needed for drift and trade sizing. Refresh before planning trades.":dirty?"Saving targets changes future allocations. Holdings move only when you trade.":cashShortfall?"New buys must preserve the cash reserve. Review sales or your allocation before buying more.":"Use the band to focus your attention. It is a planning filter, not an automatic trading rule."}</p></div><button className="vault-button primary" onClick={()=>setTab(dirty?"Allocation":"Trades")}>{dirty?"Continue planning":"Review trades"} →</button></div>
        <div className="curator-guide"><article><b>01 · Shape it</b><p>Set your cash reserve, lock key weights and distribute the rest. Save a draft before committing.</p><button onClick={()=>setTab("Allocation")}>Plan allocation →</button></article><article><b>02 · Move it</b><p>Review the largest differences first. Sell excess holdings, then use available cash for buys.</p><button onClick={()=>setTab("Trades")}>Prepare trades →</button></article><article><b>03 · Evolve it</b><p>Check new assets for approved routes. Wind down an old position before removing it.</p><button onClick={()=>setTab("Basket")}>Manage assets →</button></article></div>
        <details className="curator-help"><summary>What can I safely do here?</summary><p>Drafts, filtering, exports and previews do not move funds. Saving targets, trading, adding and removing assets each require a wallet signature. Every trade is a separate transaction and is simulated again before signing. A successful preview cannot guarantee execution if prices change.</p><p>{paused?"The vault is paused: buys and additions are blocked; protected sales remain available.":"The vault is open. Purchases must preserve its cash reserve."} Tokens with shareholder claims cannot be removed.</p></details>
      </div>}
      <div hidden={tab!=="Allocation"} className="vault-recovery"><h3>Shape your allocation.</h3><p className="vault-footnote">Lock the weights you want to keep. Distribute the rest with exact rounding.</p>
        <label>Cash reserve (%)<input className="vault-input" inputMode="decimal" value={cash} disabled={busy} onChange={e => setCash(e.target.value)} /></label>
        <div className="vault-presets">{["20","25","35","50"].map(v=><button className="vault-button" key={v} disabled={busy} onClick={()=>setCash(v)}>{v}% cash</button>)}</div>
        <div className="vault-presets">{[false,true].map(equal=><button key={String(equal)} className="vault-button" disabled={busy} onClick={()=>{try{setWeights(distribute(cash,weights.map((w,i)=>groups[i]==="Excluded"?"0":w),rows.map((_,i)=>!!locked[i]||groups[i]==="Excluded"),equal));}catch(e){setMessage((e as Error).message);}}}>{equal?"Equal unlocked weights":"Normalize active weights"}</button>)}<button className="vault-button" disabled={busy} onClick={savePlan}>Save draft</button><button className="vault-button" disabled={busy} onClick={loadPlan}>Restore draft</button><button className="vault-button" disabled={busy} onClick={exportPlan}>Export CSV</button><button className="vault-button" disabled={busy} onClick={() => { onBusy(true); void load().then(apply).catch(() => setMessage("Unable to reload targets.")).finally(() => onBusy(false)); }}>Reset to on-chain</button></div>
        <details className="curator-help"><summary>Core + discovery preset</summary><p>Choose each asset’s group in the table. Core receives the remaining asset budget; Discovery shares the budget below. Excluded assets receive 0%. Locked weights are preserved. These are allocation tools, not investment recommendations.</p><label>Discovery (% of the whole vault)<input className="vault-target-input" aria-label="Discovery budget percent" value={discovery} disabled={busy} onChange={e=>setDiscovery(e.target.value)} /></label><button className="vault-button" disabled={busy} onClick={()=>{try{setWeights(groupedAllocation(cash,discovery,weights,locked,groups));}catch(e){setMessage((e as Error).message);}}}>Apply core + discovery</button></details>
        <div className="curator-toolbar"><input className="curator-search" aria-label="Filter allocation assets" placeholder="Find an asset…" value={query} onChange={e=>setQuery(e.target.value)} /><label><input type="checkbox" checked={onlyDrift} onChange={e=>setOnlyDrift(e.target.checked)} /> Outside drift band only</label></div>
        <div className="vault-table-scroll"><table className="vault-table curator-table"><thead><tr><th>Asset</th><th>Current / saved</th><th>Drift</th><th>Draft %</th><th>Group</th><th>Lock</th></tr></thead><tbody>{rows.map((r,i) => ({r,i})).filter(({r})=>(r.symbol.toLowerCase().includes(query.toLowerCase())||r.token.toLowerCase().includes(query.toLowerCase()))&&(!onlyDrift||Math.abs(driftBps(r.value,r.nav,r.target)??0)>=threshold)).map(({r,i}) => {const drift=driftBps(r.value,r.nav,r.target);return <tr key={r.token}><td><b>{r.symbol}</b><small title={formatUnits(r.balance,r.decimals)}>{Number(formatUnits(r.balance,r.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})} free</small></td><td>{r.value !== undefined && r.nav ? `${(Number(r.value * 10000n / r.nav)/100).toFixed(2)}%` : "—"}<small>Saved {r.target}%</small></td><td><span className={drift!==undefined&&Math.abs(drift)>=threshold?"curator-drift":""}>{drift===undefined?"No price":`${drift>0?"+":""}${(drift/100).toFixed(2)} pp`}</span></td><td><input className="vault-target-input" aria-label={`${r.symbol} target percent`} inputMode="decimal" value={weights[i] ?? ""} disabled={busy||locked[i]} onChange={e => setWeights(weights.map((w,j) => j===i ? e.target.value : w))} /></td><td><select className="curator-group" aria-label={`${r.symbol} allocation group`} value={groups[i]??"Core"} disabled={busy} onChange={e=>setGroups(rows.map((_,j)=>j===i?e.target.value as AllocationGroup:groups[j]))}>{["Core","Discovery","Excluded"].map(g=><option key={g}>{g}</option>)}</select></td><td><input type="checkbox" aria-label={`Lock ${r.symbol} weight`} checked={!!locked[i]} disabled={busy} onChange={e=>setLocked(rows.map((_,j)=>i===j?e.target.checked:!!locked[j]))} /></td></tr>})}</tbody></table></div>
        <div className="curator-allocation-total"><span>{dirty?"Unsaved allocation changes":"Matches saved targets"}</span><b>{valid?"100% allocated":validation}</b></div>
        {smallTargets.length>0&&<p className="vault-notice">Small-deposit coverage: {smallTargets.join(", ")} would each receive less than 0.0001 ETH from a 0.02 ETH deposit after current fees. Those allocations are skipped and remain in cash. Larger deposits may fill them.</p>}
        <p className="vault-footnote">{valid ? "Total: 100%. Ready to save." : validation} Cash must stay between 20% and 50%.</p>
        {dirty&&<details className="curator-help" open><summary>Changes to review</summary><p>Cash: {savedCash}% → {cash}%</p>{rows.map((r,i)=>weights[i]!==r.target&&<p key={r.token}>{r.symbol}: {r.target}% → {weights[i]||"—"}%</p>)}<p>Saving targets does not trade existing holdings.</p></details>}
        <button className="vault-button" disabled={busy || !valid || !dirty} onClick={() => void submit("targets")}>Review and save targets</button>
      </div>
      <div hidden={tab!=="Trades"} className="vault-recovery"><h3>Make each trade count.</h3>
        <div className="curator-toolbar"><label>Drift band <select value={threshold} onChange={e=>setThreshold(Number(e.target.value))}><option value={50}>0.5 pp</option><option value={100}>1 pp</option><option value={200}>2 pp</option><option value={500}>5 pp</option></select></label><label>Minimum trade value <select value={minimumTrade} onChange={e=>setMinimumTrade(e.target.value)}><option value="0">Show all</option><option value="0.0001">0.0001 ETH</option><option value="0.001">0.001 ETH</option><option value="0.005">0.005 ETH</option></select></label><span>{dirty?"Suggestions use saved targets, not your unsaved draft.":"Suggestions use saved targets. Sells appear first."}</span></div>
        <div className="curator-suggestions">{suggestions.length?suggestions.map(({r,trade})=><button key={r.token} disabled={busy || (trade!.buy&&paused)} onClick={()=>stage(r,trade!.buy,trade!.amount)}><span><b>{trade!.buy?"Buy":"Sell"} {r.symbol}</b><small>{Math.abs(driftBps(r.value,r.nav,r.target)??0)/100} pp {trade!.buy?"below":"above"} target</small></span><span>≈ {Number(formatEther(trade!.value)).toFixed(5)} ETH <small>Prepare →</small></span></button>):<p className="vault-footnote">No priced positions exceed this band. You can still prepare a trade below.</p>}</div>
        <div className="curator-review">
          <p className="vault-eyebrow">PORTFOLIO REBALANCE</p><h4>Review the whole move.</h4>
          <p>Build one ordered plan with overweight sales first and underweight buys second. Every step receives a fresh 3% protected minimum and is simulated again before signing.</p>
          <button className="vault-button primary" disabled={busy||dirty||!suggestions.length||(paused&&suggestions.some(s=>s.trade!.buy))} onClick={()=>void buildPortfolioPlan()}>{portfolioPlan.length?"Refresh portfolio plan":"Build portfolio plan"}</button>
          {portfolioPlan.length>0&&<div className="mt-3"><div className="vault-table-scroll"><table className="vault-table"><thead><tr><th>#</th><th>Action</th><th>Asset</th><th>Input</th><th>Protected minimum</th><th>Est. fee</th></tr></thead><tbody>{portfolioPlan.map((step,i)=><tr key={`${step.token}:${step.buy}`}><td>{i<portfolioStep?"✓":i+1}</td><td>{step.buy?"Buy":"Sell"}</td><td>{step.symbol}</td><td>{formatUnits(step.amount,step.buy?18:step.decimals)} {step.buy?"WETH":step.symbol}</td><td>{formatUnits(step.minimum,step.buy?step.decimals:18)} {step.buy?step.symbol:"WETH"}</td><td>{step.gas===undefined?"Recheck at execution":`${Number(formatEther(step.gas*planGasPrice)).toFixed(7)} ETH`}</td></tr>)}</tbody></table></div>
          <p className="vault-footnote">Estimated trade value {Number(formatEther(portfolioPlan.reduce((sum,step)=>sum+step.estimatedValue,0n))).toFixed(5)} ETH · Estimated network total {Number(formatEther(portfolioPlan.reduce((sum,step)=>sum+(step.gas||0n),0n)*planGasPrice)).toFixed(7)} ETH. Resulting target mix: {rows.map(r=>`${r.symbol} ${r.target}%`).join(" · ")} · WETH {savedCash}%.</p>
          <button className="vault-button primary" disabled={busy||portfolioStep>=portfolioPlan.length} onClick={()=>void executePortfolioStep()}>{portfolioStep>=portfolioPlan.length?"Rebalance complete":`Approve step ${portfolioStep+1} of ${portfolioPlan.length}`}</button>
          <p className="vault-footnote">The live V2 vault requires one wallet approval per protected trade. HOODX stops immediately if any refreshed simulation fails.</p></div>}
        </div>
        <p className="vault-footnote">Planning estimates exclude fees and price impact. Small trades may not justify gas. Preview each trade; refresh after every confirmation.</p><p>Vault cash: {wethBalance === undefined ? "—" : formatEther(wethBalance)} WETH. Estimated room for buys above the saved reserve: {formatEther(availableToBuy)} WETH. Buys must preserve the target cash reserve. Sales and buys retain the contract’s oracle and minimum-output protections.</p>
        <label>Asset<select className="vault-input" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setAmount(""); setMinimum(""); }}><option value="">Choose an asset</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}</option>)}</select></label>
        <div className="vault-presets">{[false,true].map(value => <button className="vault-button" aria-pressed={buy===value} key={String(value)} disabled={busy} onClick={() => { setBuy(value); setAmount(""); setMinimum(""); }}>{value ? "Buy with vault WETH" : "Sell into vault WETH"}</button>)}</div>
        <label>Amount ({buy ? "WETH" : row?.symbol ?? "tokens"})<input className="vault-input" value={amount} disabled={busy} inputMode="decimal" onChange={e => setAmount(e.target.value)} /></label>
        {row && !buy && <div className="vault-presets">{[25,50,75].map(p=><button className="vault-button" key={p} disabled={busy} onClick={()=>{setAmount(formatUnits(row.balance*BigInt(p)/100n,row.decimals));setMinimum("");}}>{p}%</button>)}</div>}
        {row && !buy && <button className="vault-button" disabled={busy} onClick={() => {setAmount(formatUnits(row.balance,row.decimals));setMinimum("");}}>Max available {row.symbol}</button>}
        <label>Minimum output ({buy ? row?.symbol ?? "tokens" : "WETH"})<input className="vault-input" value={minimum} disabled={busy} inputMode="decimal" onChange={e => setMinimum(e.target.value)} /></label>
        <div className="vault-presets"><button className="vault-button" disabled={busy||!row||!amount} onClick={()=>void protectedMinimum()}>Fill protected minimum</button><button className="vault-button primary" disabled={busy || !row || !amount || !minimum || (buy && paused)} onClick={() => void previewTrade()}>Preview trade</button></div>
        {preview?.key===previewKey&&<div className="curator-review"><p className="vault-eyebrow">SIMULATION PASSED · VALID FOR ONE MINUTE</p><h4>{buy?"Buy":"Sell"} {row?.symbol}</h4><p>Spend <b>{amount} {buy?"WETH":row?.symbol}</b> · Receive at least <b>{minimum} {buy?row?.symbol:"WETH"}</b></p><p>Estimated network fee: {Number(preview.fee).toFixed(8)} ETH. Your wallet shows the final fee. All proceeds remain in the vault.</p><button className="vault-button primary" disabled={busy} onClick={()=>void submit("trade")}>Review in wallet</button></div>}
      </div>
      <div hidden={tab!=="Basket"} className="vault-recovery"><h3>Build a basket worth following.</h3><p className="vault-footnote">{24-rows.length} spaces available. An approved route is required for every new asset.</p>
        <p>Configured tokens remain in the curator planner even when their balance is zero. Adding a token does not buy it automatically.</p>
        <div className="vault-trade-grid"><div><h4>Add token</h4><label>Token contract address<input className="vault-input" aria-label="New token address" value={tokenAddress} disabled={busy} onChange={e => {setTokenAddress(e.target.value);setConfig("");}} placeholder="0x…" /></label><button className="vault-button" disabled={busy || !tokenAddress} onClick={() => void findApprovedToken()}>Find approved route</button><p>{config ? "Approved route ready for review." : "Paste a token address to check its approved V2 route."}</p><button className="vault-button" disabled={busy || paused || !config || rows.length >= 24} onClick={() => void submit("add")}>Review adding token</button>{paused && <p>Resume deposits before adding tokens.</p>}</div>
        <div><h4>Remove token</h4><label>Configured token<select className="vault-input" aria-label="Token to remove" value={removeToken} disabled={busy} onChange={e => setRemoveToken(e.target.value)}><option value="">Choose a token</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}{r.held === 0n ? " — no holdings" : ""}</option>)}</select></label><p>{removalReason}</p>{removal&&<ol className="curator-checklist"><li>{removal.target==="0.00"?"✓":"1."} Save a 0% target <button disabled={busy} onClick={()=>{setWeights(weights.map((w,i)=>rows[i].token===removal.token?"0.00":w));setTab("Allocation");setMessage("Target set to zero in your draft. Normalize the remaining active weights, then save targets.");}}>Stage 0% target</button></li><li>{removal.held===0n?"✓":"2."} Sell remaining holdings {removal.balance>0n&&<button disabled={busy} onClick={()=>stage(removal,false,removal.balance)}>Prepare full sale</button>}</li><li>{removal.reserved===0n?"✓":"3."} Clear any reserved shareholder claims</li><li>Remove the empty asset</li></ol>}<button className="vault-button" disabled={busy || !canRemove} onClick={() => void submit("remove")}>Review removing token</button></div></div>
      </div>
    </>}
    {lastHash&&<a className="curator-receipt" href={`https://robin.etherscan.io/tx/${lastHash}`} target="_blank" rel="noreferrer">View last submitted transaction ↗</a>}
    <p role="status" aria-live="polite" className={message ? "vault-notice" : ""}>{message}</p>
  </section>;
}
