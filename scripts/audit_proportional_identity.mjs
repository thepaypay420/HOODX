import fs from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const source = fs.readFileSync("script/ProportionalWatchlistV3.sol", "utf8");
const tokens = [...source.matchAll(/h\.tokenOut\s*=\s*address\(bytes20\(hex"([0-9a-f]{40})"\)\)/gi)]
  .map((match) => `0x${match[1].toLowerCase()}`);
const expectedSymbols = ["PONS","AI","CASHCAT","Index","MEME","STONKBROKER","PRISM","HOOKR","DELTA","SHROOM","BOW","UP","QUOTRON","NET","ZEAL","musebook","Aria","HARMONIC","QUOTIENT","PROMETHEUS","STELX"];
const blocked = new Set(["0x013940c3daa5e2bb12df1ea94afe47ce84c0db4f"]);
if (tokens.length !== expectedSymbols.length || new Set(tokens).size !== tokens.length) throw Error("Manifest extraction failed");
if (tokens.some((token) => blocked.has(token))) throw Error("Blocked legacy token remains in manifest");

const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 4663) throw Error("Wrong RPC chain");
const abi = parseAbi(["function name() view returns(string)","function symbol() view returns(string)","function decimals() view returns(uint8)"]);
const rows = [];
for (let i = 0; i < tokens.length; i++) {
  const token = tokens[i];
  const [name, symbol, decimals, response] = await Promise.all([
    client.readContract({ address: token, abi, functionName: "name" }),
    client.readContract({ address: token, abi, functionName: "symbol" }),
    client.readContract({ address: token, abi, functionName: "decimals" }),
    fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`, { signal: AbortSignal.timeout(15_000) }),
  ]);
  if (!response.ok) throw Error(`Market lookup failed for ${expectedSymbols[i]}`);
  const exact = (await response.json()).filter((pair) =>
    pair.baseToken?.address?.toLowerCase() === token || pair.quoteToken?.address?.toLowerCase() === token);
  const best = exact.sort((a,b) => Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0))[0];
  const identityMatches = symbol.toLowerCase() === expectedSymbols[i].toLowerCase();
  const liquid = Number(best?.liquidity?.usd || 0) >= 10_000;
  const active = Number(best?.volume?.h24 || 0) >= 100;
  rows.push({expectedSymbol:expectedSymbols[i],token,name,symbol,decimals,pair:best?.pairAddress ?? null,labels:best?.labels ?? [],liquidityUsd:Number(best?.liquidity?.usd || 0),volume24Usd:Number(best?.volume?.h24 || 0),identityMatches,liquid,active});
  if (!identityMatches || !liquid || !active) throw Error(`Identity/market check failed for ${expectedSymbols[i]}`);
}
const blockNumber = await client.getBlockNumber();
const report = {chainId:4663,checkedAt:new Date().toISOString(),blockNumber:String(blockNumber),blockedTokens:[...blocked],passed:true,rows};
const json = `${JSON.stringify(report,null,2)}\n`;
if (process.argv.includes("--write")) fs.writeFileSync("deployments/proportional-token-identity-audit-2026-09-27.json",json);
console.log(json);
