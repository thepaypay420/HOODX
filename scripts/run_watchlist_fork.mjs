/** Read-only Foundry runner. Upstream endpoint stays in process memory, never child arguments. */
import http from 'node:http';import {spawn} from 'node:child_process';import fs from 'node:fs';
const endpoint=process.env.ROBINHOOD_RPC_URL;if(!endpoint)throw Error('RPC configuration missing');delete process.env.ROBINHOOD_RPC_URL;
let tail=Promise.resolve();
const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req){body+=chunk;if(body.length>8000000){res.writeHead(413).end();return;}}
 const method=JSON.parse(body).method;if(!/^(eth_(call|get[A-Za-z]+|chainId|blockNumber)|net_version|web3_clientVersion|anvil_nodeInfo)$/.test(method)){res.writeHead(403).end('{"error":"read-only relay"}');return;}
 const perform=async()=>{for(let i=0;i<3;i++)try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.text();const parsed=JSON.parse(data);if(parsed.error)console.log('RPC method error:',JSON.parse(body).method,'code:',parsed.error.code);return data;}catch{if(i===2)throw Error('Upstream unavailable');await new Promise(r=>setTimeout(r,1000*(i+1)));}};
 const result=tail.then(perform);tail=result.catch(()=>{});try{const data=await result;res.writeHead(200,{'Content-Type':'application/json'}).end(data);}catch{res.writeHead(502).end('{"error":"upstream unavailable"}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const candidate=process.argv.includes('--proportional-candidate');
const proportional=process.argv.includes('--proportional');
const cl=process.argv.includes('--cl');
const matured=process.argv.includes('--matured');
const prices=process.argv.includes('--prices');
const quotron=process.argv.includes('--quotron');
const successor=process.argv.includes('--successor');
const pinnedArg=process.argv.find(a=>a.startsWith('--block='));
if(pinnedArg&&!/^--block=[1-9][0-9]*$/.test(pinnedArg))throw Error('Invalid fork block');
let forkBlock='0';if(pinnedArg){forkBlock=pinnedArg.slice(8);console.log('Pinned regression fork block:',forkBlock);}else if(successor){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})});const j=await r.json();if(!j.result)throw Error('Block unavailable');forkBlock=String(BigInt(j.result));console.log('Successor fork block:',forkBlock);}
const alternative=process.argv.includes('--alternative');
const diagnostic=process.argv.includes('--diagnostic');
const out=fs.openSync(candidate?'../outputs/proportional-candidate-fork.txt':proportional?'../outputs/proportional-join-fork.txt':cl?'../outputs/cl-oracle-fork.txt':matured?(process.argv.includes('--net-basket')?'../outputs/net-basket-fork.txt':process.argv.includes('--vault')?'../outputs/matured-vault-fork.txt':'../outputs/matured-oracle-fork.txt'):prices?'../outputs/price-sources-fork.txt':quotron?'../outputs/quotron-router-fork.txt':successor?(diagnostic?'../outputs/successor-diagnostics.txt':'../outputs/successor-watchlist-fork.txt'):alternative?'../outputs/watchlist-alternative-routes.txt':diagnostic?'../outputs/watchlist-route-diagnostics.txt':'../outputs/watchlist-protected-routes.txt','w');
const child=spawn('../work/foundry/forge.exe',['test','--match-contract',candidate?'ProportionalBasketForkTest':proportional?'ProportionalJoinForkTest':cl?'ClOracleForkTest':matured?'MaturedOracleForkTest':prices?'PriceSourcesForkTest':quotron?'QuotronRouterForkTest':successor?'SuccessorWatchlistForkTest':'WatchlistRoutesForkTest','--threads','1','--no-storage-caching',...(candidate?['--match-test','testProportionalFullWatchlistLifecycle',process.argv.includes('--trace')?'-vvvv':'-vv']:proportional?['--match-test','testResearch','-vv']:cl?['--match-test','testClNet','-vv']:matured?['--match-test',process.argv.includes('--net-basket')?'testMaturedNetBasket':process.argv.includes('--vault')?'testMatured(Basket|ZealV3|Prism)':'testMatured',process.argv.includes('--trace')?'-vvvv':'-vv']:quotron?['--match-test','test(CanonicalTaxedPrism|(CanonicalRouter|IntegratedQuote|IndependentOracle)RoundTrip)','-vvvv']:alternative?['--match-test','testSHROOMAlternative','-vv']:diagnostic?['--match-test',successor?'test(PRISM|NET)':'test(QUOTRON|SHROOM)Small','-vvvv']:['-vv'])],{env:{...process.env,ROBINHOOD_RPC_URL:`http://127.0.0.1:${server.address().port}`,HOODX_FORK_TEST:'true',HOODX_FORK_BLOCK:forkBlock},stdio:['ignore',out,out]});
child.on('error',()=>{console.log('Could not start Foundry');server.close();fs.closeSync(out);});
child.on('exit',code=>{console.log('Protected fork tests exit:',code);server.close();fs.closeSync(out);process.exitCode=code??1;});
