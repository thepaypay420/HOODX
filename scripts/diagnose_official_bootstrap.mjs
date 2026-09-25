import {createPublicClient,http,parseAbi,BaseError,ContractFunctionRevertedError} from 'viem';
const client=createPublicClient({transport:http('https://rpc.mainnet.chain.robinhood.com')});
const curator='0x134D468B0bcaeA6DF127916f951F7938c06A37C6';
const vaults=(await import('../deployments/official-vault-live-2026-09-24.json',{with:{type:'json'}})).default.vaults;
const abi=parseAbi(['function constituents() view returns(address[])','function targetBps(address) view returns(uint16)','function creatorFeeBps() view returns(uint16)','function protocolFeeBps() view returns(uint16)','function planNonce() view returns(uint256)','function minFirstDeposit() view returns(uint256)','function totalSupply() view returns(uint256)','function quoteBuys(uint256[] budgets) payable','function bootstrap(uint256[] floors,uint256 nonce,uint256 deadline) payable returns(uint256)','error BuyQuote(uint256[] outputs)','error QuoteUnavailable()','error Invalid()','error RoutesUnavailable()']);
const block=await client.getBlock(); const stateOverride=[{address:curator,balance:1000000000000000000n}];
const results=[];
for(const [slug,entry] of Object.entries(vaults)){
 const address=entry.vault;
 const [tokens,cf,pf,nonce,min,supply]=await Promise.all(['constituents','creatorFeeBps','protocolFeeBps','planNonce','minFirstDeposit','totalSupply'].map(functionName=>client.readContract({address,abi,functionName,blockNumber:block.number})));
 const weights=await Promise.all(tokens.map(token=>client.readContract({address,abi,functionName:'targetBps',args:[token],blockNumber:block.number})));
 const value=20000000000000000n; const net=value*(10000n-BigInt(cf)-BigInt(pf))/10000n; const budgets=weights.map(w=>net*BigInt(w)/10000n); const funding=budgets.reduce((a,b)=>a+b,0n);
 let outputs;
 try{await client.simulateContract({address,abi,account:curator,functionName:'quoteBuys',args:[budgets],value:funding,blockNumber:block.number,stateOverride});throw new Error('quote unexpectedly succeeded');}
 catch(e){const rev=e instanceof BaseError?e.walk(x=>x instanceof ContractFunctionRevertedError):undefined;if(!(rev instanceof ContractFunctionRevertedError)||rev.data?.errorName!=='BuyQuote')throw e;outputs=rev.data.args[0];}
 const floors=outputs.map((x,i)=>budgets[i]===0n?0n:x*9700n/10000n);
 let bootstrap='PASS';
 try{await client.simulateContract({address,abi,account:curator,functionName:'bootstrap',args:[floors,nonce,block.timestamp+180n],value,blockNumber:block.number,stateOverride});}
 catch(e){bootstrap=e.shortMessage??e.message;}
 results.push({slug,assets:tokens.length,weights:weights.map(Number),quote:outputs.every(x=>x>0n)?'PASS':'FAIL',bootstrap});
}
console.log(JSON.stringify({block:String(block.number),timestamp:String(block.timestamp),results},null,2));
if(results.some(x=>x.quote!=='PASS'||x.bootstrap!=='PASS'))process.exit(1);
