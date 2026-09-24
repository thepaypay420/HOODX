'use client';

import {useEffect,useMemo,useState} from 'react';
import {BaseError,encodeAbiParameters,formatEther,formatUnits,keccak256,parseAbi,type Address,type Hex} from 'viem';
import {publicClient,useWallet} from '@/lib/wallet';
import {robinhood} from '@/lib/chain';
import {allocation} from '@/lib/v2Allocation';
import {proportionalAbi,quoteProportionalRebalance,readProportionalState,type ProportionalState} from '@/lib/proportionalQuote';
import {rebalanceControllerV3Abi} from '@/lib/rebalanceController';

const curatorAbi=parseAbi([
  'function cashTargetBps() view returns(uint16)',
  'function targetBps(address) view returns(uint16)',
  'function symbol() view returns(string)',
  'function decimals() view returns(uint8)',
]);
type Row={token:Address;symbol:string;decimals:number;balance:bigint;target:string};
type Step={token:Address;symbol:string;decimals:number;buy:boolean;amount:bigint;minOut:bigint;value:bigint};
type Plan={steps:Step[];cashBps:number;weights:number[];basketHash:Hex;nonce:bigint;minCashAfter:bigint;at:number;gas:bigint;gasPrice:bigint};

export function ProportionalCuratorDesk({vault,controller,state,busy,onBusy,onRefresh}:{vault:Address;controller?:Address;state:ProportionalState;busy:boolean;onBusy:(v:boolean)=>void;onRefresh:()=>Promise<void>}){
  const {address,walletClient,chainId,switchToRobinhood}=useWallet();
  const [rows,setRows]=useState<Row[]>([]);const [cash,setCash]=useState('25');const [weights,setWeights]=useState<string[]>([]);
  const [plan,setPlan]=useState<Plan>();const [message,setMessage]=useState('');const [hash,setHash]=useState<Hex>();
  const valid=useMemo(()=>{try{allocation(cash,weights);return true;}catch{return false;}},[cash,weights]);
  useEffect(()=>{let active=true;(async()=>{
    const [cashBps,...targets]=await Promise.all([
      publicClient.readContract({address:vault,abi:curatorAbi,functionName:'cashTargetBps',blockNumber:state.blockNumber}),
      ...state.tokens.map(token=>publicClient.readContract({address:vault,abi:curatorAbi,functionName:'targetBps',args:[token],blockNumber:state.blockNumber})),
    ]);
    const next=await Promise.all(state.tokens.map(async(token,i)=>{const [symbol,decimals]=await Promise.all([
      publicClient.readContract({address:token,abi:curatorAbi,functionName:'symbol',blockNumber:state.blockNumber}).catch(()=>`${token.slice(0,6)}…${token.slice(-4)}`),
      publicClient.readContract({address:token,abi:curatorAbi,functionName:'decimals',blockNumber:state.blockNumber}),
    ]);return{token,symbol,decimals,balance:state.balances[i],target:(targets[i]/100).toFixed(2)};}));
    if(active){setRows(next);setCash((cashBps/100).toFixed(2));setWeights(next.map(r=>r.target));setPlan(undefined);}
  })().catch(()=>active&&setMessage('Unable to load curator allocation.'));return()=>{active=false;};},[state,vault]);

  function equalize(){
    try{const cashBps=Math.round(Number(cash)*100),left=10000-cashBps,base=Math.floor(left/rows.length),extra=left-base*rows.length;setWeights(rows.map((_,i)=>((base+(i<extra?1:0))/100).toFixed(2)));setPlan(undefined);}catch{setMessage('Enter a valid cash reserve first.');}
  }

  async function build(){
    if(!address||busy||!controller)return;onBusy(true);setPlan(undefined);setMessage('Reading each route once and building the complete portfolio move…');
    try{
      const draft=allocation(cash,weights);const fresh=await readProportionalState(publicClient,vault,address);
      if(fresh.nonce!==state.nonce||fresh.blockNumber-state.blockNumber>20n)throw Error('Vault state changed. Refresh before planning.');
      const values=await Promise.all(rows.map((r,i)=>fresh.balances[i]===0n?Promise.resolve(0n):quoteProportionalRebalance(publicClient,fresh,r.token,false,fresh.balances[i])));
      const total=fresh.cash+values.reduce((sum,v)=>sum+v,0n);if(total===0n)throw Error('The basket has no quotable value.');
      const minimumTrade=100_000_000_000_000n;const sells:Step[]=[];const buyInputs:{row:Row;amount:bigint;value:bigint}[]=[];
      for(let i=0;i<rows.length;i++){
        const desired=total*BigInt(draft.weights[i])/10000n,current=values[i];
        if(current>desired&&current-desired>=minimumTrade&&fresh.balances[i]>0n){
          const amount=fresh.balances[i]*(current-desired)/current;if(amount===0n)continue;
          const output=await quoteProportionalRebalance(publicClient,fresh,rows[i].token,false,amount);
          sells.push({token:rows[i].token,symbol:rows[i].symbol,decimals:rows[i].decimals,buy:false,amount,minOut:output*97n/100n,value:output});
        }else if(desired>current&&desired-current>=minimumTrade)buyInputs.push({row:rows[i],amount:desired-current,value:desired-current});
      }
      const minCashAfter=total*BigInt(draft.cashBps)/10000n;
      const sellCash=sells.reduce((sum,s)=>sum+s.value,0n);const available=fresh.cash+sellCash>minCashAfter?fresh.cash+sellCash-minCashAfter:0n;
      const requested=buyInputs.reduce((sum,b)=>sum+b.amount,0n);const buys:Step[]=[];
      for(const item of buyInputs){const amount=requested>available&&requested>0n?item.amount*available/requested:item.amount;if(amount<minimumTrade)continue;const output=await quoteProportionalRebalance(publicClient,fresh,item.row.token,true,amount);buys.push({token:item.row.token,symbol:item.row.symbol,decimals:item.row.decimals,buy:true,amount,minOut:output*97n/100n,value:amount});}
      const steps=[...sells,...buys];if(!steps.length)throw Error('No position is large enough to rebalance at the current targets.');
      const basketHash=keccak256(encodeAbiParameters([{type:'address[]'}],[fresh.tokens]));const deadline=BigInt(Math.floor(Date.now()/1000)+300);
      const args=[draft.cashBps,draft.weights,steps.map(({token,buy,amount,minOut})=>({token,buy,amount,minOut})),basketHash,fresh.nonce,minCashAfter,deadline] as const;
      const gas=await publicClient.estimateContractGas({address:controller,abi:rebalanceControllerV3Abi,account:address,functionName:'atomicRebalance',args});const gasPrice=await publicClient.getGasPrice();
      setPlan({steps,cashBps:draft.cashBps,weights:draft.weights,basketHash,nonce:fresh.nonce,minCashAfter,at:Date.now(),gas,gasPrice});setMessage(`Plan ready: ${sells.length} sells, ${buys.length} buys, one wallet approval. Nothing has been submitted.`);
    }catch(e){setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message);}finally{onBusy(false);}
  }

  async function execute(){
    if(!plan||!controller||!address||!walletClient||busy)return;if(chainId!==robinhood.id){await switchToRobinhood();return;}onBusy(true);setMessage('Refreshing every route and simulating the complete transaction…');
    try{
      if(Date.now()-plan.at>60_000)throw Error('Plan expired. Build a fresh plan.');const fresh=await readProportionalState(publicClient,vault,address);
      const basketHash=keccak256(encodeAbiParameters([{type:'address[]'}],[fresh.tokens]));if(fresh.nonce!==plan.nonce||basketHash!==plan.basketHash)throw Error('The basket changed. Refresh and rebuild.');
      const steps=[] as {token:Address;buy:boolean;amount:bigint;minOut:bigint}[];for(const step of plan.steps){const output=await quoteProportionalRebalance(publicClient,fresh,step.token,step.buy,step.amount);steps.push({token:step.token,buy:step.buy,amount:step.amount,minOut:output*97n/100n});}
      const deadline=BigInt(Math.floor(Date.now()/1000)+300);const args=[plan.cashBps,plan.weights,steps,plan.basketHash,plan.nonce,plan.minCashAfter,deadline] as const;
      const {request}=await publicClient.simulateContract({address:controller,abi:rebalanceControllerV3Abi,account:address,chain:robinhood,functionName:'atomicRebalance',args});const tx=await walletClient.writeContract(request);setHash(tx);setMessage('Atomic rebalance submitted. Waiting for confirmation…');
      const receipt=await publicClient.waitForTransactionReceipt({hash:tx});if(receipt.status!=='success')throw Error('The transaction reverted; no target or trade changed.');setPlan(undefined);await onRefresh();setMessage('Atomic rebalance complete. Every target and trade settled together.');
    }catch(e){setMessage(e instanceof BaseError?e.shortMessage:(e as Error).message);}finally{onBusy(false);}
  }

  return <details className="vault-recovery"><summary>Curator workspace · one-signature rebalance</summary><div className="py-4"><p className="text-sm opacity-70">Draft the complete allocation, quote all routes from one chain snapshot, then approve every sell, buy and target change as one atomic transaction.</p>{!controller&&<p className="vault-notice">This vault must adopt its reviewed atomic controller before one-signature rebalancing is available.</p>}
    <label className="block py-3">Cash reserve (%)<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4" value={cash} onChange={e=>{setCash(e.target.value);setPlan(undefined);}}/></label><button className="vault-button" disabled={busy} onClick={equalize}>Equal weight assets</button>
    <div className="vault-table-scroll"><table className="vault-table"><thead><tr><th>Asset</th><th>Free balance</th><th>Target %</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.token}><td>{r.symbol}</td><td>{Number(formatUnits(r.balance,r.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})}</td><td><input className="vault-target-input" value={weights[i]??''} onChange={e=>{setWeights(weights.map((w,j)=>i===j?e.target.value:w));setPlan(undefined);}}/></td></tr>)}</tbody></table></div>
    <button className="vault-button primary" disabled={busy||!controller||!valid||rows.length===0} onClick={()=>void build()}>{plan?'Refresh atomic plan':'Build atomic plan'}</button>{plan&&<div className="curator-review"><p>{plan.steps.filter(s=>!s.buy).length} sells · {plan.steps.filter(s=>s.buy).length} buys · estimated network fee {Number(formatEther(plan.gas*plan.gasPrice)).toFixed(7)} ETH</p><ol>{plan.steps.map((s,i)=><li key={`${s.token}:${s.buy}`}>{i+1}. {s.buy?'Buy':'Sell'} {s.symbol} · input {formatUnits(s.amount,s.buy?18:s.decimals)} · minimum {formatUnits(s.minOut,s.buy?s.decimals:18)}</li>)}</ol><button className="vault-button primary" disabled={busy} onClick={()=>void execute()}>Approve one atomic rebalance</button><p className="text-sm opacity-70">One failed leg, stale nonce, expired quote, or cash-floor breach reverts the entire plan.</p></div>}
    <p role="status" className={message?'vault-notice':''}>{message}</p>{hash&&<a className="text-sm underline" href={`https://robin.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div></details>;
}
