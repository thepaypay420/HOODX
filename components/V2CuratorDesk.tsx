"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, encodeAbiParameters, formatEther, formatUnits, keccak256, parseAbi, parseAbiItem, parseUnits, type Address, type Hex } from "viem";
import { publicClient, useWallet } from "@/lib/wallet";
import { robinhood } from "@/lib/chain";
import { allocation } from "@/lib/v2Allocation";
import { capBuyPlan, distribute, driftBps, harvestProfitPlan, plannedTrade, restorePlan, skippedAtMinimumDeposit, groupedAllocation, type AllocationGroup } from "@/lib/curatorPlanner";
import { rebalanceControllerAbi } from "@/lib/rebalanceController";
import { CuratorReserveVisual } from "@/components/CuratorReserveVisual";

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
type AtomicPlaybook = "restore" | "harvest" | "deploy-cash" | "custom";
type CardSimulation = {
  status: "loading" | "ready" | "idle" | "error";
  steps: PortfolioStep[];
  gasPrice: bigint;
  atomicGas?: bigint;
  allocation?: { cashBps: number; weights: number[]; basketHash: Hex; minCashAfter: bigint };
  context: string;
  targetCash: string;
  createdAt: number;
  note?: string;
};
type CostBasis = { verified:boolean; indexedBlock:string; assets:Array<{token:Address;units:string;costWei:string;realizedPnlWei:string;reconciled:boolean}> };

