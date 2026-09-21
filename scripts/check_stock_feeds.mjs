/** Read-only candidate inspection. This report never approves an oracle. */
import fs from 'node:fs';
import {createPublicClient,http,parseAbi} from 'viem';
const candidates=[
 ['GOOGL','0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3','0xF6f373a037c30F0e5010d854385cA89185AE638b'],
 ['AMZN','0x12f190a9F9d7D37a250758b26824B97CE941bF54','0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C'],
 ['AAPL','0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9','0x6B22A786bAa607d76728168703a39Ea9C99f2cD0'],
 ['META','0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35','0x7C38C00C30BEe9378381E7B6135d7283356D71b1'],
 ['ETH',null,'0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9'],
];
const abi=parseAbi(['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)','function description() view returns(string)','function symbol() view returns(string)','function oraclePaused() view returns(bool)','function uiMultiplier() view returns(uint256)']);
async function main(){
 if(!process.env.ROBINHOOD_RPC_URL)throw Error('Missing RPC');
 const c=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL,{retryCount:1,timeout:20000})});
 if(await c.getChainId()!==4663)throw Error('Wrong chain');
 const block=await c.getBlock();
 const report={chainId:4663,block:block.number,at:block.timestamp,approved:false,source:'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json',limitations:['Token identity and multiplier compatibility not approved.','NFLX feed not found in directory.','Robinhood sequencer uptime feed not listed in Chainlink supported network directory.'],feeds:[]};
 for(const [symbol,token,feed] of candidates){
  const row={symbol,token,feed};
  for(const [address,methods] of [[feed,['description','decimals','latestRoundData']],...(token?[[token,['symbol','decimals','oraclePaused','uiMultiplier']]]:[])])for(const functionName of methods){
   const key=(address===feed?'feed_':'token_')+functionName;
   try{row[key]=await c.readContract({address,abi,functionName,blockNumber:block.number});}catch{row[key]={readFailed:true};}
  }
  if(Array.isArray(row.feed_latestRoundData))row.ageSeconds=block.timestamp-row.feed_latestRoundData[3];
  report.feeds.push(row);
 }
 const json=JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2);
 fs.writeFileSync('deployments/stock-feed-candidates.json',json+'\n');console.log(json);
}
main().catch(()=>{console.error('Feed inspection failed; private connection details suppressed.');process.exitCode=1;});
