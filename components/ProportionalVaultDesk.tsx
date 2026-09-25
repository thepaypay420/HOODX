'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {encodeFunctionData,erc20Abi,formatEther,formatUnits,getAddress,isAddress,parseAbi,parseEther,zeroAddress,type Address,type Hash} from 'viem';
import {publicClient,useWallet} from '@/lib/wallet';
import {robinhood} from '@/lib/chain';
import {verifyProportionalRelease,type ProportionalRelease} from '@/lib/proportionalRelease';
import {proportionalAbi,readProportionalState,quoteProportionalBootstrap,quoteProportionalDeposit,quoteProportionalWithdrawal,prepareProportionalBootstrap,prepareProportionalDeposit,prepareProportionalWithdrawal,type ProportionalState} from '@/lib/proportionalQuote';
import {rebalanceControllerV3Abi,resolveVaultAuthority} from '@/lib/rebalanceController';
import {ProportionalCuratorDesk} from '@/components/ProportionalCuratorDesk';
import {TokenArt} from '@/components/TokenArt';
import {vaultMeta} from '@/lib/vaults';
const managementAbi=parseAbi(['function owner() view returns(address)','function weth() view returns(address)','function claimable(address,address) view returns(uint256)','function claim(address,address)','function emergencyRedeemInKind(uint256,address)','function setPaused(bool)']);
type JoinPlan=Awaited<ReturnType<typeof quoteProportionalDeposit>>|Awaited<ReturnType<typeof quoteProportionalBootstrap>>;
type ExitPlan=Awaited<ReturnType<typeof quoteProportionalWithdrawal>>;
type Review={state:ProportionalState;kind:'join';plan:JoinPlan}|{state:ProportionalState;kind:'exit';plan:ExitPlan};
type Asset={token:Address;symbol:string;decimals:number|undefined;balance:bigint;claim:bigint};
class PreviewInputError extends Error {}
const display=(value:bigint)=>Number(formatEther(value)).toLocaleString(undefined,{maximumFractionDigits:7});
const button='rounded-xl border border-teal-400/30 px-4 py-3 text-sm disabled:opacity-40';

