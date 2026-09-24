'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {encodeFunctionData,erc20Abi,formatEther,formatUnits,getAddress,isAddress,parseAbi,parseEther,zeroAddress,type Address,type Hash} from 'viem';
import {publicClient,useWallet} from '@/lib/wallet';
import {robinhood} from '@/lib/chain';
import {verifyProportionalRelease,type ProportionalRelease} from '@/lib/proportionalRelease';
import {readProportionalState,quoteProportionalDeposit,quoteProportionalWithdrawal,prepareProportionalDeposit,prepareProportionalWithdrawal,type ProportionalState} from '@/lib/proportionalQuote';
import {rebalanceControllerV3Abi,resolveVaultAuthority} from '@/lib/rebalanceController';
import {ProportionalCuratorDesk} from '@/components/ProportionalCuratorDesk';
const managementAbi=parseAbi(['function owner() view returns(address)','function weth() view returns(address)','function claimable(address,address) view returns(uint256)','function claim(address,address)','function emergencyRedeemInKind(uint256,address)','function setPaused(bool)']);
type JoinPlan=Awaited<ReturnType<typeof quoteProportionalDeposit>>;
type ExitPlan=Awaited<ReturnType<typeof quoteProportionalWithdrawal>>;
type Review={state:ProportionalState;kind:'join';plan:JoinPlan}|{state:ProportionalState;kind:'exit';plan:ExitPlan};
type Asset={token:Address;symbol:string;decimals:number|undefined;balance:bigint;claim:bigint};
const display=(value:bigint)=>Number(formatEther(value)).toLocaleString(undefined,{maximumFractionDigits:7});
const button='rounded-xl border border-teal-400/30 px-4 py-3 text-sm disabled:opacity-40';

