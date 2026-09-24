import {describe,expect,it,vi} from 'vitest';
import {BaseError,ContractFunctionRevertedError,encodeErrorResult,keccak256,toHex,type PublicClient} from 'viem';
import {proportionalAbi,quoteProportionalDeposit,quoteProportionalWithdrawal,quoteProportionalRebalance,prepareProportionalDeposit,type ProportionalState} from './proportionalQuote';
const E=10n**18n;
const state:ProportionalState={vault:'0x0000000000000000000000000000000000000001',account:'0x0000000000000000000000000000000000000002',tokens:['0x0000000000000000000000000000000000000003','0x0000000000000000000000000000000000000004'],walletShares:E,supply:E,cash:E/4n,balances:[E,E],nonce:1n,blockNumber:100n,timestamp:1000,creatorFeeBps:40,protocolFeeBps:10,paused:false};
function response(name:'BuyQuote'|'WithdrawalQuote'|'RebalanceQuote',outputs:readonly bigint[],cash=0n) {
  const data=name==='BuyQuote'?encodeErrorResult({abi:proportionalAbi,errorName:name,args:[outputs]}):name==='WithdrawalQuote'?encodeErrorResult({abi:proportionalAbi,errorName:name,args:[cash,outputs]}):encodeErrorResult({abi:proportionalAbi,errorName:name,args:[outputs[0]]});
  return new BaseError('call reverted',{cause:new ContractFunctionRevertedError({abi:proportionalAbi,data,functionName:name==='BuyQuote'?'quoteBuys':name==='WithdrawalQuote'?'quoteWithdrawal':'quoteRebalance'})});
}
describe('vault-native quote adapter',()=>{
  it('decodes the always-reverting buys and pins every probe to one block',async()=>{
    const simulateContract=vi.fn(async(p:{args:[readonly bigint[]];blockNumber:bigint;value:bigint})=>{
      expect(p.blockNumber).toBe(100n);expect(p.value).toBe(p.args[0].reduce((s,b)=>s+b,0n));throw response('BuyQuote',p.args[0]);
    });
    const plan=await quoteProportionalDeposit({simulateContract} as unknown as PublicClient,state,E,()=>1010);
    expect(plan.shares).toBeGreaterThan(0n);expect(simulateContract.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it('derives full-withdrawal fields from actual sale outputs',async()=>{
    const client={simulateContract:vi.fn(async()=>{throw response('WithdrawalQuote',[E/10n,E/10n],E/4n);})} as unknown as PublicClient;
    const plan=await quoteProportionalWithdrawal(client,state,E,()=>1010);
    expect(plan.minEthOut).toBe(444n*10n**15n);expect(plan.shares).toBe(state.walletShares);
  });
  it('fails closed on ordinary RPC errors, unexpected success, or mismatched cash',async()=>{
    await expect(quoteProportionalDeposit({simulateContract:async()=>{throw Error('provider');}} as unknown as PublicClient,state,E,()=>1010)).rejects.toThrow('could not be quoted');
    await expect(quoteProportionalDeposit({simulateContract:async()=>({})} as unknown as PublicClient,state,E,()=>1010)).rejects.toThrow('unexpectedly succeeded');
    await expect(quoteProportionalWithdrawal({simulateContract:async()=>{throw response('WithdrawalQuote',[E,E],0n);}} as unknown as PublicClient,state,E,()=>1010)).rejects.toThrow('Invalid quote');
  });
  it('simulates the real protected transaction and refuses stale signing',async()=>{
    const plan=await quoteProportionalDeposit({simulateContract:async(p:{args:[bigint[]]})=>{throw response('BuyQuote',p.args[0]);}} as unknown as PublicClient,state,E,()=>1010);
    const simulateContract=vi.fn(async()=>({request:{}}));
    const client={getChainId:async()=>4663,getBlock:async()=>({timestamp:1011n,number:101n}),readContract:async()=>keccak256(toHex('HOODX_PROPORTIONAL_V1')),simulateContract};
    await prepareProportionalDeposit(client as unknown as PublicClient,state,plan);
    expect(simulateContract).toHaveBeenCalledWith(expect.objectContaining({functionName:'depositExactShares',value:E,args:[plan.shares,plan.budgets,plan.floors,plan.nonce,plan.deadline]}));
    client.getBlock=async()=>({timestamp:1061n,number:102n});
    await expect(prepareProportionalDeposit(client as unknown as PublicClient,state,plan)).rejects.toThrow('Refresh');
  });
  it('decodes an exact rebalance leg and pins its snapshot block',async()=>{
    const simulateContract=vi.fn(async()=>{throw response('RebalanceQuote',[E/3n]);});
    await expect(quoteProportionalRebalance({simulateContract} as unknown as PublicClient,state,state.tokens[0],true,E/2n)).resolves.toBe(E/3n);
    expect(simulateContract).toHaveBeenCalledWith(expect.objectContaining({functionName:'quoteRebalance',blockNumber:100n,value:E/2n}));
  });
});
