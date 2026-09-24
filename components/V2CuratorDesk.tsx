"use client";

import { useCallback, useEffect, useState } from "react";
import { BaseError, encodeAbiParameters, formatEther, formatUnits, keccak256, parseAbi, parseAbiItem, parseUnits, type Address, type Hex } from "viem";
import { publicClient, useWallet } from "@/lib/wallet";
import { robinhood } from "@/lib/chain";
import { allocation } from "@/lib/v2Allocation";
import { capBuyPlan, distribute, driftBps, plannedTrade, raiseCashFromLeaders, restorePlan, skippedAtMinimumDeposit, groupedAllocation, type AllocationGroup } from "@/lib/curatorPlanner";
import { rebalanceControllerAbi } from "@/lib/rebalanceController";

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
type AtomicPlaybook = "restore" | "raise-cash" | "deploy-cash" | "custom";

export function V2CuratorDesk({ vault, controller, paused, busy, onBusy, onRefresh }: { vault: Address; controller?: Address; paused: boolean; busy: boolean; onBusy: (value: boolean) => void; onRefresh: () => Promise<void> }) {
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
  const [atomicGas, setAtomicGas] = useState<bigint>();
  const [plannedAllocation, setPlannedAllocation] = useState<{ cashBps: number; weights: number[]; basketHash: Hex; minCashAfter: bigint }>();
  const [playbook,setPlaybook]=useState<AtomicPlaybook>("restore");
  const previewKey = [vault,address,chainId,selected,buy,amount,minimum,updated].join(":");
  const baseline = JSON.stringify([savedCash, rows.map(r => [r.token.toLowerCase(),r.target])]);
  const draftKey = `hoodx:curator:1:${robinhood.id}:${vault.toLowerCase()}:${address?.toLowerCase()}`;
  const dirty = cash !== savedCash || weights.some((w,i) => w !== rows[i]?.target);
  const portfolioContext = JSON.stringify([updated, threshold, minimumTrade, cash, weights, rows.map(r=>r.token),playbook]);
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
    setFees(data.fees); setRows(data.list); setGroups(data.list.map(r=>r.target==="0.00"?"Excluded":"Core")); setLocked([]); setWeights(data.list.map(r => r.target)); setCash(data.cash); setSavedCash(data.cash); setWethBalance(data.balance); setPlaybook("restore"); setLoaded(true); setUpdated(Date.now()); setPreview(undefined);
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
  const availableToBuy = reserveNeeded!==undefined&&wethBalance!==undefined&&wethBalance>reserveNeeded?wethBalance-reserveNeeded:0n;
  const missingPrices = rows.filter(r => r.value === undefined).length;
  const valuationUnavailable = !nav || missingPrices>0;
  const smallTargets = weights.flatMap((w,i)=>{try{return skippedAtMinimumDeposit(w,fees)?[rows[i].symbol]:[];}catch{return [];}});
  const drifted = rows.filter(r => Math.abs(driftBps(r.value,r.nav,r.target) ?? 0) >= threshold);
  let tradeFloor = 0n; try { tradeFloor = parseUnits(minimumTrade,18); } catch {}
  const draftSuggestions = rows.map((r,i) => {
    const planned = {...r, target: weights[i] ?? r.target};
    return {r:planned, trade:plannedTrade(planned.balance,planned.value,planned.nav,planned.target)};
  }).filter(({r,trade}) => trade && trade.value >= tradeFloor && Math.abs(driftBps(r.value,r.nav,r.target) ?? 0) >= threshold).sort((a,b) => Number(a.trade!.buy)-Number(b.trade!.buy) || (a.trade!.value>b.trade!.value?-1:1));
  const filteredSuggestions = draftSuggestions.filter(({trade})=>playbook==="raise-cash"?!trade!.buy:playbook==="deploy-cash"?trade!.buy:true);
  const portfolioSuggestions = playbook==="deploy-cash"
    ? capBuyPlan(filteredSuggestions.map(item=>({...item,amount:item.trade!.amount,value:item.trade!.value})),availableToBuy*98n/100n).map(item=>({...item,trade:{...item.trade!,amount:item.amount,value:item.value}}))
    : filteredSuggestions;
  const playbookCopy:Record<AtomicPlaybook,{eyebrow:string;title:string;body:string}>={
    restore:{eyebrow:"RESTORE TARGETS",title:"Bring the basket back into shape.",body:"Sell leaders first, then refill lagging sleeves while preserving the saved WETH reserve."},
    "raise-cash":{eyebrow:"RAISE CASH",title:"Trim leaders into reserve.",body:"Only assets above their saved target are sold. Relative leadership is not a cost-basis profit claim."},
    "deploy-cash":{eyebrow:"DEPLOY RESERVE",title:"Put excess WETH back to work.",body:"Buy underweight assets using up to 98% of cash above the saved reserve. No assets are sold."},
    custom:{eyebrow:"CUSTOM PLAN",title:"Move to your reviewed allocation.",body:"The atomic plan follows your draft targets, with sells ordered before buys and the final reserve enforced."},
  };
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
  function loadPlan() { try { const raw=localStorage.getItem(draftKey); if(!raw) throw new Error("No draft saved for this wallet and vault."); const p=restorePlan(raw,rows.map(r=>r.token),baseline); setCash(p.cash);setWeights(p.weights);setPlaybook("custom");if(p.groups)setGroups(p.groups);if(p.locked)setLocked(p.locked);if(p.discovery)setDiscovery(p.discovery);setMessage("Draft restored. Review its changes before saving targets."); } catch(e) { setMessage((e as Error).message); } }
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
      const target=controller??vault, targetAbi=controller?rebalanceControllerAbi:abi;
      await publicClient.simulateContract({address:target,abi:targetAbi,account:address,functionName:"rebalance",args});
      const gas=await publicClient.estimateContractGas({address:target,abi:targetAbi,account:address,functionName:"rebalance",args});
      const price=await publicClient.getGasPrice();setPreview({key:previewKey,at:Date.now(),fee:formatEther(gas*price)});setMessage("Simulation passed. Review the trade below. Nothing has been signed.");
    }catch(e){setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message);}finally{onBusy(false);}
  }
  function chooseRestore(){setCash(savedCash);setWeights(rows.map(r=>r.target));setPlaybook("restore");setPortfolioPlan([]);setTab("Trades");setMessage("Restore-targets playbook selected. Review the drift and build one atomic plan.");}
  function chooseDeploy(){
    if(valuationUnavailable){setMessage("A complete valuation is required before excess cash can be deployed.");return;}
    if(availableToBuy<=0n){setMessage("There is no WETH above the saved reserve to deploy.");return;}
    setCash(savedCash);setWeights(rows.map(r=>r.target));setPlaybook("deploy-cash");setPortfolioPlan([]);setTab("Trades");setMessage("Deploy-reserve playbook selected. HOODX will leave a 2% buffer in the available excess cash.");
  }
  function chooseRaise(increase:string){
    if(valuationUnavailable||!nav){setMessage("A complete valuation is required before leaders can be identified.");return;}
    try{
      const current=rows.map(r=>r.value===undefined?undefined:Number(r.value*10000n/nav));
      const next=raiseCashFromLeaders(savedCash,rows.map(r=>r.target),current,increase);
      setCash(next.cash);setWeights(next.weights);setPlaybook("raise-cash");setPortfolioPlan([]);setTab("Trades");
      setMessage(`Raise-cash playbook selected. ${next.leaders.length} relative leader${next.leaders.length===1?"":"s"} fund a ${increase}% larger reserve target.`);
    }catch(e){setMessage((e as Error).message);}
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
    if (!address || busy) return;
    if (dirty && !controller) { setMessage("Save the target allocation before building its trade plan."); return; }
    onBusy(true); setMessage(""); setPortfolioPlan([]); setPortfolioStep(0); setPlannedContext(""); setAtomicGas(undefined); setPlannedAllocation(undefined);
    try {
      if (!portfolioSuggestions.length) throw new Error("No priced positions exceed the selected drift and trade-size filters.");
      if (!nav) throw new Error("A complete vault valuation is required to protect the final cash reserve.");
      const draft=allocation(cash,weights);
      const gasPrice=await publicClient.getGasPrice();
      const deadline=BigInt(Math.floor(Date.now()/1000)+600);
      const next: PortfolioStep[]=[];
      for (const {r,trade} of portfolioSuggestions) {
        const minimumOut=await protectedFloor(r,trade!.buy,trade!.amount);
        const args=[r.token,trade!.buy,trade!.amount,minimumOut,deadline] as const;
        const gas=controller?undefined:await publicClient.estimateContractGas({address:vault,abi,account:address,functionName:"rebalance",args}).catch(()=>undefined);
        next.push({token:r.token,symbol:r.symbol,buy:trade!.buy,amount:trade!.amount,decimals:r.decimals,minimum:minimumOut,estimatedValue:trade!.value,gas});
      }
      const basketHash=keccak256(encodeAbiParameters([{type:"address[]"}],[rows.map(r=>r.token)]));
      const minCashAfter=nav*BigInt(draft.cashBps)/10000n;
      if(controller){
        const steps=next.map(s=>({token:s.token,buy:s.buy,amount:s.amount,minOut:s.minimum}));
        const gas=await publicClient.estimateContractGas({address:controller,abi:rebalanceControllerAbi,account:address,functionName:"atomicRebalance",args:[draft.cashBps,draft.weights,steps,basketHash,minCashAfter,deadline]});
        setAtomicGas(gas);
      }
      setPlanGasPrice(gasPrice); setPortfolioPlan(next); setPlannedContext(portfolioContext);
      setPlannedAllocation({cashBps:draft.cashBps,weights:draft.weights,basketHash,minCashAfter});
      setMessage(`Portfolio plan ready · ${next.filter(s=>!s.buy).length} sells, ${next.filter(s=>s.buy).length} buys${controller?" · one atomic wallet approval":""}. Nothing has been signed.`);
    } catch(e) { setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message); }
    finally { onBusy(false); }
  }
  async function executePortfolioStep() {
    if (!walletClient || !address || busy || portfolioStep>=portfolioPlan.length || !plannedAllocation) return;
    if (chainId!==robinhood.id) { await switchToRobinhood(); return; }
    if (plannedContext!==portfolioContext) { setMessage("The portfolio snapshot or filters changed. Rebuild the plan before signing."); return; }
    onBusy(true); setMessage("");
    try {
      if(controller){
        const fresh=await publicClient.readContract({address:vault,abi,functionName:"constituents"});
        const freshHash=keccak256(encodeAbiParameters([{type:"address[]"}],[fresh]));
        if(freshHash!==plannedAllocation.basketHash) throw new Error("The basket changed. Refresh and rebuild the atomic plan.");
        const deadline=BigInt(Math.floor(Date.now()/1000)+600);
        const steps=[] as {token:Address;buy:boolean;amount:bigint;minOut:bigint}[];
        for(const step of portfolioPlan){
          const minimumOut=await protectedFloor(rows.find(r=>r.token===step.token)!,step.buy,step.amount);
          steps.push({token:step.token,buy:step.buy,amount:step.amount,minOut:minimumOut});
        }
        const args=[plannedAllocation.cashBps,plannedAllocation.weights,steps,plannedAllocation.basketHash,plannedAllocation.minCashAfter,deadline] as const;
        const {request}=await publicClient.simulateContract({address:controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"atomicRebalance",args});
        const hash=await walletClient.writeContract(request);setLastHash(hash);setMessage("Atomic rebalance submitted. Waiting for confirmation.");
        const receipt=await publicClient.waitForTransactionReceipt({hash});
        if(receipt.status!=="success")throw new Error("Atomic rebalance reverted. No targets or trades were changed.");
        setPortfolioStep(portfolioPlan.length);apply(await load());await onRefresh();setMessage("Atomic portfolio rebalance complete. Every target and trade settled in one transaction.");
        return;
      }
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
      if(controller){
        const activeCurator=await publicClient.readContract({address:controller,abi:rebalanceControllerAbi,functionName:"curator"});
        if(owner.toLowerCase()!==controller.toLowerCase()||activeCurator.toLowerCase()!==address.toLowerCase())throw new Error("Only the active controller curator can manage this vault.");
      }else if (owner.toLowerCase() !== address.toLowerCase()) throw new Error("Only the current curator can manage this vault.");
      let hash: `0x${string}`;
      if (action === "targets") {
        const fresh = await publicClient.readContract({ address: vault, abi, functionName: "constituents" });
        if (fresh.length !== rows.length || fresh.some((t, i) => t.toLowerCase() !== rows[i].token.toLowerCase())) throw new Error("The basket changed. Reload before setting targets.");
        const [latestCash,...latestWeights]=await Promise.all([publicClient.readContract({address:vault,abi,functionName:"cashTargetBps"}),...fresh.map(token=>publicClient.readContract({address:vault,abi,functionName:"targetBps",args:[token]}))]);
        if((latestCash/100).toFixed(2)!==savedCash||latestWeights.some((w,i)=>(w/100).toFixed(2)!==rows[i].target))throw new Error("Saved targets changed since this snapshot. Refresh before overwriting them.");
        const draft = allocation(cash, weights);
        const { request } = controller
          ? await publicClient.simulateContract({address:controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"setTargets",args:[draft.cashBps,draft.weights]})
          : await publicClient.simulateContract({address:vault,abi,account:address,chain:robinhood,functionName:"setTargets",args:[draft.cashBps,draft.weights]});
        hash = await walletClient.writeContract(request);
      } else if (action === "trade") {
        if (!preview || preview.key !== previewKey || Date.now()-preview.at>60000) throw new Error("Preview this trade again. Quotes expire after one minute.");
        if (!row) throw new Error("Choose an asset.");
        const input = parseUnits(amount, buy ? 18 : row.decimals), floor = parseUnits(minimum, buy ? row.decimals : 18);
        if (input <= 0n || floor <= 0n) throw new Error("Amount and minimum output must be positive.");
        if (buy && paused) throw new Error("Resume deposits before buying assets.");
        const tradeArgs=[row.token,buy,input,floor,BigInt(Math.floor(Date.now()/1000)+600)] as const;
        const { request } = controller
          ? await publicClient.simulateContract({address:controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"rebalance",args:tradeArgs})
          : await publicClient.simulateContract({address:vault,abi,account:address,chain:robinhood,functionName:"rebalance",args:tradeArgs});
        hash = await walletClient.writeContract(request);
      } else if (action === "add") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(config)) throw new Error("Enter an approved route configuration ID.");
        const id=config as `0x${string}`;
        const { request } = controller
          ? await publicClient.simulateContract({address:controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"addConstituent",args:[id]})
          : await publicClient.simulateContract({address:vault,abi,account:address,chain:robinhood,functionName:"addConstituent",args:[id]});
        hash = await walletClient.writeContract(request);
      } else {
        if (!removal || !canRemove) throw new Error(removalReason);
        const { request } = controller
          ? await publicClient.simulateContract({address:controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"removeConstituent",args:[removal.token]})
          : await publicClient.simulateContract({address:vault,abi,account:address,chain:robinhood,functionName:"removeConstituent",args:[removal.token]});
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
      <nav className="curator-tabs" aria-label="Curator workspace sections">{["Overview","Allocation","Trades","Basket"].map(t=><button key={t} aria-current={tab===t?"page":undefined} onClick={()=>setTab(t)}>{t==="Trades"?"Atomic rebalance":t}{t==="Allocation"&&dirty&&<span aria-label="Unsaved changes"> •</span>}</button>)}</nav>
      <div className="curator-toolbar"><span>{updated ? `Snapshot ${new Date(updated).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : "Loading"} · Refresh before acting</span><button className="vault-button" disabled={busy} title="Refresh holdings and preserve a compatible allocation draft" onClick={()=>void refreshSnapshot()}>Refresh snapshot</button></div>
      {tab==="Overview"&&<div className="curator-overview">
        <div className="curator-metrics"><div><span>Vault value</span><strong>{nav===undefined?"—":`${Number(formatEther(nav)).toFixed(5)} ETH`}</strong><small>Oracle valuation</small></div><div><span>Cash reserve</span><strong>{currentCash===undefined?"—":`${currentCash.toFixed(2)}%`}</strong><small>{savedCash}% saved target</small></div><div><span>Actionable drift</span><strong>{drifted.length}<em> / {rows.length}</em></strong><small>{(threshold/100).toFixed(1)} percentage-point band</small></div><div><span>Atomic control</span><strong>{controller?"Live":"Off"}</strong><small>{controller?"One signature · all or nothing":"Controller required"}</small></div></div>
        <div className="curator-command"><div className="curator-command-copy"><p className="vault-eyebrow">ATOMIC COMMAND</p><h3>One decision. One signature.</h3><p>Choose the outcome. HOODX orders sales before purchases, refreshes every protected minimum and enforces the final WETH floor. If one leg fails, nothing changes.</p><div className="curator-command-badges"><span>{controller?"● Controller live":"Controller unavailable"}</span><span>3% protected floors</span><span>10-minute plan</span></div></div><div className="curator-orbit" aria-hidden="true"><span className="curator-orbit-core">HOODX</span><i/><i/><i/><b>SELL</b><b>CASH</b><b>BUY</b></div></div>
        <div className="curator-strategy-heading"><div><p className="vault-eyebrow">ATOMIC PLAYBOOKS</p><h3>Choose the outcome.</h3></div><p>Three clear moves cover the work curators repeat most. You still review every route, minimum and fee before signing.</p></div>
        <div className="curator-strategies">
          <article><div className="curator-strategy-mark restore" aria-hidden="true"><i/><i/><i/></div><span>01 · DISCIPLINE</span><h4>Restore targets</h4><p>Trim overweight sleeves and refill underweights. Best when drift crosses your chosen band.</p><button disabled={busy||valuationUnavailable||!controller} onClick={chooseRestore}>Review restore →</button></article>
          <article className="featured"><div className="curator-strategy-mark harvest" aria-hidden="true"><i/><i/><i/></div><span>02 · TAKE PROFIT</span><h4>Raise cash</h4><p>Sell current leaders into WETH and lift the reserve. “Leader” means above target, not cost-basis profit.</p><div className="curator-strategy-actions"><button disabled={busy||valuationUnavailable||!controller} onClick={()=>chooseRaise("5")}>+5% cash</button><button disabled={busy||valuationUnavailable||!controller} onClick={()=>chooseRaise("10")}>+10%</button></div></article>
          <article><div className="curator-strategy-mark deploy" aria-hidden="true"><i/><i/><i/></div><span>03 · OPPORTUNITY</span><h4>Deploy reserve</h4><p>Use excess WETH to refill underweight sleeves. Keeps a small execution buffer and sells nothing.</p><button disabled={busy||valuationUnavailable||availableToBuy<=0n||paused||!controller} onClick={chooseDeploy}>Review deployment →</button></article>
        </div>
        <details className="curator-help"><summary>What can I safely do here?</summary><p>Drafts, filtering, exports and previews do not move funds. {controller?"The atomic controller saves the reviewed targets and executes every protected trade with one wallet signature; any failed leg reverts the entire plan.":"Saving targets, trading, adding and removing assets each require a wallet signature. Every trade is a separate transaction until this vault adopts the atomic controller."} A successful preview cannot guarantee execution if prices change.</p><p>{paused?"The vault is paused: buys and additions are blocked; protected sales remain available.":"The vault is open. Purchases must preserve its cash reserve."} Tokens with shareholder claims cannot be removed.</p></details>
      </div>}
      <div hidden={tab!=="Allocation"} className="vault-recovery"><h3>Shape your allocation.</h3><p className="vault-footnote">Lock the weights you want to keep. Distribute the rest with exact rounding.</p>
        <label>Cash reserve (%)<input className="vault-input" inputMode="decimal" value={cash} disabled={busy} onChange={e => {setCash(e.target.value);setPlaybook("custom");}} /></label>
        <div className="vault-presets">{["20","25","35","50"].map(v=><button className="vault-button" key={v} disabled={busy} onClick={()=>{setCash(v);setPlaybook("custom");}}>{v}% cash</button>)}</div>
        <div className="vault-presets">{[false,true].map(equal=><button key={String(equal)} className="vault-button" disabled={busy} onClick={()=>{try{setWeights(distribute(cash,weights.map((w,i)=>groups[i]==="Excluded"?"0":w),rows.map((_,i)=>!!locked[i]||groups[i]==="Excluded"),equal));setPlaybook("custom");}catch(e){setMessage((e as Error).message);}}}>{equal?"Equal unlocked weights":"Normalize active weights"}</button>)}<button className="vault-button" disabled={busy} onClick={savePlan}>Save draft</button><button className="vault-button" disabled={busy} onClick={loadPlan}>Restore draft</button><button className="vault-button" disabled={busy} onClick={exportPlan}>Export CSV</button><button className="vault-button" disabled={busy} onClick={() => { onBusy(true); void load().then(apply).catch(() => setMessage("Unable to reload targets.")).finally(() => onBusy(false)); }}>Reset to on-chain</button></div>
        <details className="curator-help"><summary>Core + discovery preset</summary><p>Choose each asset’s group in the table. Core receives the remaining asset budget; Discovery shares the budget below. Excluded assets receive 0%. Locked weights are preserved. These are allocation tools, not investment recommendations.</p><label>Discovery (% of the whole vault)<input className="vault-target-input" aria-label="Discovery budget percent" value={discovery} disabled={busy} onChange={e=>setDiscovery(e.target.value)} /></label><button className="vault-button" disabled={busy} onClick={()=>{try{setWeights(groupedAllocation(cash,discovery,weights,locked,groups));setPlaybook("custom");}catch(e){setMessage((e as Error).message);}}}>Apply core + discovery</button></details>
        <div className="curator-toolbar"><input className="curator-search" aria-label="Filter allocation assets" placeholder="Find an asset…" value={query} onChange={e=>setQuery(e.target.value)} /><label><input type="checkbox" checked={onlyDrift} onChange={e=>setOnlyDrift(e.target.checked)} /> Outside drift band only</label></div>
        <div className="vault-table-scroll"><table className="vault-table curator-table"><thead><tr><th>Asset</th><th>Current / saved</th><th>Drift</th><th>Draft %</th><th>Group</th><th>Lock</th></tr></thead><tbody>{rows.map((r,i) => ({r,i})).filter(({r})=>(r.symbol.toLowerCase().includes(query.toLowerCase())||r.token.toLowerCase().includes(query.toLowerCase()))&&(!onlyDrift||Math.abs(driftBps(r.value,r.nav,r.target)??0)>=threshold)).map(({r,i}) => {const drift=driftBps(r.value,r.nav,r.target);return <tr key={r.token}><td><b>{r.symbol}</b><small title={formatUnits(r.balance,r.decimals)}>{Number(formatUnits(r.balance,r.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})} free</small></td><td>{r.value !== undefined && r.nav ? `${(Number(r.value * 10000n / r.nav)/100).toFixed(2)}%` : "—"}<small>Saved {r.target}%</small></td><td><span className={drift!==undefined&&Math.abs(drift)>=threshold?"curator-drift":""}>{drift===undefined?"No price":`${drift>0?"+":""}${(drift/100).toFixed(2)} pp`}</span></td><td><input className="vault-target-input" aria-label={`${r.symbol} target percent`} inputMode="decimal" value={weights[i] ?? ""} disabled={busy||locked[i]} onChange={e => {setWeights(weights.map((w,j) => j===i ? e.target.value : w));setPlaybook("custom");}} /></td><td><select className="curator-group" aria-label={`${r.symbol} allocation group`} value={groups[i]??"Core"} disabled={busy} onChange={e=>{setGroups(rows.map((_,j)=>j===i?e.target.value as AllocationGroup:groups[j]));setPlaybook("custom");}}>{["Core","Discovery","Excluded"].map(g=><option key={g}>{g}</option>)}</select></td><td><input type="checkbox" aria-label={`Lock ${r.symbol} weight`} checked={!!locked[i]} disabled={busy} onChange={e=>setLocked(rows.map((_,j)=>i===j?e.target.checked:!!locked[j]))} /></td></tr>})}</tbody></table></div>
        <div className="curator-allocation-total"><span>{dirty?"Unsaved allocation changes":"Matches saved targets"}</span><b>{valid?"100% allocated":validation}</b></div>
        {smallTargets.length>0&&<p className="vault-notice">Small-deposit coverage: {smallTargets.join(", ")} would each receive less than 0.0001 ETH from a 0.02 ETH deposit after current fees. Those allocations are skipped and remain in cash. Larger deposits may fill them.</p>}
        <p className="vault-footnote">{valid ? "Total: 100%. Ready to save." : validation} Cash must stay between 20% and 50%.</p>
        {dirty&&<details className="curator-help" open><summary>Changes to review</summary><p>Cash: {savedCash}% → {cash}%</p>{rows.map((r,i)=>weights[i]!==r.target&&<p key={r.token}>{r.symbol}: {r.target}% → {weights[i]||"—"}%</p>)}<p>Saving targets does not trade existing holdings.</p></details>}
        <button className="vault-button" disabled={busy || !valid || !dirty} onClick={() => void submit("targets")}>Review and save targets</button>
      </div>
      <div hidden={tab!=="Trades"} className="vault-recovery curator-atomic-desk">
        <div className="curator-atomic-heading"><div><p className="vault-eyebrow">ONE-SIGNATURE REBALANCE</p><h3>Atomic desk.</h3></div><span className={`curator-live ${controller?"":"off"}`}>{controller?"● Live controller":"Controller required"}</span></div>
        <div className="curator-playbook-switch" aria-label="Atomic playbook"><button aria-pressed={playbook==="restore"} onClick={chooseRestore}>Restore</button><button aria-pressed={playbook==="raise-cash"} onClick={()=>chooseRaise("5")}>Raise cash</button><button aria-pressed={playbook==="deploy-cash"} onClick={chooseDeploy}>Deploy reserve</button><button aria-pressed={playbook==="custom"} onClick={()=>{setPlaybook("custom");setTab("Allocation");}}>Custom</button></div>
        <div className="curator-active-playbook"><div><p className="vault-eyebrow">{playbookCopy[playbook].eyebrow}</p><h4>{playbookCopy[playbook].title}</h4><p>{playbookCopy[playbook].body}</p></div><div className="curator-active-stats"><span><b>{portfolioSuggestions.filter(s=>!s.trade!.buy).length}</b> sells</span><span><b>{portfolioSuggestions.filter(s=>s.trade!.buy).length}</b> buys</span><span><b>{cash}%</b> final cash</span></div></div>
        <div className="curator-toolbar"><label>Act when drift reaches <select value={threshold} onChange={e=>setThreshold(Number(e.target.value))}><option value={50}>0.5 pp</option><option value={100}>1 pp</option><option value={200}>2 pp</option><option value={500}>5 pp</option></select></label><label>Ignore trades below <select value={minimumTrade} onChange={e=>setMinimumTrade(e.target.value)}><option value="0">Show all</option><option value="0.0001">0.0001 ETH</option><option value="0.001">0.001 ETH</option><option value="0.005">0.005 ETH</option></select></label><span>Snapshot and quotes refresh before signing.</span></div>
        <div className="curator-suggestions">{portfolioSuggestions.length?portfolioSuggestions.map(({r,trade})=><button key={r.token} disabled={busy || (trade!.buy&&paused)} onClick={()=>stage(r,trade!.buy,trade!.amount)}><span><b>{trade!.buy?"Buy":"Sell"} {r.symbol}</b><small>{Math.abs(driftBps(r.value,r.nav,r.target)??0)/100} pp {trade!.buy?"below":"above"} planned target</small></span><span>≈ {Number(formatEther(trade!.value)).toFixed(5)} ETH <small>Inspect →</small></span></button>):<p className="vault-footnote">No priced position meets this playbook’s drift and trade-size rules.</p>}</div>
        <div className="curator-review curator-atomic-review">
          <div className="curator-settlement-rail" aria-label="Atomic settlement order"><span><i>1</i>Lock targets</span><span><i>2</i>Sell first</span><span><i>3</i>Buy second</span><span><i>4</i>Check cash</span></div>
          <p className="vault-eyebrow">REVIEW THE WHOLE MOVE</p><h4>Everything settles—or nothing does.</h4>
          <p>Every route gets a fresh 3% protected minimum. The basket hash, deadline and final WETH floor are checked on-chain in the same transaction.</p>
          <button className="vault-button primary" disabled={busy||(!controller&&dirty)||!portfolioSuggestions.length||(paused&&portfolioSuggestions.some(s=>s.trade!.buy))} onClick={()=>void buildPortfolioPlan()}>{portfolioPlan.length?"Refresh atomic plan":"Build atomic plan"}</button>
          {portfolioPlan.length>0&&<div className="curator-plan"><div className="curator-plan-summary"><span><b>{portfolioPlan.length}</b> protected legs</span><span><b>{Number(formatEther(portfolioPlan.reduce((sum,step)=>sum+step.estimatedValue,0n))).toFixed(5)}</b> ETH moved</span><span><b>{Number(formatEther((controller?atomicGas??0n:portfolioPlan.reduce((sum,step)=>sum+(step.gas||0n),0n))*planGasPrice)).toFixed(7)}</b> ETH est. network</span></div><div className="vault-table-scroll"><table className="vault-table"><thead><tr><th>#</th><th>Action</th><th>Asset</th><th>Input</th><th>Protected minimum</th></tr></thead><tbody>{portfolioPlan.map((step,i)=><tr key={`${step.token}:${step.buy}`}><td>{i<portfolioStep?"✓":i+1}</td><td><span className={`curator-action ${step.buy?"buy":"sell"}`}>{step.buy?"Buy":"Sell"}</span></td><td>{step.symbol}</td><td>{formatUnits(step.amount,step.buy?18:step.decimals)} {step.buy?"WETH":step.symbol}</td><td>{formatUnits(step.minimum,step.buy?step.decimals:18)} {step.buy?step.symbol:"WETH"}</td></tr>)}</tbody></table></div>
          <details className="curator-plan-targets"><summary>Resulting target mix</summary><p>{rows.map((r,i)=>`${r.symbol} ${weights[i]??r.target}%`).join(" · ")} · WETH {cash}%</p></details>
          <button className="vault-button primary curator-sign" disabled={busy||portfolioStep>=portfolioPlan.length} onClick={()=>void executePortfolioStep()}>{portfolioStep>=portfolioPlan.length?"Rebalance complete":controller?"Review one atomic transaction":"Continue protected rebalance"}</button>
          <p className="vault-footnote">{controller?"A stale basket, expired quote, failed route or cash-floor breach reverts every target and trade.":"This vault still requires one wallet approval per trade and stops on the first failed simulation."}</p></div>}
        </div>
        <details className="curator-help curator-manual"><summary>Advanced · prepare one manual trade</summary><p>Use this when a playbook is not the right move. Manual trades retain the same oracle and minimum-output protections.</p><p>Vault cash: {wethBalance === undefined ? "—" : formatEther(wethBalance)} WETH · Room above the saved reserve: {formatEther(availableToBuy)} WETH.</p>
          <label>Asset<select className="vault-input" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setAmount(""); setMinimum(""); }}><option value="">Choose an asset</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}</option>)}</select></label>
          <div className="vault-presets">{[false,true].map(value => <button className="vault-button" aria-pressed={buy===value} key={String(value)} disabled={busy} onClick={() => { setBuy(value); setAmount(""); setMinimum(""); }}>{value ? "Buy with vault WETH" : "Sell into vault WETH"}</button>)}</div>
          <label>Amount ({buy ? "WETH" : row?.symbol ?? "tokens"})<input className="vault-input" value={amount} disabled={busy} inputMode="decimal" onChange={e => setAmount(e.target.value)} /></label>
          {row && !buy && <div className="vault-presets">{[25,50,75].map(p=><button className="vault-button" key={p} disabled={busy} onClick={()=>{setAmount(formatUnits(row.balance*BigInt(p)/100n,row.decimals));setMinimum("");}}>{p}%</button>)}<button className="vault-button" disabled={busy} onClick={() => {setAmount(formatUnits(row.balance,row.decimals));setMinimum("");}}>Max</button></div>}
          <label>Minimum output ({buy ? row?.symbol ?? "tokens" : "WETH"})<input className="vault-input" value={minimum} disabled={busy} inputMode="decimal" onChange={e => setMinimum(e.target.value)} /></label>
          <div className="vault-presets"><button className="vault-button" disabled={busy||!row||!amount} onClick={()=>void protectedMinimum()}>Fill protected minimum</button><button className="vault-button primary" disabled={busy || !row || !amount || !minimum || (buy && paused)} onClick={() => void previewTrade()}>Preview trade</button></div>
          {preview?.key===previewKey&&<div className="curator-review"><p className="vault-eyebrow">SIMULATION PASSED · VALID FOR ONE MINUTE</p><h4>{buy?"Buy":"Sell"} {row?.symbol}</h4><p>Spend <b>{amount} {buy?"WETH":row?.symbol}</b> · Receive at least <b>{minimum} {buy?row?.symbol:"WETH"}</b></p><p>Estimated network fee: {Number(preview.fee).toFixed(8)} ETH. Your wallet shows the final fee. All proceeds remain in the vault.</p><button className="vault-button primary" disabled={busy} onClick={()=>void submit("trade")}>Review in wallet</button></div>}
        </details>
      </div>
      <div hidden={tab!=="Basket"} className="vault-recovery"><h3>Build a basket worth following.</h3><p className="vault-footnote">{24-rows.length} spaces available. An approved route is required for every new asset.</p>
        <p>Configured tokens remain in the curator planner even when their balance is zero. Adding a token does not buy it automatically.</p>
        <div className="vault-trade-grid"><div><h4>Add token</h4><label>Token contract address<input className="vault-input" aria-label="New token address" value={tokenAddress} disabled={busy} onChange={e => {setTokenAddress(e.target.value);setConfig("");}} placeholder="0x…" /></label><button className="vault-button" disabled={busy || !tokenAddress} onClick={() => void findApprovedToken()}>Find approved route</button><p>{config ? "Approved route ready for review." : "Paste a token address to check its approved V2 route."}</p><button className="vault-button" disabled={busy || paused || !config || rows.length >= 24} onClick={() => void submit("add")}>Review adding token</button>{paused && <p>Resume deposits before adding tokens.</p>}</div>
        <div><h4>Remove token</h4><label>Configured token<select className="vault-input" aria-label="Token to remove" value={removeToken} disabled={busy} onChange={e => setRemoveToken(e.target.value)}><option value="">Choose a token</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}{r.held === 0n ? " — no holdings" : ""}</option>)}</select></label><p>{removalReason}</p>{removal&&<ol className="curator-checklist"><li>{removal.target==="0.00"?"✓":"1."} Save a 0% target <button disabled={busy} onClick={()=>{setWeights(weights.map((w,i)=>rows[i].token===removal.token?"0.00":w));setPlaybook("custom");setTab("Allocation");setMessage("Target set to zero in your draft. Normalize the remaining active weights, then save targets.");}}>Stage 0% target</button></li><li>{removal.held===0n?"✓":"2."} Sell remaining holdings {removal.balance>0n&&<button disabled={busy} onClick={()=>stage(removal,false,removal.balance)}>Prepare full sale</button>}</li><li>{removal.reserved===0n?"✓":"3."} Clear any reserved shareholder claims</li><li>Remove the empty asset</li></ol>}<button className="vault-button" disabled={busy || !canRemove} onClick={() => void submit("remove")}>Review removing token</button></div></div>
      </div>
    </>}
    {lastHash&&<a className="curator-receipt" href={`https://robin.etherscan.io/tx/${lastHash}`} target="_blank" rel="noreferrer">View last submitted transaction ↗</a>}
    <p role="status" aria-live="polite" className={message ? "vault-notice" : ""}>{message}</p>
  </section>;
}
