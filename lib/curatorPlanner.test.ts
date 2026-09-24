import { describe, expect, it } from "vitest";
import { capBuyPlan, distribute, plannedTrade, raiseCashFromLeaders, restorePlan, driftBps, groupedAllocation, skippedAtMinimumDeposit } from "./curatorPlanner";
import { allocation } from "./v2Allocation";
describe("curator planning", () => {
  it("flags only nonzero sleeves below the exact minimum after fees",()=>{
    expect(skippedAtMinimumDeposit("0",50)).toBe(false);
    expect(skippedAtMinimumDeposit("0.50",0)).toBe(false);
    expect(skippedAtMinimumDeposit("0.50",50)).toBe(true);
    expect(skippedAtMinimumDeposit("0.51",50)).toBe(false);
  });
  it("budgets core and discovery separately while preserving excluded tokens and locks",()=>{
    const w=groupedAllocation("25","10",["30","30","5","10","0"],[true,false,false,false,false],["Core","Core","Discovery","Discovery","Excluded"]);
    expect(w).toEqual(["30.00","35.00","5.00","5.00","0.00"]);
    expect(allocation("25",w).weights.reduce((a,b)=>a+b,0)).toBe(7500);
    expect(()=>groupedAllocation("25","10",["75"],[],["Core"])).toThrow();
  });
  it("preserves locked weights and zero targets when normalizing", () => {
    const w = distribute("25", ["20", "10", "30", "0"], [true, false, false, false]);
    expect(w).toEqual(["20.00", "13.75", "41.25", "0.00"]);
    expect(allocation("25", w).cashBps).toBe(2500);
  });
  it("distributes indivisible basis points exactly across large baskets", () => {
    for (let n=2;n<=24;n++) expect(allocation("25", distribute("25", Array(n).fill("1"), [], true)).weights.reduce((a,b)=>a+b,0)).toBe(7500);
    expect(() => distribute("25", ["80", "0"], [true,false])).toThrow();
  });
  it("sizes sales from free holdings, and never treats unavailable valuations as zero", () => {
    expect(plannedTrade(200n, 100n, 1000n, "5")).toEqual({buy:false,amount:100n,value:50n});
    expect(plannedTrade(200n, undefined, 1000n, "5")).toBeUndefined();
    expect(driftBps(undefined,1000n,"5")).toBeUndefined();
    expect(plannedTrade(200n,100n,1000n,"0")?.amount).toBe(200n);
  });
  it("rejects drafts from changed baskets and targets", () => {
    const raw=JSON.stringify({version:1,tokens:["0xaa"],baseline:"a",cash:"25",weights:["75"]});
    expect(restorePlan(raw,["0xAA"],"a").weights).toEqual(["75"]);
    expect(()=>restorePlan(raw,["0xbb"],"a")).toThrow();
    expect(()=>restorePlan(raw,["0xaa"],"b")).toThrow();
  });
  it("raises cash only from assets currently leading their targets", () => {
    const result=raiseCashFromLeaders("25",["20","20","20","15"],[2300,1800,2200,1400],"5");
    expect(result.cash).toBe("30.00");
    expect(result.leaders).toEqual([0,2]);
    expect(result.weights[1]).toBe("20.00");
    expect(result.weights[3]).toBe("15.00");
    expect(allocation(result.cash,result.weights).weights.reduce((a,b)=>a+b,0)).toBe(7000);
    expect(()=>raiseCashFromLeaders("25",["25","25","25"],[2500,2400,2300],"5")).toThrow(/above/);
    expect(()=>raiseCashFromLeaders("48",["52"],[6000],"5")).toThrow(/50%/);
  });
  it("caps a deploy-cash plan without changing trade proportions",()=>{
    const capped=capBuyPlan([{amount:100n,value:100n},{amount:300n,value:300n}],200n);
    expect(capped).toEqual([{amount:50n,value:50n},{amount:150n,value:150n}]);
    expect(capBuyPlan([{amount:1n,value:1n}],0n)).toEqual([]);
  });
});
