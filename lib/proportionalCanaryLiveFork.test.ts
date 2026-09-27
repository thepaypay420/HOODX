import {describe,expect,it} from 'vitest';
import {createPublicClient,createWalletClient,http,parseAbi,parseEther,zeroAddress,type Address} from 'viem';
import {
  proportionalAbi,
  readProportionalState,
  quoteProportionalDeposit,
  quoteProportionalWithdrawal,
  prepareProportionalDeposit,
  prepareProportionalWithdrawal,
} from './proportionalQuote';
import {robinhood} from './chain';

const enabled=process.env.HOODX_CANARY_LIFECYCLE_FORK==='1';
const rpc=process.env.HOODX_LOCAL_FORK_RPC??'http://127.0.0.1:8546';
const vault='0x64C9cBBa19B6f6A6D9646b0694F668BeA2501436' as Address;
const deployer='0xf63E63a80A25611154C5d1c06E55FD763E0cfC19' as Address;
const curator='0x134D468B0bcaeA6DF127916f951F7938c06A37C6' as Address;
const managementAbi=parseAbi([
  'function weth() view returns(address)',
  'function claimable(address,address) view returns(uint256)',
  'function claim(address,address)',
  'function emergencyRedeemInKind(uint256,address)',
  'function setPaused(bool)',
]);

const suite=enabled?describe:describe.skip;
suite('live 696X canary remaining lifecycle on a disposable fork',()=>{
  it('joins, partially exits, recovers in kind, resolves claims, and closes',async()=>{
    const transport=http(rpc,{timeout:120_000,retryCount:0});
    const client=createPublicClient({chain:robinhood,transport});
    expect(await client.getChainId()).toBe(4663);
    const anvilRequest=client.request as (request:{method:string;params:unknown[]})=>Promise<unknown>;
    for(const account of [curator,deployer]){
      await anvilRequest({method:'anvil_impersonateAccount',params:[account]});
      await anvilRequest({method:'anvil_setBalance',params:[account,'0xde0b6b3a7640000']});
    }
    const curatorWallet=createWalletClient({account:curator,chain:robinhood,transport});
    const deployerWallet=createWalletClient({account:deployer,chain:robinhood,transport});
    const now=async()=>Number((await client.getBlock()).timestamp);

    let state=await readProportionalState(client,vault,curator);
    expect(state.supply).toBeGreaterThan(0n);
    expect(state.walletShares).toBe(0n);
    expect(state.paused).toBe(false);
    const join=await quoteProportionalDeposit(client,state,parseEther('0.02'),()=>state.timestamp);
    await prepareProportionalDeposit(client,state,join);
    let hash=await curatorWallet.writeContract({address:vault,abi:proportionalAbi,functionName:'depositExactShares',args:[join.shares,join.budgets,join.floors,join.nonce,BigInt(await now()+300)],value:join.value});
    expect((await client.waitForTransactionReceipt({hash})).status).toBe('success');

    state=await readProportionalState(client,vault,curator);
    expect(state.walletShares).toBe(join.shares);
    const partialShares=state.walletShares/2n;
    const partial=await quoteProportionalWithdrawal(client,state,partialShares,()=>state.timestamp);
    await prepareProportionalWithdrawal(client,state,partial);
    hash=await curatorWallet.writeContract({address:vault,abi:proportionalAbi,functionName:'withdraw',args:[partial.shares,partial.minEthOut,partial.floors,partial.nonce,BigInt(await now()+300)]});
    expect((await client.waitForTransactionReceipt({hash})).status).toBe('success');

    hash=await curatorWallet.writeContract({address:vault,abi:managementAbi,functionName:'setPaused',args:[true]});
    expect((await client.waitForTransactionReceipt({hash})).status).toBe('success');
    state=await readProportionalState(client,vault,curator);
    expect(state.paused).toBe(true);
    expect(state.walletShares).toBe(join.shares-partialShares);

    hash=await curatorWallet.writeContract({address:vault,abi:managementAbi,functionName:'emergencyRedeemInKind',args:[state.walletShares,curator]});
    expect((await client.waitForTransactionReceipt({hash})).status).toBe('success');
    state=await readProportionalState(client,vault,curator);
    expect(state.walletShares).toBe(0n);

    const weth=await client.readContract({address:vault,abi:managementAbi,functionName:'weth'});
    for(const token of [...state.tokens,weth,zeroAddress]){
      const claim=await client.readContract({address:vault,abi:managementAbi,functionName:'claimable',args:[curator,token]});
      if(claim===0n) continue;
      hash=await curatorWallet.writeContract({address:vault,abi:managementAbi,functionName:'claim',args:[token,curator]});
      expect((await client.waitForTransactionReceipt({hash})).status).toBe('success');
    }

    const deployerState=await readProportionalState(client,vault,deployer);
    expect(deployerState.walletShares).toBe(deployerState.supply);
    const close=await quoteProportionalWithdrawal(client,deployerState,deployerState.walletShares,()=>deployerState.timestamp);
    await prepareProportionalWithdrawal(client,deployerState,close);
    hash=await deployerWallet.writeContract({address:vault,abi:proportionalAbi,functionName:'withdraw',args:[close.shares,close.minEthOut,close.floors,close.nonce,BigInt(await now()+300)]});
    expect((await client.waitForTransactionReceipt({hash})).status).toBe('success');

    const complete=await readProportionalState(client,vault,deployer);
    expect(complete.supply).toBe(0n);
    expect(complete.cash).toBe(0n);
    expect(complete.balances.every(value=>value===0n)).toBe(true);
    for(const token of [...complete.tokens,weth,zeroAddress]){
      expect(await client.readContract({address:vault,abi:managementAbi,functionName:'claimable',args:[curator,token]})).toBe(0n);
    }
  },300_000);
});