function CuratorActionMotion({kind}: {kind:AtomicPlaybook}) {
  if(kind==="harvest")return <div className="curator-action-motion harvest-motion" aria-hidden="true"><svg viewBox="0 0 240 118"><path className="motion-ground" d="M12 90H228"/><path className="motion-row row-one" d="M22 104c30-13 58-13 88 0s58 13 108 0"/><path className="motion-row row-two" d="M30 111c26-9 53-9 80 0s55 9 99 0"/><g className="motion-tractor"><circle className="tractor-wheel large" cx="66" cy="78" r="17"/><circle className="tractor-wheel" cx="123" cy="82" r="11"/><path className="tractor-body" d="M54 68h47l11 8h21v8H53z"/><path className="tractor-cab" d="M77 40h29l11 28H76z"/><path className="tractor-window" d="M84 47h16l7 17H83z"/><path className="tractor-stack" d="M54 45h8v21h-8z"/><path className="tractor-beam" d="M135 80h37"/><path className="tractor-crop" d="M179 83v-20m0 8-8-8m8 2 8-8m19 26V54m0 9-8-8m8 1 8-8"/></g></svg><span>GAINS → RESERVE</span></div>;
  if(kind==="restore")return <div className="curator-action-motion restore-motion" aria-hidden="true"><svg viewBox="0 0 240 118"><circle className="restore-ring outer" cx="120" cy="57" r="44"/><circle className="restore-ring inner" cx="120" cy="57" r="27"/><path className="restore-cross" d="M120 8v98M71 57h98"/><g className="restore-dots"><circle cx="87" cy="30" r="6"/><circle cx="158" cy="42" r="5"/><circle cx="104" cy="86" r="5"/><circle cx="136" cy="77" r="6"/></g><circle className="restore-core" cx="120" cy="57" r="8"/></svg><span>DRIFT → TARGET</span></div>;
  if(kind==="deploy-cash")return <div className="curator-action-motion deploy-motion" aria-hidden="true"><svg viewBox="0 0 240 118"><circle className="deploy-reserve" cx="58" cy="58" r="28"/><text x="58" y="62">WETH</text><path className="deploy-path path-one" d="M87 48C124 18 155 22 192 31"/><path className="deploy-path path-two" d="M87 59c43 0 68 0 118 0"/><path className="deploy-path path-three" d="M87 70c38 29 68 27 105 17"/><g className="deploy-assets"><circle cx="201" cy="30" r="9"/><circle cx="214" cy="59" r="9"/><circle cx="201" cy="88" r="9"/></g><g className="deploy-pulses"><circle cx="113" cy="35" r="4"/><circle cx="142" cy="59" r="4"/><circle cx="117" cy="80" r="4"/></g></svg><span>RESERVE → ASSETS</span></div>;
  return <div className="curator-action-motion custom-motion" aria-hidden="true"><svg viewBox="0 0 240 118"><path className="custom-link" d="M45 81 82 35l42 34 39-43 35 55"/><g className="custom-bars"><rect x="35" y="65" width="20" height="28" rx="5"/><rect x="72" y="24" width="20" height="69" rx="5"/><rect x="114" y="54" width="20" height="39" rx="5"/><rect x="153" y="16" width="20" height="77" rx="5"/><rect x="188" y="68" width="20" height="25" rx="5"/></g></svg><span>YOUR MIX · ONE SIGNATURE</span></div>;
}

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
  const [cardSimulations,setCardSimulations]=useState<Partial<Record<AtomicPlaybook,CardSimulation>>>({});
  const simulationRun=useRef(0);
  const simulatedContext=useRef("");
  const [costBasis,setCostBasis]=useState<CostBasis>();
  const previewKey = [vault,address,chainId,selected,buy,amount,minimum,updated].join(":");
  const baseline = JSON.stringify([savedCash, rows.map(r => [r.token.toLowerCase(),r.target])]);
  const draftKey = `hoodx:curator:1:${robinhood.id}:${vault.toLowerCase()}:${address?.toLowerCase()}`;
  const dirty = cash !== savedCash || weights.some((w,i) => w !== rows[i]?.target);
  const portfolioContext = JSON.stringify([updated, threshold, minimumTrade, cash, weights, rows.map(r=>r.token)]);
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
  useEffect(()=>{let active=true;setCostBasis(undefined);void fetch(`/api/vault-cost-basis?vault=${vault}`,{signal:AbortSignal.timeout(12000)}).then(async response=>{if(!response.ok)throw new Error();return response.json() as Promise<CostBasis>;}).then(data=>{if(active)setCostBasis(data);}).catch(()=>{if(active)setCostBasis({verified:false,indexedBlock:"",assets:[]});});return()=>{active=false;};},[vault,updated]);
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
  const basisByToken=new Map(costBasis?.assets.map(asset=>[asset.token.toLowerCase(),asset])??[]);
  const rowCosts=rows.map(r=>{const basis=basisByToken.get(r.token.toLowerCase());if(!basis?.reconciled)return undefined;const units=BigInt(basis.units);return units>0n?BigInt(basis.costWei)*r.balance/units:0n;});
  const unrealizedGain=costBasis?.verified?rows.reduce((sum,r,i)=>sum+(r.value!==undefined&&rowCosts[i]!==undefined?r.value-rowCosts[i]!:0n),0n):undefined;
  let harvestPreview:ReturnType<typeof harvestProfitPlan>|undefined;
  if(costBasis?.verified&&nav)try{harvestPreview=harvestProfitPlan(savedCash,rows.map(r=>r.target),rows.map(r=>r.value===undefined?undefined:Number(r.value*10000n/nav)),rows.map(r=>r.value),rowCosts,nav,"5");}catch{}
  let tradeFloor = 0n; try { tradeFloor = parseUnits(minimumTrade,18); } catch {}
  function stage(r: Row, isBuy: boolean, input: bigint) {
    setSelected(r.token); setBuy(isBuy); setAmount(formatUnits(input,isBuy?18:r.decimals)); setMinimum(""); setPreview(undefined); setTab("Manual");
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
      const target=controller??vault, targetAbi=controller?rebalanceControllerAbi:abi;
      await publicClient.simulateContract({address:target,abi:targetAbi,account:address,functionName:"rebalance",args});
      const gas=await publicClient.estimateContractGas({address:target,abi:targetAbi,account:address,functionName:"rebalance",args});
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
  function cardTargets(kind:AtomicPlaybook) {
    if(kind==="harvest"&&harvestPreview)return {cash:harvestPreview.cash,weights:harvestPreview.weights};
    if(kind==="custom")return {cash,weights};
    return {cash:savedCash,weights:rows.map(r=>r.target)};
  }
  function cardIdleReason(kind:AtomicPlaybook) {
    if(!controller)return "Atomic controller unavailable.";
    if(valuationUnavailable)return "Waiting for a complete valuation.";
    if(kind==="restore"&&drifted.length===0)return "Every asset is inside the drift band.";
    if(kind==="harvest"&&!harvestPreview)return costBasis===undefined?"Verifying cost basis.":costBasis.verified?"No verified gains to harvest.":"Cost basis is temporarily unavailable. Refresh to retry.";
    if(kind==="deploy-cash"&&(availableToBuy<=0n||paused))return paused?"Resume deposits to deploy reserve.":"Reserve is already on plan.";
    if(kind==="custom"&&!dirty)return "Set a new allocation to prepare this action.";
    return "";
  }
  async function buildCardSimulation(kind:AtomicPlaybook,runId=simulationRun.current):Promise<CardSimulation|undefined>{
    const {cash:targetCash,weights:targetWeights}=cardTargets(kind);
    const context=JSON.stringify([portfolioContext,kind,targetCash,targetWeights]);
    const idle=cardIdleReason(kind);
    if(idle){const result:CardSimulation={status:"idle",steps:[],gasPrice:0n,context,targetCash,createdAt:Date.now(),note:idle};if(runId===simulationRun.current)setCardSimulations(previous=>({...previous,[kind]:result}));return result;}
    if(!address||!controller||!nav)return;
    setCardSimulations(previous=>({...previous,[kind]:{status:"loading",steps:[],gasPrice:0n,context,targetCash,createdAt:Date.now()}}));
    try{
      const draft=allocation(targetCash,targetWeights);
      let suggestions=rows.map((r,i)=>{
        const planned={...r,target:targetWeights[i]??r.target};
        return {r:planned,i,trade:plannedTrade(planned.balance,planned.value,planned.nav,planned.target)};
      }).filter(({r,trade})=>trade&&trade.value>=tradeFloor&&Math.abs(driftBps(r.value,r.nav,r.target)??0)>=threshold)
        .sort((a,b)=>Number(a.trade!.buy)-Number(b.trade!.buy)||(a.trade!.value>b.trade!.value?-1:1));
      if(kind==="harvest")suggestions=suggestions.filter(({trade,i})=>!trade!.buy&&!!harvestPreview?.assets.includes(i));
      if(kind==="deploy-cash"){
        const buys=suggestions.filter(({trade})=>trade!.buy);
        suggestions=capBuyPlan(buys.map(item=>({...item,amount:item.trade!.amount,value:item.trade!.value})),availableToBuy*98n/100n)
          .map(item=>({...item,trade:{...item.trade!,amount:item.amount,value:item.value}}));
      }
      if(!suggestions.length)throw new Error("No protected trades are needed.");
      const gasPrice=await publicClient.getGasPrice();
      const deadline=BigInt(Math.floor(Date.now()/1000)+600);
      const steps:PortfolioStep[]=[];
      for(const {r,trade} of suggestions){
        const minimumOut=await protectedFloor(r,trade!.buy,trade!.amount);
        steps.push({token:r.token,symbol:r.symbol,buy:trade!.buy,amount:trade!.amount,decimals:r.decimals,minimum:minimumOut,estimatedValue:trade!.value});
      }
      const basketHash=keccak256(encodeAbiParameters([{type:"address[]"}],[rows.map(r=>r.token)]));
      const minCashAfter=nav*BigInt(draft.cashBps)/10000n;
      const contractSteps=steps.map(step=>({token:step.token,buy:step.buy,amount:step.amount,minOut:step.minimum}));
      const atomicGas=await publicClient.estimateContractGas({address:controller,abi:rebalanceControllerAbi,account:address,functionName:"atomicRebalance",args:[draft.cashBps,draft.weights,contractSteps,basketHash,minCashAfter,deadline]});
      const result:CardSimulation={status:"ready",steps,gasPrice,atomicGas,allocation:{cashBps:draft.cashBps,weights:draft.weights,basketHash,minCashAfter},context,targetCash,createdAt:Date.now()};
      if(runId===simulationRun.current)setCardSimulations(previous=>({...previous,[kind]:result}));
      return result;
    }catch(error){
      const note=error instanceof BaseError?error.shortMessage:error instanceof Error?error.message:"Simulation unavailable.";
      const result:CardSimulation={status:note==="No protected trades are needed."?"idle":"error",steps:[],gasPrice:0n,context,targetCash,createdAt:Date.now(),note};
      if(runId===simulationRun.current)setCardSimulations(previous=>({...previous,[kind]:result}));
      return result;
    }
  }
  async function simulateActionCards(){
    const runId=++simulationRun.current;
    for(const kind of ["restore","harvest","deploy-cash","custom"] as AtomicPlaybook[]){
      if(runId!==simulationRun.current)return;
      await buildCardSimulation(kind,runId);
    }
  }
  useEffect(()=>{
    if(!loaded||!address)return;
    const key=JSON.stringify([portfolioContext,address,controller,costBasis?.indexedBlock,costBasis?.verified]);
    if(simulatedContext.current===key)return;
    simulatedContext.current=key;
    void simulateActionCards();
  // Card simulations start when this workspace mounts; the parent mounts it only when opened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loaded,address,controller,costBasis,portfolioContext]);
  async function executeCardAction(kind:AtomicPlaybook){
    if(kind==="custom"&&!dirty){setTab("Allocation");return;}
    if(!walletClient||!address||!controller||busy)return;
    if(chainId!==robinhood.id){await switchToRobinhood();return;}
    onBusy(true);setMessage("");
    try{
      const currentContext=JSON.stringify([portfolioContext,kind,cardTargets(kind).cash,cardTargets(kind).weights]);
      let simulation=cardSimulations[kind];
      if(!simulation||simulation.status!=="ready"||simulation.context!==currentContext||Date.now()-simulation.createdAt>600000){
        simulation=await buildCardSimulation(kind);
      }
      if(!simulation||simulation.status!=="ready"||!simulation.allocation)throw new Error(simulation?.note||"This action is not ready.");
      const fresh=await publicClient.readContract({address:vault,abi,functionName:"constituents"});
      const freshHash=keccak256(encodeAbiParameters([{type:"address[]"}],[fresh]));
      if(freshHash!==simulation.allocation.basketHash)throw new Error("The basket changed. Reopen the workspace to refresh every action.");
      const deadline=BigInt(Math.floor(Date.now()/1000)+600);
      const steps=[] as {token:Address;buy:boolean;amount:bigint;minOut:bigint}[];
      for(const step of simulation.steps){
        const currentRow=rows.find(r=>r.token===step.token);
        if(!currentRow)throw new Error("The basket changed. Refresh before acting.");
        steps.push({token:step.token,buy:step.buy,amount:step.amount,minOut:await protectedFloor(currentRow,step.buy,step.amount)});
      }
      const plan=simulation.allocation;
      const args=[plan.cashBps,plan.weights,steps,plan.basketHash,plan.minCashAfter,deadline] as const;
      const {request}=await publicClient.simulateContract({address:controller,abi:rebalanceControllerAbi,account:address,chain:robinhood,functionName:"atomicRebalance",args});
      const hash=await walletClient.writeContract(request);setLastHash(hash);setMessage(`${kind==="harvest"?"Harvest":kind==="restore"?"Restore":kind==="deploy-cash"?"Deploy":"Custom mix"} submitted. Waiting for confirmation.`);
      const receipt=await publicClient.waitForTransactionReceipt({hash});
      if(receipt.status!=="success")throw new Error("Atomic action reverted. No targets or trades were changed.");
      simulationRun.current++;setCardSimulations({});simulatedContext.current="";
      apply(await load());await onRefresh();setMessage("Atomic action complete. Holdings and targets are refreshed.");
    }catch(error){setMessage(error instanceof BaseError?error.shortMessage:error instanceof Error?error.message:"Atomic action failed.");}
    finally{onBusy(false);}
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
  const totalBasis=rowCosts.reduce<bigint>((sum,cost)=>sum+(cost??0n),0n);
  const gainPercent=unrealizedGain!==undefined&&totalBasis>0n?Number(unrealizedGain*10000n/totalBasis)/100:undefined;
  const recommendation:AtomicPlaybook|"sync"|"steady"=!costBasis?"sync":harvestPreview?"harvest":drifted.length?"restore":availableToBuy>tradeFloor?"deploy-cash":"steady";
  const recommendationCopy={
    sync:{title:"Reading the confirmed ledger.",body:"Cost basis is being reconciled before HOODX recommends a move."},
    harvest:{title:"Harvest Gains",body:`Raise reserve by up to ${((harvestPreview?.liftBps??0)/100).toFixed(2)} points from verified gains.`},
    restore:{title:"Restore targets",body:`${drifted.length} asset${drifted.length===1?" is":"s are"} outside your drift band.`},
    "deploy-cash":{title:"Deploy reserve",body:"Refill underweight assets from excess WETH while preserving the reserve floor."},
    custom:{title:"Custom mix",body:"Move the basket to your drafted allocation in one transaction."},
    steady:{title:"Hold steady",body:"The basket is inside its drift band and reserve is on plan."},
  }[recommendation];
  const actionCards:Array<{kind:AtomicPlaybook;title:string;body:string;meta:string;button:string}>=[
    {kind:"restore",title:"Restore targets",body:"Return the basket to its saved weights in one atomic move.",meta:`${drifted.length} outside drift band`,button:"Restore"},
    {kind:"harvest",title:"Harvest Gains",body:"Move verified gains into the WETH reserve without leaving the basket.",meta:harvestPreview?`${harvestPreview.assets.length} profitable · +${(harvestPreview.liftBps/100).toFixed(2)} pts reserve`:"No verified gains ready",button:"Harvest"},
    {kind:"deploy-cash",title:"Deploy reserve",body:"Put excess WETH into underweight assets while preserving the reserve floor.",meta:`${Number(formatEther(availableToBuy)).toFixed(5)} WETH available`,button:"Deploy"},
    {kind:"custom",title:"Custom mix",body:"Apply your drafted weights across the whole basket at once.",meta:dirty?"Draft ready":"Set targets to begin",button:dirty?"Apply mix":"Set allocation"},
  ];
  const orderedCards=[...actionCards].sort((a,b)=>Number(b.kind===recommendation)-Number(a.kind===recommendation));
  return <section id="curator" className="vault-actions holo">
    <div className="vault-section-heading"><div><p className="vault-eyebrow">CURATOR WORKSPACE</p><h2>Your conviction. In control.</h2></div><span className="vault-tag">Curator access</span></div>
    <p className="vault-footnote">Portfolio overview and actions.</p>
    {!loaded ? <p>Loading curator tools…</p> : <>
      {tab!=="Overview"&&<div className="curator-flow-nav"><button onClick={()=>setTab("Overview")}>← Curator home</button><span>{tab==="Manual"?"Manual trade":tab==="Allocation"?"Allocation":"Basket management"}</span></div>}
      {tab==="Overview"&&<div className="curator-overview curator-simple">
        <div className="curator-metrics simple"><div><span>Vault value</span><strong>{nav===undefined?"—":`${Number(formatEther(nav)).toFixed(5)} ETH`}</strong><small>Live oracle value</small></div><div><span>Unrealized gain</span><strong className={unrealizedGain!==undefined&&unrealizedGain<0n?"vault-loss":""}>{gainPercent===undefined?"—":`${gainPercent>=0?"+":""}${gainPercent.toFixed(2)}%`}</strong><small>{costBasis?.verified?`${Number(formatEther(unrealizedGain??0n)).toFixed(5)} ETH · reconciled basis`:costBasis?"History needs review":"Verifying confirmed history"}</small></div><div><span>Cash reserve</span><strong>{currentCash===undefined?"—":`${currentCash.toFixed(2)}%`}</strong><small>{savedCash}% saved target</small></div></div>
        {(recommendation==="sync"||recommendation==="steady")&&<div className="curator-action-card featured status-only"><div><p className="vault-eyebrow"><span className="curator-status-dot" />RECOMMEND</p><h3>{recommendationCopy.title}</h3><p>{recommendationCopy.body}</p></div><CuratorReserveVisual current={currentCash} target={Number(savedCash)} active={false}/></div>}
        <div className="curator-action-grid">
          {orderedCards.map((card,index)=>{const featured=card.kind===recommendation;const simulation=cardSimulations[card.kind];const planValue=simulation?.steps.reduce((sum,step)=>sum+step.estimatedValue,0n)??0n;const planFee=(simulation?.atomicGas??0n)*(simulation?.gasPrice??0n);const canExecute=simulation?.status==="ready"||(card.kind==="custom"&&!dirty);return <article key={card.kind} className={`curator-action-card ${featured?"featured":""}`}>
            <div className="curator-card-head"><div><p className="vault-eyebrow">{featured?"RECOMMEND":`0${index+1} · ATOMIC ACTION`}</p><h3>{card.title}</h3><p>{card.body}</p><span className="curator-card-meta">{card.meta}</span></div><CuratorActionMotion kind={card.kind}/></div>
            <div className="curator-inline-preview" aria-live="polite">
              {!simulation||simulation.status==="loading"?<p className="curator-preview-loading"><i/>Preparing protected outcome…</p>:simulation.status==="ready"?<>
                <p className="vault-eyebrow">SIMULATION PASSED · VALID 10 MINUTES</p>
                <div className="curator-preview-stats"><span><b>{simulation.steps.filter(s=>!s.buy).length}</b> sells</span><span><b>{simulation.steps.filter(s=>s.buy).length}</b> buys</span><span><b>{Number(formatEther(planValue)).toFixed(5)}</b> ETH moved</span><span><b>{Number(formatEther(planFee)).toFixed(7)}</b> ETH network</span></div>
                <ol>{simulation.steps.slice(0,3).map((step,i)=><li key={`${step.token}:${step.buy}`}><span>{i+1}. {step.buy?"Buy":"Sell"} <b>{step.symbol}</b></span><small>minimum {Number(formatUnits(step.minimum,step.buy?step.decimals:18)).toLocaleString(undefined,{maximumFractionDigits:6})} {step.buy?step.symbol:"WETH"}</small></li>)}{simulation.steps.length>3&&<li className="more"><span>+ {simulation.steps.length-3} more protected legs</span></li>}</ol>
                <div className="curator-preview-result"><span>Result</span><b>{simulation.targetCash}% WETH reserve</b></div>
              </>:<p className="curator-preview-empty"><span>{simulation.status==="error"?"Simulation unavailable":"No action needed"}</span><b>{simulation.note}</b></p>}
            </div>
            <button className={`vault-button ${featured?"primary":""} curator-card-action`} disabled={busy||!canExecute} onClick={()=>void executeCardAction(card.kind)}>{busy?"Working…":card.button}<span aria-hidden="true">→</span></button>
            {simulation?.status==="ready"&&<p className="curator-card-assurance">Fresh protections are checked again before your wallet opens.</p>}
          </article>})}
        </div>
        <div className="curator-tool-cards"><button onClick={()=>setTab("Allocation")}><span>Allocation</span><small>Edit targets and asset groups</small><b>→</b></button><button onClick={()=>setTab("Basket")}><span>Basket</span><small>Add, replace, or remove assets</small><b>→</b></button><button onClick={()=>setTab("Manual")}><span>Manual trade</span><small>Prepare one protected trade</small><b>→</b></button></div>
        <div className="curator-toolbar compact"><span>{updated?`Snapshot ${new Date(updated).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`:"Loading"} · Cost basis block {costBasis?.indexedBlock||"—"}</span><button className="vault-button" disabled={busy} onClick={()=>void refreshSnapshot()}>Refresh</button></div>
      </div>}
      <div hidden={tab!=="Allocation"} className="vault-recovery"><h3>Shape your allocation.</h3><p className="vault-footnote">Lock the weights you want to keep. Distribute the rest with exact rounding.</p>
        <label>Cash reserve (%)<input className="vault-input" inputMode="decimal" value={cash} disabled={busy} onChange={e => {setCash(e.target.value);}} /></label>
        <div className="vault-presets">{["20","25","35","50"].map(v=><button className="vault-button" key={v} disabled={busy} onClick={()=>{setCash(v);}}>{v}% cash</button>)}</div>
        <div className="vault-presets">{[false,true].map(equal=><button key={String(equal)} className="vault-button" disabled={busy} onClick={()=>{try{setWeights(distribute(cash,weights.map((w,i)=>groups[i]==="Excluded"?"0":w),rows.map((_,i)=>!!locked[i]||groups[i]==="Excluded"),equal));}catch(e){setMessage((e as Error).message);}}}>{equal?"Equal unlocked weights":"Normalize active weights"}</button>)}<button className="vault-button" disabled={busy} onClick={savePlan}>Save draft</button><button className="vault-button" disabled={busy} onClick={loadPlan}>Restore draft</button><button className="vault-button" disabled={busy} onClick={exportPlan}>Export CSV</button><button className="vault-button" disabled={busy} onClick={() => { onBusy(true); void load().then(apply).catch(() => setMessage("Unable to reload targets.")).finally(() => onBusy(false)); }}>Reset to on-chain</button></div>
        <details className="curator-help"><summary>Core + discovery preset</summary><p>Choose each asset’s group in the table. Core receives the remaining asset budget; Discovery shares the budget below. Excluded assets receive 0%. Locked weights are preserved. These are allocation tools, not investment recommendations.</p><label>Discovery (% of the whole vault)<input className="vault-target-input" aria-label="Discovery budget percent" value={discovery} disabled={busy} onChange={e=>setDiscovery(e.target.value)} /></label><button className="vault-button" disabled={busy} onClick={()=>{try{setWeights(groupedAllocation(cash,discovery,weights,locked,groups));}catch(e){setMessage((e as Error).message);}}}>Apply core + discovery</button></details>
        <div className="curator-toolbar"><input className="curator-search" aria-label="Filter allocation assets" placeholder="Find an asset…" value={query} onChange={e=>setQuery(e.target.value)} /><label><input type="checkbox" checked={onlyDrift} onChange={e=>setOnlyDrift(e.target.checked)} /> Outside drift band only</label></div>
        <div className="vault-table-scroll"><table className="vault-table curator-table"><thead><tr><th>Asset</th><th>Current / saved</th><th>Drift</th><th>Draft %</th><th>Group</th><th>Lock</th></tr></thead><tbody>{rows.map((r,i) => ({r,i})).filter(({r})=>(r.symbol.toLowerCase().includes(query.toLowerCase())||r.token.toLowerCase().includes(query.toLowerCase()))&&(!onlyDrift||Math.abs(driftBps(r.value,r.nav,r.target)??0)>=threshold)).map(({r,i}) => {const drift=driftBps(r.value,r.nav,r.target);return <tr key={r.token}><td><b>{r.symbol}</b><small title={formatUnits(r.balance,r.decimals)}>{Number(formatUnits(r.balance,r.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})} free</small></td><td>{r.value !== undefined && r.nav ? `${(Number(r.value * 10000n / r.nav)/100).toFixed(2)}%` : "—"}<small>Saved {r.target}%</small></td><td><span className={drift!==undefined&&Math.abs(drift)>=threshold?"curator-drift":""}>{drift===undefined?"No price":`${drift>0?"+":""}${(drift/100).toFixed(2)} pp`}</span></td><td><input className="vault-target-input" aria-label={`${r.symbol} target percent`} inputMode="decimal" value={weights[i] ?? ""} disabled={busy||locked[i]} onChange={e => {setWeights(weights.map((w,j) => j===i ? e.target.value : w));}} /></td><td><select className="curator-group" aria-label={`${r.symbol} allocation group`} value={groups[i]??"Core"} disabled={busy} onChange={e=>{setGroups(rows.map((_,j)=>j===i?e.target.value as AllocationGroup:groups[j]));}}>{["Core","Discovery","Excluded"].map(g=><option key={g}>{g}</option>)}</select></td><td><input type="checkbox" aria-label={`Lock ${r.symbol} weight`} checked={!!locked[i]} disabled={busy} onChange={e=>setLocked(rows.map((_,j)=>i===j?e.target.checked:!!locked[j]))} /></td></tr>})}</tbody></table></div>
        <div className="curator-allocation-total"><span>{dirty?"Unsaved allocation changes":"Matches saved targets"}</span><b>{valid?"100% allocated":validation}</b></div>
        {smallTargets.length>0&&<p className="vault-notice">Small-deposit coverage: {smallTargets.join(", ")} would each receive less than 0.0001 ETH from a 0.02 ETH deposit after current fees. Those allocations are skipped and remain in cash. Larger deposits may fill them.</p>}
        <p className="vault-footnote">{valid ? "Total: 100%. Ready to save." : validation} Cash must stay between 20% and 50%.</p>
        {dirty&&<details className="curator-help" open><summary>Changes to review</summary><p>Cash: {savedCash}% → {cash}%</p>{rows.map((r,i)=>weights[i]!==r.target&&<p key={r.token}>{r.symbol}: {r.target}% → {weights[i]||"—"}%</p>)}<p>Saving targets does not trade existing holdings.</p></details>}
        <button className="vault-button" disabled={busy || !valid || !dirty} onClick={() => void submit("targets")}>Review and save targets</button>
      </div>
      <div hidden={tab!=="Manual"} className="vault-recovery curator-manual-desk">
        <p className="vault-eyebrow">MANUAL ACTION</p><h3>One protected trade.</h3><p className="vault-footnote">Use this only when the portfolio actions are not the right move. The same oracle and minimum-output protections apply.</p><p>Vault cash: {wethBalance === undefined ? "—" : formatEther(wethBalance)} WETH · Room above saved reserve: {formatEther(availableToBuy)} WETH.</p>
          <label>Asset<select className="vault-input" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setAmount(""); setMinimum(""); }}><option value="">Choose an asset</option>{rows.map(r => <option key={r.token} value={r.token}>{r.symbol}</option>)}</select></label>
          <div className="vault-presets">{[false,true].map(value => <button className="vault-button" aria-pressed={buy===value} key={String(value)} disabled={busy} onClick={() => { setBuy(value); setAmount(""); setMinimum(""); }}>{value ? "Buy with vault WETH" : "Sell into vault WETH"}</button>)}</div>
          <label>Amount ({buy ? "WETH" : row?.symbol ?? "tokens"})<input className="vault-input" value={amount} disabled={busy} inputMode="decimal" onChange={e => setAmount(e.target.value)} /></label>
          {row && !buy && <div className="vault-presets">{[25,50,75].map(p=><button className="vault-button" key={p} disabled={busy} onClick={()=>{setAmount(formatUnits(row.balance*BigInt(p)/100n,row.decimals));setMinimum("");}}>{p}%</button>)}<button className="vault-button" disabled={busy} onClick={() => {setAmount(formatUnits(row.balance,row.decimals));setMinimum("");}}>Max</button></div>}
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