export function ProportionalVaultDesk({release}:{release:ProportionalRelease}) {
  const {address,walletClient,chainId,connect,switchToRobinhood}=useWallet();
  const [state,setState]=useState<ProportionalState>();
  const [assets,setAssets]=useState<Asset[]>([]);
  const [owner,setOwner]=useState<Address>();
  const [controller,setController]=useState<Address>();
  const [ethBalance,setEthBalance]=useState(0n);
  const [eth,setEth]=useState('0.02');const [percent,setPercent]=useState(100);
  const [recoveryRecipient,setRecoveryRecipient]=useState('');
  const [review,setReview]=useState<Review>();const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');const [hash,setHash]=useState<Hash>();
  const [pending,setPending]=useState(false);
  const [clock,setClock]=useState(0);
  const lock=useRef(false),generation=useRef(0);
  const current=state?.account===(address??zeroAddress)&&state.vault===release.vault?state:undefined;
  const selected=current?current.walletShares*BigInt(percent)/100n:0n;
  const recipient=isAddress(recoveryRecipient)?getAddress(recoveryRecipient):undefined;
  const ready=review&&review.state.account===address&&review.state.vault===release.vault&&clock<=review.state.timestamp+60;
  const pendingKey=`hoodx:4663:pending:${release.vault.toLowerCase()}:${address?.toLowerCase()??'disconnected'}`;
  useEffect(()=>{
    let saved:string|null=null;try{saved=localStorage.getItem(pendingKey);}catch{setMessage('Browser storage is unavailable. Enable it before submitting a transaction.');}
    if(saved&&/^0x[0-9a-fA-F]{64}$/.test(saved)){setHash(saved as Hash);setPending(true);setMessage('A previous transaction needs receipt verification before another action.');}
    else{setHash(undefined);setPending(false);}
  },[pendingKey]);
  function remember(tx:Hash){setHash(tx);setPending(true);try{localStorage.setItem(pendingKey,tx);}catch{setMessage('Keep the transaction link until its receipt is verified.');}}
  function resolved(){localStorage.removeItem(pendingKey);setPending(false);}
  async function checkReceipt(){
    if(!hash||lock.current)return;lock.current=true;setBusy(true);
    try{const receipt=await publicClient.getTransactionReceipt({hash});resolved();await refresh();setMessage(receipt.status==='success'?'Transaction confirmed. Balances refreshed.':'Transaction reverted. You can request a new preview.');}
    catch{setMessage('Receipt not available yet. Keep this transaction link and check again before retrying.');}
    finally{lock.current=false;setBusy(false);}
  }

  const refresh=useCallback(async()=>{
    const ticket=++generation.current;setReview(undefined);
    await verifyProportionalRelease(publicClient,release);
    const next=await readProportionalState(publicClient,release.vault,address??zeroAddress);
    const common={address:release.vault,abi:managementAbi,blockNumber:next.blockNumber} as const;
    const [vaultOwner,weth,balance]=await Promise.all([publicClient.readContract({...common,functionName:'owner'}),publicClient.readContract({...common,functionName:'weth'}),address?publicClient.getBalance({address,blockNumber:next.blockNumber}):Promise.resolve(0n)]);
    const authority=await resolveVaultAuthority(publicClient,release.vault,vaultOwner,next.blockNumber);
    const rows=await Promise.all([...next.tokens,weth,zeroAddress].map(async(token,index)=>{
      const [symbol,decimals,claim]=await Promise.all([
        token===zeroAddress?Promise.resolve('ETH'):publicClient.readContract({address:token,abi:erc20Abi,functionName:'symbol',blockNumber:next.blockNumber}).catch(()=>token.slice(0,6)+'…'+token.slice(-4)),
        token===zeroAddress?Promise.resolve(18):publicClient.readContract({address:token,abi:erc20Abi,functionName:'decimals',blockNumber:next.blockNumber}).catch(()=>undefined),
        publicClient.readContract({...common,functionName:'claimable',args:[address??zeroAddress,token]}),
      ]);
      return {token,symbol,decimals,balance:index<next.tokens.length?next.balances[index]:0n,claim};
    }));
    if(ticket!==generation.current)return;
    setState(next);setAssets(rows);setOwner(authority.curator);setController(authority.controller);setEthBalance(balance);
  },[address,release]);
  useEffect(()=>{void refresh().catch(()=>setMessage('Unable to load this vault. Please retry.'));return()=>{generation.current++;};},[refresh]);
  useEffect(()=>{setRecoveryRecipient(address??'');},[address]);
  useEffect(()=>{setClock(Math.floor(Date.now()/1000));const id=setInterval(()=>setClock(Math.floor(Date.now()/1000)),1000);return()=>clearInterval(id);},[]);
  function invalidate(){generation.current++;setReview(undefined);}
  async function preview(kind:'join'|'exit',portion=percent){
    if(lock.current||!address)return;lock.current=true;setBusy(true);setMessage('Simulating the complete basket…');setReview(undefined);const ticket=++generation.current;
    try{
      await verifyProportionalRelease(publicClient,release);
      const snap=await readProportionalState(publicClient,release.vault,address);
      const result:Review=kind==='join'?{kind,state:snap,plan:await quoteProportionalDeposit(publicClient,snap,parseEther(eth))}:{kind,state:snap,plan:await quoteProportionalWithdrawal(publicClient,snap,snap.walletShares*BigInt(portion)/100n)};
      if(ticket!==generation.current)return;
      setReview(result);setMessage('Review the amounts below. Nothing has been submitted.');
    }catch{if(ticket===generation.current)setMessage('The complete basket could not be quoted within its limits. Refresh and try again.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function checkWallet(account:Address){
    if(!walletClient||await walletClient.getChainId()!==4663||(await walletClient.getAddresses())[0]?.toLowerCase()!==account.toLowerCase())throw Error('Wallet changed');
    localStorage.setItem(pendingKey+':check','1');localStorage.removeItem(pendingKey+':check');
  }
  async function confirm(){
    if(lock.current||pending||!review||!ready||!address||!walletClient)return;lock.current=true;setBusy(true);setHash(undefined);setMessage('Checking the transaction against current chain state…');
    const account=address;
    try{
      await checkWallet(account);await verifyProportionalRelease(publicClient,release);
      const prepared=review.kind==='join'?await prepareProportionalDeposit(publicClient,review.state,review.plan):await prepareProportionalWithdrawal(publicClient,review.state,review.plan);
      const request=prepared.request;
      const data=request.functionName==='depositExactShares'?encodeFunctionData(request):encodeFunctionData(request);
      const value=review.kind==='join'?review.plan.value:0n;
      const gas=await publicClient.estimateGas({account,to:release.vault,data,value});
      const fees=await publicClient.estimateFeesPerGas();
      const balance=await publicClient.getBalance({address:account});
      const gasLimit=gas*120n/100n;
      if(balance<(review.kind==='join'?review.plan.value:0n)+gasLimit*fees.maxFeePerGas)throw Error('Insufficient ETH for gas');
      await checkWallet(account);
      if(Math.floor(Date.now()/1000)>review.state.timestamp+60)throw Error('Quote expired');
      const tx=await walletClient.sendTransaction({to:release.vault,data,value,account,chain:robinhood,gas:gasLimit,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});
      remember(tx);setReview(undefined);setMessage('Submitted. Waiting for confirmation…');
      const receipt=await publicClient.waitForTransactionReceipt({hash:tx});
      resolved();
      if(receipt.status!=='success')throw Error('Reverted');
      await refresh();setMessage('Confirmed. Balances refreshed.');
    }catch{setReview(undefined);setMessage('Transaction not confirmed. If a transaction link is shown, check its receipt before trying again. Otherwise refresh the quote.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function manage(kind:'assets'|'pause'|'claim',token?:Address){
    if(lock.current||pending||!address||!walletClient||!current)return;lock.current=true;setBusy(true);setHash(undefined);setReview(undefined);
    try{
      await checkWallet(address);await verifyProportionalRelease(publicClient,release);
      const common={address:release.vault,abi:managementAbi,account:address} as const;
      if (kind!=='pause'&&!recipient) throw Error('Invalid recovery recipient');
      const prepared=kind==='assets'?await publicClient.simulateContract({...common,functionName:'emergencyRedeemInKind',args:[selected,recipient!]}):kind==='pause'&&controller?await publicClient.simulateContract({address:controller,abi:rebalanceControllerV3Abi,account:address,chain:robinhood,functionName:'setPaused',args:[!current.paused]}):kind==='pause'?await publicClient.simulateContract({...common,functionName:'setPaused',args:[!current.paused]}):await publicClient.simulateContract({...common,functionName:'claim',args:[token!,recipient!]});
      await checkWallet(address);
      const request=prepared.request;
      const data=request.functionName==='claim'?encodeFunctionData(request):request.functionName==='setPaused'?encodeFunctionData(request):encodeFunctionData(request);
      const tx=await walletClient.sendTransaction({to:release.vault,data,account:address,chain:robinhood});remember(tx);setMessage('Submitted. Waiting for confirmation…');
      const receipt=await publicClient.waitForTransactionReceipt({hash:tx});resolved();if(receipt.status!=='success')throw Error('Reverted');
      await refresh();setMessage('Confirmed. Balances refreshed.');
    }catch{setMessage('Action not confirmed. Check any transaction link before retrying.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <div className="space-y-6">
    <section className="vault-actions desk"><p className="vault-eyebrow">696X / BROADER BASKET</p><h1 className="text-4xl">The whole conviction list.</h1><p>Deposit ETH for a proportional share of every asset held. Unspent ETH and extra tokens remain yours.</p><a href="/i/696x" className="text-sm underline">Your original 696X vault remains available →</a></section>
    <section className="vault-actions desk"><div className="flex flex-wrap justify-between gap-4"><div><p className="vault-eyebrow">YOUR POSITION</p><h2 className="text-2xl">Join. Hold. Exit.</h2></div><div className="text-sm">Wallet: {display(ethBalance)} ETH<br/>{current?display(current.walletShares):'—'} shares</div></div>
      {!address?<button className={button} onClick={()=>void connect()}>Connect wallet</button>:chainId!==4663?<button className={button} onClick={()=>void switchToRobinhood()}>Switch to Robinhood Chain</button>:null}
      <div className="grid gap-5 py-6 md:grid-cols-2">
        <div className="vault-trade-card"><h3 className="text-xl">Deposit ETH</h3><label className="block py-3">Maximum ETH to spend<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4" inputMode="decimal" value={eth} disabled={busy} onChange={e=>{invalidate();setEth(e.target.value);}}/></label><div className="flex flex-wrap gap-2">{['0.02','0.05','0.08','0.1'].map(amount=><button key={amount} className={button} disabled={busy} onClick={()=>{invalidate();setEth(amount);}}>{amount}</button>)}</div><p className="py-3 text-sm opacity-70">Minimum 0.02 ETH. Keep additional ETH for gas.</p><button className={button} disabled={busy||pending||!address||chainId!==4663||!current||current.paused||current.supply===0n} onClick={()=>void preview('join')}>Preview deposit</button>{current?.paused&&<p>Deposits are paused.</p>}</div>
        <div className="vault-trade-card"><h3 className="text-xl">Withdraw ETH</h3><div className="flex gap-2 py-4">{[25,50,75,100].map(n=><button className={button} key={n} disabled={busy} aria-pressed={percent===n} onClick={()=>{invalidate();setPercent(n);if(address&&chainId===4663)void preview('exit',n);}}>{n===100?'Max':`${n}%`}</button>)}</div><p>{display(selected)} shares selected</p><label className="block py-3">Minimum ETH to receive<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4" readOnly value={ready&&review?.kind==='exit'?formatEther(review.plan.minEthOut):''} placeholder="Calculated when you preview"/></label><button className={button} disabled={busy||pending||!address||chainId!==4663||selected===0n} onClick={()=>void preview('exit')}>Preview withdrawal</button></div>
      </div>
      {review&&<div className="vault-recovery"><h3 className="text-xl">Review {review.kind==='join'?'deposit':'withdrawal'}</h3><dl className="grid grid-cols-2 gap-3 py-4"><dt>Shares {review.kind==='join'?'received':'redeemed'}</dt><dd>{formatEther(review.plan.shares)}</dd>{review.kind==='join'?<><dt>Estimated ETH spent</dt><dd>{formatEther(review.plan.grossSpent)}</dd><dt>Included protocol + creator fee</dt><dd>{formatEther(review.plan.fee)} ETH</dd><dt>Estimated unused ETH returned</dt><dd>{formatEther(review.plan.ethRefund)}</dd></>:<><dt>Estimated ETH received</dt><dd>{formatEther(review.plan.quotedEth)}</dd><dt>Minimum ETH received</dt><dd>{formatEther(review.plan.minEthOut)}</dd></>}</dl>{review.kind==='join'&&<p className="text-sm opacity-70">Any extra tokens from the buys are returned separately. Transfer taxes may reduce what arrives in your wallet. Fees and refunds can change within your signed spending limit.</p>}<p className="py-3 text-sm">{ready?'Each sale or buy keeps its protected minimum.':'This quote has expired. Request a new preview.'}</p><button className={button} disabled={busy||pending||!ready} onClick={()=>void confirm()}>Confirm in wallet</button></div>}
      <details className="vault-recovery"><summary>Receive your tokens and cash directly</summary><p className="py-3 text-sm">Redeem the selected {percent}% without selling the basket. Available while paused. Transfers that cannot complete remain claimable.</p><label className="block py-3 text-sm">Recovery recipient<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4" value={recoveryRecipient} spellCheck={false} onChange={e=>setRecoveryRecipient(e.target.value.trim())}/></label>{recoveryRecipient&&!recipient&&<p className="pb-3 text-sm text-amber-300">Enter a valid recipient address.</p>}<button className={button} disabled={busy||pending||!address||chainId!==4663||selected===0n||!recipient} onClick={()=>void manage('assets')}>Redeem {percent}% as assets</button></details>
      {assets.filter(a=>a.claim>0n).map(a=><div key={a.token} className="flex items-center justify-between py-2"><span>{a.decimals===undefined?'Balance available':formatUnits(a.claim,a.decimals)} {a.symbol} available to claim</span><button className={button} disabled={busy||pending||chainId!==4663||!recipient} onClick={()=>void manage('claim',a.token)}>Claim to recipient</button></div>)}
      {address&&owner?.toLowerCase()===address.toLowerCase()&&<button className={button} disabled={busy||pending||chainId!==4663} onClick={()=>void manage('pause')}>{current?.paused?'Resume deposits':'Pause deposits'}</button>}
      {address&&current&&owner?.toLowerCase()===address.toLowerCase()&&<ProportionalCuratorDesk vault={release.vault} controller={controller} state={current} busy={busy} onBusy={setBusy} onRefresh={refresh}/>}
      <button className={button} disabled={busy} onClick={()=>void refresh().catch(()=>setMessage('Unable to refresh balances.'))}>Refresh balances</button>
      <p className="py-3 text-sm" role="status" aria-live="polite">{busy?'Working… ':''}{message}</p>{hash&&<a className="text-sm underline" href={`https://robin.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}{pending&&<button className={button} disabled={busy} onClick={()=>void checkReceipt()}>Check pending transaction</button>}
    </section>
    <section className="vault-actions desk"><p className="vault-eyebrow">THE BASKET</p><h2 className="text-2xl">{current?.balances.filter(b=>b>0n).length??'—'} assets held</h2><div className="divide-y divide-white/10">{assets.filter(a=>a.balance>0n).map((a,i)=><div key={a.token} className="flex justify-between gap-4 py-3 text-sm"><span className="truncate">{i+1}. {a.symbol}</span><span>{a.decimals===undefined?'—':Number(formatUnits(a.balance,a.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})}</span></div>)}</div><p className="pt-3 text-sm opacity-70">{current?display(current.cash):'—'} ETH / WETH cash reserve. Reserved claims are excluded.</p><details className="pt-4 text-sm"><summary>How this basket works</summary><p className="py-3">Deposits copy the assets actually held, rather than target allocations. Curators choose and rebalance the basket using quoted trading limits. This successor does not use an independent price oracle to limit curator trades. Market losses, route failures and token restrictions remain possible.</p></details></section>
  </div>;
}
