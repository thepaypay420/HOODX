import {describe, expect, it} from 'vitest';
import {solveProportionalDeposit} from './proportionalSolver';
import {proportionalRequirements, type ProportionalSnapshot} from './proportionalPlan';
const E=10n**18n;
const state:ProportionalSnapshot={supply:E,cash:E/4n,balances:[E,E*100n],nonce:1n,blockNumber:100n,timestamp:1000,creatorFeeBps:40,protocolFeeBps:10};
describe('affordable proportional shares',()=>{
  it('reallocates unequal-cost sleeves without an oracle and stays within the ETH budget',async()=>{
    let calls=0;
    const plan=await solveProportionalDeposit(state,E,async budgets=>{calls++;return [budgets[0]*2n,budgets[1]*50n];},()=>1010);
    const needed=proportionalRequirements(state,plan.shares);
    expect(calls).toBeLessThanOrEqual(4);expect(plan.shares).toBeGreaterThan(0n);
    expect(plan.grossSpent).toBeLessThanOrEqual(E);
    expect(plan.floors.every((f,i)=>f>=needed.amounts[i])).toBe(true);
    expect(plan.budgets[1]).toBeGreaterThan(plan.budgets[0]*3n);
  });
  it('handles 20 assets with transfer taxes and nonlinear price impact',async()=>{
    const s={...state,balances:Array.from({length:20},(_,i)=>E*BigInt(i+1))};
    const p=await solveProportionalDeposit(s,E,async budgets=>budgets.map((b,i)=>b*BigInt(i+1)*97n*E/(100n*(E+b))),()=>1010);
    expect(p.floors.length).toBe(20);expect(p.floors.every(f=>f>0n)).toBe(true);expect(p.grossSpent).toBeLessThanOrEqual(E);
  });
  it('never silently skips a failed or zero-output held asset',async()=>{
    await expect(solveProportionalDeposit(state,E,async()=>[1n,0n],()=>1010)).rejects.toThrow('Incomplete');
    await expect(solveProportionalDeposit(state,E,async()=>{throw Error('route failed');},()=>1010)).rejects.toThrow('route failed');
  });
  it('rejects a quote that becomes stale during the solver',async()=>{
    let time=1010;
    await expect(solveProportionalDeposit(state,E,async b=>{time=1100;return [...b];},()=>time)).rejects.toThrow('Refresh');
  });
  it('does not buy empty sleeves, and handles a cash-only basket without RPC calls',async()=>{
    const p=await solveProportionalDeposit({...state,balances:[0n,0n]},E,async()=>{throw Error('must not call');},()=>1010);
    expect(p.budgets).toEqual([0n,0n]);expect(p.grossSpent).toBe(E);
  });
});
