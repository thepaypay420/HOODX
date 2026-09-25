import { afterEach, describe, expect, it, vi } from "vitest";
import { getHoldingMarket, holdingMarketCacheSizeForTests, resetHoldingMarketCacheForTests } from "./holdingMarketServer";

afterEach(()=>{vi.unstubAllGlobals();resetHoldingMarketCacheForTests();});

describe("market-data cache griefing",()=>{
  it("negative-caches repeated random misses and deduplicates concurrent work",async()=>{
    const fetchMock=vi.fn(async()=>new Response("[]",{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const token="0x"+"1".padStart(40,"0");
    await Promise.all(Array.from({length:20},()=>getHoldingMarket(token).catch(()=>null)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getHoldingMarket(token).catch(()=>null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps attacker-controlled cache keys",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("[]",{status:200})));
    for(let i=1;i<=540;i++)await getHoldingMarket(`0x${i.toString(16).padStart(40,"0")}`).catch(()=>null);
    expect(holdingMarketCacheSizeForTests()).toBe(512);
  });

  it("rejects oversized upstream bodies before parsing",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("[]",{status:200,headers:{"content-length":"1000001"}})));
    await expect(getHoldingMarket("0x"+"2".padStart(40,"0"))).rejects.toThrow(/unavailable/);
  });
});
