import {describe,it,expect} from 'vitest';
import {buildProportionalPlan,buildProportionalWithdrawal,proportionalRequirements,type ProportionalSnapshot} from './proportionalPlan';
const E=10n**18n;
const snapshot:ProportionalSnapshot={supply:E,cash:E/4n,balances:[E,E],nonce:4n,blockNumber:123n,timestamp:1000,creatorFeeBps:40,protocolFeeBps:10};
const quotes=[{index:0,budget:E/10n,netOutput:E/10n,blockNumber:123n},{index:1,budget:E/10n,netOutput:E/10n,blockNumber:123n}];
describe('proportional candidate plans',()=>{
  it('rounds contributions up rather than diluting one-wei sleeves',()=>{expect(proportionalRequirements({...snapshot,balances:[1n,2n]},10n**12n).amounts).toEqual([1n,1n]);});
  it('keeps exact shares, positive floors, cash, fees and ETH refund consistent',()=>{
    const plan=buildProportionalPlan(snapshot,E/10n,E,quotes,1010);
    expect(plan.floors).toEqual([E/10n,E/10n]);expect(plan.grossSpent+plan.ethRefund).toBe(E);
    expect(plan.grossSpent-plan.fee).toBe(225n*10n**15n);expect(plan.nonce).toBe(4n);
  });
  it('rejects missing, duplicate, wrong-block and short quotes',()=>{
    for(const q of [quotes.slice(0,1),[quotes[0],quotes[0]],[quotes[0],{...quotes[1],blockNumber:122n}],[quotes[0],{...quotes[1],netOutput:1n}]])expect(()=>buildProportionalPlan(snapshot,E/10n,E,q,1010)).toThrow();
  });
  it('does not buy empty sleeves during a proportional join',()=>{
    const p=buildProportionalPlan({...snapshot,balances:[E,0n]},E/10n,E,[quotes[0]],1010);expect(p.budgets[1]).toBe(0n);
  });
  it('keeps the existing 3% quote floor when output exceeds required backing',()=>{
    const p=buildProportionalPlan(snapshot,E/10n,E,quotes.map(q=>({...q,netOutput:E/5n})),1010);
    expect(p.floors[0]).toBe(194n*10n**15n);expect(p.surplusTokens[0]).toBe(E/10n);
  });
  it('rejects stale, future, invalid-fee and unaffordable plans',()=>{
    expect(()=>buildProportionalPlan(snapshot,E/10n,E,quotes,1061)).toThrow();
    expect(()=>buildProportionalPlan(snapshot,E/10n,E,quotes,999)).toThrow();
    expect(()=>buildProportionalPlan({...snapshot,creatorFeeBps:51},E/10n,E,quotes,1010)).toThrow();
    expect(()=>buildProportionalPlan(snapshot,E/10n,E/10n,quotes,1010)).toThrow();
  });
});

describe('proportional withdrawals',()=>{
  const sales=[0,1].map(index=>({index,amount:E/2n,netEthOutput:E/10n,blockNumber:123n}));
  it('populates Max with exact holdings and a protected aggregate ETH minimum',()=>{
    const p=buildProportionalWithdrawal(snapshot,E/2n,E/2n,sales,1010);
    expect(p.amounts).toEqual([E/2n,E/2n]);expect(p.minEthOut).toBe(319n*10n**15n);
    expect(p.quotedEth).toBe(325n*10n**15n);
  });
  it('rejects changed quantities, missing routes, stale blocks and over-selling',()=>{
    for(const q of [sales.slice(0,1),[sales[0],sales[0]],[sales[0],{...sales[1],amount:1n}],[sales[0],{...sales[1],blockNumber:124n}]]) expect(()=>buildProportionalWithdrawal(snapshot,E/2n,E/2n,q,1010)).toThrow();
    expect(()=>buildProportionalWithdrawal(snapshot,E,E/2n,sales,1010)).toThrow();
    expect(()=>buildProportionalWithdrawal(snapshot,E/2n,E/2n,sales,1061)).toThrow();
  });
  it('supports a cash-only basket without fabricating token trades',()=>{
    const p=buildProportionalWithdrawal({...snapshot,balances:[0n,0n]},E,E,[],1010);
    expect(p.minEthOut).toBe(E/4n);expect(p.floors).toEqual([0n,0n]);
  });
});
