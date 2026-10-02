'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {encodeFunctionData,erc20Abi,formatEther,formatUnits,getAddress,isAddress,parseAbi,parseEther,zeroAddress,type Address,type Hash} from 'viem';
import {publicClient,useWallet} from '@/lib/wallet';
import {robinhood} from '@/lib/chain';
import {verifyProportionalRelease,type ProportionalRelease} from '@/lib/proportionalRelease';
import {proportionalAbi,readProportionalState,quoteProportionalRebalance,quoteProportionalBootstrap,quoteProportionalDeposit,quoteProportionalWithdrawal,prepareProportionalBootstrap,prepareProportionalDeposit,prepareProportionalWithdrawal,type ProportionalState} from '@/lib/proportionalQuote';
import {rebalanceControllerV3Abi,resolveVaultAuthority} from '@/lib/rebalanceController';
import {V2CuratorDesk} from '@/components/V2CuratorDesk';
import {VaultOverview} from '@/components/VaultOverview';
import {VaultPerformance} from '@/components/VaultPerformance';
const managementAbi=parseAbi(['function owner() view returns(address)','function weth() view returns(address)','function claimable(address,address) view returns(uint256)','function claim(address,address)','function emergencyRedeemInKind(uint256,address)','function setPaused(bool)']);
type JoinPlan=Awaited<ReturnType<typeof quoteProportionalDeposit>>|Awaited<ReturnType<typeof quoteProportionalBootstrap>>;
type ExitPlan=Awaited<ReturnType<typeof quoteProportionalWithdrawal>>;
type Review={state:ProportionalState;kind:'join';plan:JoinPlan}|{state:ProportionalState;kind:'exit';plan:ExitPlan};
type Asset={token:Address;symbol:string;decimals:number|undefined;balance:bigint;claim:bigint};
class PreviewInputError extends Error {}
const display=(value:bigint)=>Number(formatEther(value)).toLocaleString(undefined,{maximumFractionDigits:7});
const button='vault-button';

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
  // No oracle NAV on a proportional vault: value it from live sell-quotes of every holding plus cash.
  const [estimate,setEstimate]=useState<{vault:Address;assets:bigint;time:number}>();
  const [curatorOpen,setCuratorOpen]=useState(false);
  const [tab,setTab]=useState<'deposit'|'withdraw'>('deposit');
  const lock=useRef(false),generation=useRef(0);
  const current=state?.account===(address??zeroAddress)&&state.vault===release.vault?state:undefined;
  const selected=current?current.walletShares*BigInt(percent)/100n:0n;
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
    const quoter=authority.controller;
    if(quoter)void Promise.all(next.tokens.map((token,i)=>next.balances[i]===0n?Promise.resolve(0n):quoteProportionalRebalance(publicClient,next,quoter,token,false,next.balances[i])))
      .then(values=>{if(ticket===generation.current)setEstimate({vault:release.vault,assets:next.cash+values.reduce((sum,v)=>sum+v,0n),time:Date.now()});})
      .catch(()=>{if(ticket===generation.current)setEstimate(undefined);});
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
      setReview(result);setMessage('');
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
  const isCurator=!!address&&owner?.toLowerCase()===address.toLowerCase();
  const valued=estimate?.vault===release.vault?estimate:undefined;
  const symbol=release.slug.toUpperCase();
  const onChain=!!address&&chainId===4663;
  const joinReady=ready&&review?.kind==='join'?review:undefined,exitReady=ready&&review?.kind==='exit'?review:undefined;
  const minimum=current?.supply===0n?formatEther(current.minFirstDeposit):'0.02';
  const trade=<section id="wallet-actions" className="vp-trade desk">
    <div className="vp-tabs" role="tablist">{(['deposit','withdraw'] as const).map(name=><button key={name} type="button" role="tab" aria-selected={tab===name} disabled={busy} onClick={()=>{invalidate();setMessage('');setTab(name);}}>{name==='deposit'?'Deposit':'Withdraw'}</button>)}</div>
    {tab==='deposit'?<>
      <label className="vp-field"><span className="vp-field-top"><span>You pay</span><span>{address?`Balance ${display(ethBalance)} ETH`:''}</span></span><span className="vp-amount"><input aria-label="ETH to deposit" inputMode="decimal" value={eth} disabled={busy} onChange={e=>{invalidate();setEth(e.target.value);}}/><b>ETH</b></span></label>
      <div className="vp-chips">{['0.02','0.05','0.1','0.25'].map(amount=><button key={amount} type="button" aria-pressed={eth===amount} disabled={busy} onClick={()=>{invalidate();setEth(amount);}}>{amount}</button>)}</div>
      {joinReady&&<dl className="vp-lines"><div><dt>You receive</dt><dd>{display(joinReady.plan.shares)} {symbol}</dd></div><div><dt>Estimated cost</dt><dd>{display(joinReady.plan.grossSpent)} ETH</dd></div><div><dt>Fee included</dt><dd>{display(joinReady.plan.fee)} ETH</dd></div><div><dt>Unused ETH returned</dt><dd>{display(joinReady.plan.ethRefund)} ETH</dd></div></dl>}
      {!address?<button className="vp-primary" onClick={()=>void connect()}>Connect wallet</button>
        :chainId!==4663?<button className="vp-primary" onClick={()=>void switchToRobinhood()}>Switch to Robinhood Chain</button>
        :joinReady?<button className="vp-primary" disabled={busy||pending} onClick={()=>void confirm()}>Confirm deposit</button>
        :<button className="vp-primary" disabled={busy||pending||!current||current.paused||(current.supply===0n&&!canBootstrap)} onClick={()=>void preview('join')}>{current?.paused?'Deposits paused':current?.supply===0n&&!canBootstrap?'Awaiting curator seed':busy?'Working…':'Review deposit'}</button>}
      {seedShortfall>0n&&address&&<p className="vp-hint is-warn">Add at least {display(seedShortfall)} ETH plus gas to seed this vault.</p>}
      <p className="vp-hint">{joinReady?'Leftover tokens from the buys are returned to you. Every buy keeps a protected minimum.':`One deposit buys the whole basket. Minimum ${minimum} ETH, plus gas.`}</p>
    </>:<>
      <div className="vp-field"><span className="vp-field-top"><span>You withdraw</span><span>{address?`Balance ${current?display(current.walletShares):'—'} ${symbol}`:''}</span></span><span className="vp-amount"><output>{display(selected)}</output><b>{symbol}</b></span></div>
      <div className="vp-chips">{[25,50,75,100].map(n=><button key={n} type="button" disabled={busy} aria-pressed={percent===n} onClick={()=>{invalidate();setPercent(n);if(onChain&&current&&current.walletShares>0n)void preview('exit',n);}}>{n===100?'Max':`${n}%`}</button>)}</div>
      {exitReady&&<dl className="vp-lines"><div><dt>You receive</dt><dd>≈ {display(exitReady.plan.quotedEth)} ETH</dd></div><div><dt>Protected minimum</dt><dd>{display(exitReady.plan.minEthOut)} ETH</dd></div></dl>}
      {!address?<button className="vp-primary" onClick={()=>void connect()}>Connect wallet</button>
        :chainId!==4663?<button className="vp-primary" onClick={()=>void switchToRobinhood()}>Switch to Robinhood Chain</button>
        :exitReady?<button className="vp-primary" disabled={busy||pending} onClick={()=>void confirm()}>Confirm withdrawal</button>
        :<button className="vp-primary" disabled={busy||pending||selected===0n} onClick={()=>void preview('exit')}>{busy?'Working…':selected===0n?'Nothing to withdraw':'Review withdrawal'}</button>}
      <p className="vp-hint">Sells your share of every holding for ETH in one transaction.</p>
    </>}
    {review&&!ready&&<p className="vp-hint is-warn">This quote has expired. Review again for a fresh one.</p>}
    {(message||hash||pending)&&<p className="vp-message" role="status" aria-live="polite">{message}{hash&&<> <a href={`https://robin.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></>}{pending&&<button className={button} disabled={busy} onClick={()=>void checkReceipt()}>Check pending transaction</button>}</p>}
    {assets.filter(a=>a.claim>0n).map(a=><div key={a.token} className="vp-claim"><span>{a.decimals===undefined?'Balance available':formatUnits(a.claim,a.decimals)} {a.symbol} to claim</span><button className={button} disabled={busy||pending||chainId!==4663||!recipient} onClick={()=>void manage('claim',a.token)}>Claim</button></div>)}
    <details className="vp-more"><summary>More options</summary>
      <div><h3>Withdraw as tokens</h3><p>Receive {percent}% of your position as the underlying tokens and cash, without selling. Works while deposits are paused. Transfers that cannot complete stay claimable.</p><label>Send to<input className="vault-input" value={recoveryRecipient} spellCheck={false} onChange={e=>setRecoveryRecipient(e.target.value.trim())}/></label>{recoveryRecipient&&!recipient&&<p className="is-warn">Enter a valid recipient address.</p>}<button className={button} disabled={busy||pending||!onChain||selected===0n||!recipient} onClick={()=>void manage('assets')}>Withdraw {percent}% as tokens</button></div>
      <div className="vp-more-row">{isCurator&&<button className={button} disabled={busy||pending||chainId!==4663} onClick={()=>void manage('pause')}>{current?.paused?'Resume deposits':'Pause deposits'}</button>}<button className={button} disabled={busy} onClick={()=>void refresh().catch(()=>setMessage('Unable to refresh balances.'))}>Refresh balances</button></div>
    </details>
  </section>;
  return <section className="vault-dashboard">
    <VaultOverview proportional vault={release.vault} slug={release.slug} assets={valued?.assets} quoteTime={valued?.time} supply={current?.supply} paused={current?.paused} curator={isCurator} aside={trade}>
      <VaultPerformance estimated vault={release.vault} symbol={symbol} account={address} assets={valued?.assets} shares={current?.walletShares} supply={current?.supply} block={current?.blockNumber}/>
    </VaultOverview>
    {isCurator&&current&&<details id="curator-workspace" className="vault-curator-panel" open={curatorOpen} onToggle={event=>setCuratorOpen(event.currentTarget.open)}><summary>Curator workspace <span>Allocation, rebalancing & basket management</span></summary>{curatorOpen&&<V2CuratorDesk proportional key={`${release.vault}:${address}:${controller??'direct'}`} vault={release.vault} controller={controller} paused={current.paused} busy={busy} onBusy={setBusy} onRefresh={refresh}/>}</details>}
  </section>;
}