export function ProportionalVaultDesk({release}:{release:ProportionalRelease}) {
  const meta=vaultMeta(release.slug);
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
  const heldCount=current?.balances.filter(balance=>balance>0n).length??0;
  const canBootstrap=!!current&&current.supply===0n&&!!address&&(current.owner.toLowerCase()===address.toLowerCase()||current.creator.toLowerCase()===address.toLowerCase());
  const seedShortfall=current?.supply===0n&&ethBalance<current.minFirstDeposit?current.minFirstDeposit-ethBalance:0n;
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
  useEffect(()=>{if(current?.supply===0n)setEth(formatEther(current.minFirstDeposit));},[current?.supply,current?.minFirstDeposit]);
  useEffect(()=>{setClock(Math.floor(Date.now()/1000));const id=setInterval(()=>setClock(Math.floor(Date.now()/1000)),1000);return()=>clearInterval(id);},[]);
  function invalidate(){generation.current++;setReview(undefined);}
  async function preview(kind:'join'|'exit',portion=percent){
    if(lock.current||!address)return;lock.current=true;setBusy(true);setMessage('Simulating the complete basket…');setReview(undefined);const ticket=++generation.current;
    try{
      await verifyProportionalRelease(publicClient,release);
      const snap=await readProportionalState(publicClient,release.vault,address);
      let amount=0n;
      if(kind==='join'){
        try{amount=parseEther(eth);}catch{throw new PreviewInputError('Enter a valid ETH amount.');}
        const balance=await publicClient.getBalance({address,blockNumber:snap.blockNumber});
        const minimum=snap.supply===0n?snap.minFirstDeposit:parseEther('0.02');
        if(amount<minimum)throw new PreviewInputError(`Minimum deposit is ${formatEther(minimum)} ETH.`);
        if(balance<amount)throw new PreviewInputError(`Wallet has ${display(balance)} ETH. Add ${display(amount-balance)} ETH plus gas to continue.`);
      }
      const result:Review=kind==='join'?{kind,state:snap,plan:snap.supply===0n?await quoteProportionalBootstrap(publicClient,snap,amount):await quoteProportionalDeposit(publicClient,snap,amount)}:{kind,state:snap,plan:await quoteProportionalWithdrawal(publicClient,snap,snap.walletShares*BigInt(portion)/100n)};
      if(ticket!==generation.current)return;
      setReview(result);setMessage('Review the amounts below. Nothing has been submitted.');
    }catch(error){if(ticket===generation.current)setMessage(error instanceof PreviewInputError?error.message:'The complete basket could not be quoted within its limits. Refresh and try again.');}
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
      const prepared=review.kind==='join'?('bootstrap'in review.plan?await prepareProportionalBootstrap(publicClient,review.state,review.plan):await prepareProportionalDeposit(publicClient,review.state,review.plan)):await prepareProportionalWithdrawal(publicClient,review.state,review.plan);
      const data=review.kind==='exit'
        ?encodeFunctionData({abi:proportionalAbi,functionName:'withdraw',args:[review.plan.shares,review.plan.minEthOut,review.plan.floors,review.plan.nonce,review.plan.deadline]})
        :'bootstrap'in review.plan
          ?encodeFunctionData({abi:proportionalAbi,functionName:'bootstrap',args:[review.plan.floors,review.plan.nonce,review.plan.deadline]})
          :encodeFunctionData({abi:proportionalAbi,functionName:'depositExactShares',args:[review.plan.shares,review.plan.budgets,review.plan.floors,review.plan.nonce,review.plan.deadline]});
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
      const tx=await walletClient.sendTransaction({to:request.address,data,account:address,chain:robinhood});remember(tx);setMessage('Submitted. Waiting for confirmation…');
      const receipt=await publicClient.waitForTransactionReceipt({hash:tx});resolved();if(receipt.status!=='success')throw Error('Reverted');
      await refresh();setMessage('Confirmed. Balances refreshed.');
    }catch{setMessage('Action not confirmed. Check any transaction link before retrying.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <div className="space-y-6">
    <section className="vault-actions desk">
      <div className="flex items-center gap-5">
        {meta&&<TokenArt slug={meta.slug} src={meta.image} alt={`${meta.symbol} vault`} priority/>}
        <div><p className="vault-eyebrow">{meta?`${meta.symbol} / ROBINHOOD CHAIN`:'HOODX / ROBINHOOD CHAIN'}</p><h1 className="text-4xl">{meta?.name??'Community basket'}</h1><p>{meta?.thesis??'Deposit ETH for a proportional share of every asset held.'}</p></div>
      </div>
      {meta&&<p className="pt-4 text-sm opacity-70">Smart market-cap weights · {meta.cashTarget}% WETH target · {meta.assets.length} assets</p>}
    </section>
    <section className="vault-actions desk"><div className="flex flex-wrap justify-between gap-4"><div><p className="vault-eyebrow">YOUR POSITION</p><h2 className="text-2xl">Join. Hold. Exit.</h2></div><div className="text-sm">Wallet: {display(ethBalance)} ETH<br/>{current?display(current.walletShares):'—'} shares</div></div>
      {!address?<button className={button} onClick={()=>void connect()}>Connect wallet</button>:chainId!==4663?<button className={button} onClick={()=>void switchToRobinhood()}>Switch to Robinhood Chain</button>:null}
      <div className="grid gap-5 py-6 md:grid-cols-2">
        <div className="vault-trade-card"><h3 className="text-xl">Deposit ETH</h3><label className="block py-3">Maximum ETH to spend<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4" inputMode="decimal" value={eth} disabled={busy} onChange={e=>{invalidate();setEth(e.target.value);}}/></label><div className="flex flex-wrap gap-2">{['0.02','0.05','0.08','0.1'].map(amount=><button key={amount} className={button} disabled={busy} onClick={()=>{invalidate();setEth(amount);}}>{amount}</button>)}</div><p className="pt-3 text-sm opacity-70">Minimum {current?.supply===0n?formatEther(current.minFirstDeposit):'0.02'} ETH. Keep additional ETH for gas.</p>{seedShortfall>0n&&<p className="py-2 text-sm text-amber-300">Add at least {display(seedShortfall)} ETH plus gas to seed this vault.</p>}<button className={button} disabled={busy||pending||!address||chainId!==4663||!current||current.paused||(current.supply===0n&&!canBootstrap)} onClick={()=>void preview('join')}>{current?.supply===0n?(canBootstrap?'Preview first deposit':'Awaiting curator seed'):'Preview deposit'}</button>{current?.paused&&<p>Deposits are paused.</p>}</div>
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
    <section className="vault-actions desk"><p className="vault-eyebrow">THE BASKET</p><h2 className="text-2xl">{current?(heldCount>0?`${heldCount} assets held`:`${meta?.assets.length??current.tokens.length} assets configured`):'Loading basket…'}</h2>{heldCount>0?<div className="divide-y divide-white/10">{assets.filter(a=>a.balance>0n).map((a,i)=><div key={a.token} className="flex justify-between gap-4 py-3 text-sm"><span className="truncate">{i+1}. {a.symbol}</span><span>{a.decimals===undefined?'—':Number(formatUnits(a.balance,a.decimals)).toLocaleString(undefined,{maximumFractionDigits:5})}</span></div>)}</div>:meta&&<div className="flex flex-wrap gap-2 py-4">{meta.assets.map(asset=><span key={asset} className="rounded-full border border-white/10 px-3 py-2 text-sm">{asset}</span>)}</div>}<p className="pt-3 text-sm opacity-70">{current?display(current.cash):'—'} ETH / WETH cash reserve. Reserved claims are excluded.</p><details className="pt-4 text-sm"><summary>How this basket works</summary><p className="py-3">Deposits follow the assets actually held. Curators rebalance with protected, atomic routes. Market losses, route failures and token restrictions remain possible.</p></details></section>
  </div>;
}
