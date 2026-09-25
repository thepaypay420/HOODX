import { selectMarket } from "./holdingMarket";

type Market = ReturnType<typeof selectMarket>;
type Entry = { expires: number; value: Market | null };
const MAX_KEYS=512, MAX_BODY=1_000_000;
const cache=new Map<string,Entry>();
const pending=new Map<string,Promise<Market|null>>();

function remember(key:string,value:Market|null) {
  cache.delete(key);
  cache.set(key,{expires:Date.now()+(value?900_000:60_000),value});
  while(cache.size>MAX_KEYS)cache.delete(cache.keys().next().value!);
}

async function fetchMarket(token:string):Promise<Market|null> {
  try {
    const response=await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`,{signal:AbortSignal.timeout(6000),cache:"no-store"});
    if(!response.ok)return null;
    const declared=Number(response.headers.get("content-length")||0);
    if(declared>MAX_BODY)return null;
    const raw=await response.text();
    if(raw.length>MAX_BODY)return null;
    const pairs=JSON.parse(raw);
    if(!Array.isArray(pairs))return null;
    return selectMarket(pairs.slice(0,256),token);
  } catch{return null;}
}

/** Bounded LRU and in-flight deduplication prevent arbitrary addresses creating persistent cache keys. */
export async function getHoldingMarket(token:string) {
  const key=token.toLowerCase(), hit=cache.get(key);
  if(hit&&hit.expires>Date.now()){
    cache.delete(key);cache.set(key,hit);
    if(!hit.value)throw new Error("Market data unavailable");
    return hit.value;
  }
  if(hit)cache.delete(key);
  let promise=pending.get(key);
  if(!promise){promise=fetchMarket(key).finally(()=>pending.delete(key));pending.set(key,promise);}
  const result=await promise;remember(key,result);
  if(!result)throw new Error("Market data unavailable");
  return result;
}

export function holdingMarketCacheSizeForTests(){return cache.size;}
export function resetHoldingMarketCacheForTests(){cache.clear();pending.clear();}
