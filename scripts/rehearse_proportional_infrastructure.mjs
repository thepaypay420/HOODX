/** Local Anvil rehearsal of the exact successor infrastructure transaction sequence.
 * The private upstream RPC is held only by this process. Anvil receives a localhost
 * read-only relay, and no upstream transaction method is permitted.
 */
import httpServer from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {
  createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData,
  formatEther, http, parseAbi,
} from 'viem';

const upstream=process.env.ROBINHOOD_RPC_URL;
delete process.env.ROBINHOOD_RPC_URL;
if(!upstream)throw Error('RPC configuration missing');
const deployer='0xf63E63a80A25611154C5d1c06E55FD763E0cfC19';
const treasury='0x134D468B0bcaeA6DF127916f951F7938c06A37C6';
const pons='0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';
const qhook='0x62e200cc8e4d95cf622f40dd70f407c883ecb0cc';
const evidence='0x'+Buffer.from('SIMULATION_ONLY_NOT_LIVE_REVIEW').toString('hex').padEnd(64,'0').slice(0,64);
const anvilPort=18549;
const endpoint=`http://127.0.0.1:${anvilPort}`;
const chain={id:4663,name:'Robinhood fork rehearsal',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[endpoint]}}};
const artifact=name=>JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`,'utf8'));
const contracts={
  registry:artifact('HoodxHookRegistryV3'), executor:artifact('HoodxExecutorV3'),
  routing:artifact('HoodxRoutingV3'), fees:artifact('HoodxFeeModelV3'),
  policy:artifact('HoodxProportionalPolicyV3'), implementation:artifact('HoodxProportionalV3'),
  factory:artifact('HoodxProportionalFactoryV3'),
};

let tail=Promise.resolve();
const relay=httpServer.createServer(async(req,res)=>{
  let body='';for await(const chunk of req){body+=chunk;if(body.length>8_000_000){res.writeHead(413).end();return;}}
  let method;try{method=JSON.parse(body).method;}catch{res.writeHead(400).end();return;}
  if(!/^(eth_(call|get[A-Za-z]+|chainId|blockNumber|gasPrice|maxPriorityFeePerGas|feeHistory|estimateGas)|net_version|web3_clientVersion)$/.test(method)){
    res.writeHead(403).end('{"error":"read-only relay"}');return;
  }
  const perform=async()=>{for(let i=0;i<3;i++)try{
    const response=await fetch(upstream,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(25_000)});
    if(!response.ok)throw Error('upstream status');return await response.text();
  }catch{if(i===2)throw Error('upstream unavailable');await new Promise(r=>setTimeout(r,500*(i+1)));}};
  const result=tail.then(perform);tail=result.catch(()=>{});
  try{res.writeHead(200,{'Content-Type':'application/json'}).end(await result);}catch{res.writeHead(502).end('{"error":"upstream unavailable"}');}
});
await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
const relayUrl=`http://127.0.0.1:${relay.address().port}`;
const upstreamClient=createPublicClient({transport:http(relayUrl,{retryCount:1,timeout:25_000})});
const forkBlock=await upstreamClient.getBlockNumber();
const liveBalance=await upstreamClient.getBalance({address:deployer,blockNumber:forkBlock});
const liveGasPrice=await upstreamClient.getGasPrice();
const child=spawn('../work/foundry/anvil.exe',['--host','127.0.0.1','--port',String(anvilPort),'--chain-id','4663','--fork-url',relayUrl,'--fork-block-number',String(forkBlock),'--silent'],{stdio:'ignore',windowsHide:true});
const client=createPublicClient({chain,transport:http(endpoint,{retryCount:0})});
const wallet=createWalletClient({chain,transport:http(endpoint),account:deployer});
const rpc=async(method,params=[])=>client.request({method,params});
const receipts=[];let registry,executor,routing,fees,policy,implementation,factory;
try{
  let ready=false;for(let i=0;i<100;i++){try{ready=await client.getChainId()===4663;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready||child.exitCode!==null)throw Error('Local fork failed to start');
  await rpc('anvil_impersonateAccount',[deployer]);
  await rpc('anvil_setBalance',[deployer,'0x8ac7230489e80000']);
  const send=async(label,request)=>{
    const estimate=await client.estimateGas({account:deployer,...request});
    const hash=await wallet.sendTransaction({account:deployer,...request,gas:(estimate*125n+99n)/100n});
    const receipt=await client.waitForTransactionReceipt({hash});
    if(receipt.status!=='success')throw Error(`${label} reverted`);
    receipts.push({label,gasEstimate:String(estimate),gasUsed:String(receipt.gasUsed),contractAddress:receipt.contractAddress??undefined});
    return receipt.contractAddress;
  };
  registry=await send('deploy registry',{data:encodeDeployData({abi:contracts.registry.abi,bytecode:contracts.registry.bytecode.object,args:[deployer]})});
  const proposalAbi=parseAbi(['function propose(address,bytes32)','function DELAY() view returns(uint256)','function proposals(address) view returns(bytes32 codeHash,bytes32 evidence,uint256 readyAt)']);
  for(const [label,hook] of [['propose PONS hook',pons],['propose QUOTRON hook',qhook]])await send(label,{to:registry,data:encodeFunctionData({abi:proposalAbi,functionName:'propose',args:[hook,evidence]})});
  executor=await send('deploy executor',{data:encodeDeployData({abi:contracts.executor.abi,bytecode:contracts.executor.bytecode.object,args:['0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x8876789976decbfcbbbe364623c63652db8c0904','0x000000000022d473030f116ddee9f6b43ac78ba3','0x1f7d7550b1b028f7571e69a784071f0205fd2efa','0xf3334192d15450cdd385c8b70e03f9a6bd9e673b','0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',registry]})});
  routing=await send('deploy routing',{data:encodeDeployData({abi:contracts.routing.abi,bytecode:contracts.routing.bytecode.object,args:[executor,'0x42024fcfdb4f3089dd619a0cef0cd24e7b841c18',registry,'0x5a86828efd322bfb16d93cfed16ee9bc14940d7f',qhook]})});
  fees=await send('deploy fee model',{data:encodeDeployData({abi:contracts.fees.abi,bytecode:contracts.fees.bytecode.object,args:[routing,qhook,pons]})});
  policy=await send('deploy policy',{data:encodeDeployData({abi:contracts.policy.abi,bytecode:contracts.policy.bytecode.object,args:[deployer,routing]})});
  implementation=await send('deploy implementation',{data:encodeDeployData({abi:contracts.implementation.abi,bytecode:contracts.implementation.bytecode.object,args:[policy,fees]})});
  factory=await send('deploy factory',{data:encodeDeployData({abi:contracts.factory.abi,bytecode:contracts.factory.bytecode.object,args:[deployer,treasury,implementation]})});
  const delay=await client.readContract({address:registry,abi:proposalAbi,functionName:'DELAY'});
  const [pp,pq]=await Promise.all([pons,qhook].map(h=>client.readContract({address:registry,abi:proposalAbi,functionName:'proposals',args:[h]})));
  if(delay!==172800n||pp[2]===0n||pq[2]===0n)throw Error('Hook delay verification failed');
  const gas=receipts.reduce((sum,r)=>sum+BigInt(r.gasUsed),0n);
  const paddedGas=receipts.reduce((sum,r)=>sum+(BigInt(r.gasEstimate)*125n+99n)/100n,0n);
  const maxFeePerGas=liveGasPrice*2n;
  const report={status:'simulation-only-not-deployed',chainId:4663,rpcForkBlock:String(forkBlock),deployer,deployerBalanceWei:String(liveBalance),liveNonce:String(await upstreamClient.getTransactionCount({address:deployer,blockNumber:forkBlock})),simulatedTransactions:receipts.length,liveReceipts:0,gasUsed:String(gas),estimatedGasWithPadding:String(paddedGas),gasPriceWei:String(liveGasPrice),estimatedMaxFeePerGasWei:String(maxFeePerGas),estimatedInfrastructureCostWei:String(paddedGas*maxFeePerGas),estimatedInfrastructureCostEth:formatEther(paddedGas*maxFeePerGas),hookApprovalDelaySeconds:Number(delay),hookApprovalDelayStarted:false,simulatedAddresses:{registry,executor,routing,fees,policy,implementation,factory},transactions:receipts,notes:['Private RPC was exposed only to a localhost read-only relay.','All nine transactions executed only on a disposable Anvil fork.','Addresses are nonce-derived rehearsal addresses and are not live deployments.']};
  fs.writeFileSync('deployments/proportional-infrastructure-rehearsal.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({forkBlock:String(forkBlock),transactions:receipts.length,paddedGas:String(paddedGas),costEth:report.estimatedInfrastructureCostEth},null,2));
}finally{child.kill();relay.close();}
