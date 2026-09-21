import { percentBps } from "./v2Allocation";

// Largest-remainder allocation keeps the total exact, including locked entries.
export function distribute(cash: string, weights: string[], locked: boolean[], equal = false): string[] {
  const reserve = percentBps(cash);
  if (reserve < 2000 || reserve > 5000) throw new Error("Cash must stay between 20% and 50%.");
  const values = weights.map(percentBps);
  const remainder = 10000 - reserve - values.reduce((sum, v, i) => sum + (locked[i] ? v : 0), 0);
  if (remainder < 0) throw new Error("Locked weights leave too little room for cash.");
  const indices = values.map((_, i) => i).filter(i => !locked[i] && (equal || values[i] > 0));
  if (!indices.length) throw new Error("Unlock at least one active asset to distribute the remainder.");
  const total = indices.reduce((sum, i) => sum + (equal ? 1 : values[i]), 0);
  const portions = indices.map(i => ({ i, value: Math.floor(remainder * (equal ? 1 : values[i]) / total), fraction: remainder * (equal ? 1 : values[i]) % total }));
  let left = remainder - portions.reduce((sum, p) => sum + p.value, 0);
  portions.sort((a, b) => b.fraction - a.fraction || a.i - b.i).forEach(p => { if (left > 0) { p.value++; left--; } });
  portions.forEach(p => { values[p.i] = p.value; });
  return values.map(v => (v / 100).toFixed(2));
}

export function driftBps(value: bigint | undefined, nav: bigint | undefined, target: string): number | undefined {
  if (value === undefined || !nav) return undefined;
  return Number(value * 10000n / nav) - percentBps(target);
}

export function plannedTrade(balance: bigint, value: bigint | undefined, nav: bigint | undefined, target: string) {
  if (value === undefined || !nav) return undefined;
  const desired = nav * BigInt(percentBps(target)) / 10000n;
  if (desired === value) return undefined;
  const buy = desired > value;
  const delta = buy ? desired - value : value - desired;
  const amount = buy ? delta : value > 0n ? balance * delta / value : 0n;
  return amount > 0n ? { buy, amount, value: delta } : undefined;
}

export type AllocationGroup = "Core" | "Discovery" | "Excluded";
export function skippedAtMinimumDeposit(weight: string, feesBps: number) {
  const bps=percentBps(weight);
  const gross=20000000000000000n;
  const net=gross-gross*BigInt(feesBps)/10000n;
  return bps>0&&net*BigInt(bps)/10000n<100000000000000n;
}
export function groupedAllocation(cash: string, discovery: string, weights: string[], locked: boolean[], groups: AllocationGroup[]) {
  if(groups.length!==weights.length||groups.some(g=>!["Core","Discovery","Excluded"].includes(g))) throw new Error("Assign a group to each asset first.");
  const reserve=percentBps(cash), satellite=percentBps(discovery);
  if(reserve<2000||reserve>5000||satellite>10000-reserve) throw new Error("Group budgets must fit inside the asset allocation after cash.");
  const result=weights.map(percentBps);
  for(const [group,budget] of [["Core",10000-reserve-satellite],["Discovery",satellite],["Excluded",0]] as const) {
    const members=result.map((_,i)=>i).filter(i=>groups[i]===group);
    const remaining=budget-members.reduce((sum,i)=>sum+(locked[i]?result[i]:0),0);
    const free=members.filter(i=>!locked[i]);
    if(remaining<0||(!free.length&&remaining!==0))throw new Error(`Unlock or assign assets in ${group} to fit its budget.`);
    free.forEach((i,j)=>{result[i]=Math.floor(remaining/free.length)+(j<remaining%free.length?1:0);});
  }
  return result.map(v=>(v/100).toFixed(2));
}

export function restorePlan(raw: string, tokens: string[], baseline: string) {
  const p = JSON.parse(raw);
  if (p.version !== 1 || p.baseline !== baseline || !Array.isArray(p.tokens) || p.tokens.length !== tokens.length || p.tokens.some((t: unknown, i: number) => typeof t !== "string" || t.toLowerCase() !== tokens[i].toLowerCase())) throw new Error("The basket or saved targets changed. Start a fresh plan.");
  if (typeof p.cash !== "string" || !Array.isArray(p.weights) || p.weights.length !== tokens.length || p.weights.some((v: unknown) => typeof v !== "string")) throw new Error("This draft is invalid.");
  percentBps(p.cash); p.weights.forEach(percentBps);
  if(p.groups!==undefined&&(!Array.isArray(p.groups)||p.groups.length!==tokens.length||p.groups.some((g:unknown)=>!["Core","Discovery","Excluded"].includes(String(g)))))throw new Error("Invalid saved asset groups.");
  if(p.locked!==undefined&&(!Array.isArray(p.locked)||p.locked.length!==tokens.length||p.locked.some((v:unknown)=>typeof v!=="boolean")))throw new Error("Invalid saved locks.");
  if(p.discovery!==undefined)percentBps(p.discovery);
  return { cash: p.cash as string, weights: p.weights as string[], groups:p.groups as AllocationGroup[]|undefined,locked:p.locked as boolean[]|undefined,discovery:p.discovery as string|undefined };
}
