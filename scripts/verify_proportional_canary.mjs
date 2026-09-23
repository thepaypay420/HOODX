import {createPublicClient,getAddress,http,keccak256,parseAbi,toBytes,zeroAddress} from 'viem';

const RPC=process.env.ROBINHOOD_RPC_URL;
if(!RPC) throw new Error('ROBINHOOD_RPC_URL is required');
const expected=(process.env.HOODX_CANARY_EXPECT??'inspect').toLowerCase();
if(!['inspect','empty','bootstrapped','participant','participant-recovered','complete'].includes(expected)) throw new Error('Invalid HOODX_CANARY_EXPECT');

const addresses={
  deployer:getAddress('0xf63E63a80A25611154C5d1c06E55FD763E0cfC19'),
  curator:getAddress('0x134D468B0bcaeA6DF127916f951F7938c06A37C6'),
  registry:getAddress('0xa46150E972Da054f9b954D7a695476A6258A4705'),
  policy:getAddress('0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21'),
  feeModel:getAddress('0xE274bc33C5dCD3Ee1dd603a3e08509E46c2B3dFb'),
  executor:getAddress('0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750'),
  routing:getAddress('0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE'),
  implementation:getAddress('0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7'),
  factory:getAddress('0xb0a89074d2f88207698aC99f39061463eeabeC8a'),
  weth:getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
};
const expectedTokens=['0x39dbed3a2bd333467115de45665cc57f813c4571','0x2e8c31162b855a2ffa90f6f8634643ad6f111e18','0x020bfc650a365f8bb26819deaabf3e21291018b4','0x56910d4409f3a0c78c64dd8d0545ff0705389870','0x385f4f8ae47651ce5f58f5265395a669f8281e18','0xe934e36a439c94017b64a3fece66af12099abf50','0x20024e485c0b22b42855589700721b28320a7777','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','0xe8ffd7e24187f72afb08d75b1bb13088a989a791','0xab093def657f15df31b33922a95e047add645b29','0x451b42a15100c340ca12f7c66de06fac5ea2d751','0x57c0e45cb534413d1c20a4240955d6bb250bb4f1','0x5a86828efd322bfb16d93cfed16ee9bc14940d7f','0xca9c78dd337a67f6e0077f65f5e9218719d30edf','0x9fa1c5e90a11294f83a9f135b81ad1b537a5ffdc','0x0762c1708f0d23f86b29d6b857121ff7df357506','0xa74a94c15b95f8d5f3abdd2db00f6c7384037b55','0xdee52f2ab639b6942b0d0f0565400b93b7a0fbe5','0x013940c3daa5e2bb12df1ea94afe47ce84c0db4f','0x20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261'].map(getAddress);
const factoryAbi=parseAbi(['function bySlug(string) view returns(address)','function implementation() view returns(address)']);
const vaultAbi=parseAbi(['function accountingMode() pure returns(bytes32)','function policy() view returns(address)','function feeModel() view returns(address)','function executor() view returns(address)','function weth() view returns(address)','function owner() view returns(address)','function creator() view returns(address)','function creatorRecipient() view returns(address)','function treasury() view returns(address)','function creatorFeeBps() view returns(uint16)','function protocolFeeBps() view returns(uint16)','function cashTargetBps() view returns(uint16)','function minFirstDeposit() view returns(uint256)','function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function paused() view returns(bool)','function planNonce() view returns(uint256)','function constituents() view returns(address[])','function configId(address) view returns(bytes32)','function targetBps(address) view returns(uint16)','function freeBalance(address) view returns(uint256)','function claimable(address,address) view returns(uint256)']);
const policyAbi=parseAbi(['function config(bytes32) view returns(address,address,bytes,bytes)']);
const erc20Abi=parseAbi(['function balanceOf(address) view returns(uint256)']);
const client=createPublicClient({transport:http(RPC,{timeout:30_000,retryCount:2})});
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

assert(await client.getChainId()===4663,'Wrong chain');
const block=await client.getBlock();
const [vault,implementation]=await Promise.all([
  client.readContract({address:addresses.factory,abi:factoryAbi,functionName:'bySlug',args:['696xcanary'],blockNumber:block.number}),
  client.readContract({address:addresses.factory,abi:factoryAbi,functionName:'implementation',blockNumber:block.number}),
]);
assert(vault!==zeroAddress,'Canary does not exist');
assert(same(implementation,addresses.implementation),'Factory implementation changed');
const code=await client.getCode({address:vault,blockNumber:block.number});
const clone=`0x363d3d373d3d363d73${addresses.implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`.toLowerCase();
assert(code?.toLowerCase()===clone,'Clone runtime changed');
const read=(functionName,args=[])=>client.readContract({address:vault,abi:vaultAbi,functionName,args,blockNumber:block.number});
const [mode,policy,feeModel,executor,weth,owner,creator,recipient,treasury,creatorFee,protocolFee,cashTarget,minFirst,supply,deployerShares,curatorShares,paused,nonce,tokens]=await Promise.all([
  read('accountingMode'),read('policy'),read('feeModel'),read('executor'),read('weth'),read('owner'),read('creator'),read('creatorRecipient'),read('treasury'),read('creatorFeeBps'),read('protocolFeeBps'),read('cashTargetBps'),read('minFirstDeposit'),read('totalSupply'),read('balanceOf',[addresses.deployer]),read('balanceOf',[addresses.curator]),read('paused'),read('planNonce'),read('constituents'),
]);
assert(mode===keccak256(toBytes('HOODX_PROPORTIONAL_V1')),'Accounting mode changed');
for(const [actual,wanted,label] of [[policy,addresses.policy,'policy'],[feeModel,addresses.feeModel,'fee model'],[executor,addresses.executor,'executor'],[weth,addresses.weth,'WETH'],[owner,addresses.curator,'owner'],[creator,addresses.deployer,'creator'],[recipient,addresses.curator,'recipient'],[treasury,addresses.curator,'treasury']]) assert(same(actual,wanted),`${label} changed`);
assert(creatorFee===40&&protocolFee===10&&cashTarget===2500&&minFirst===20_000_000_000_000_000n,'Economics changed');
assert(tokens.length===20&&tokens.every((token,i)=>same(token,expectedTokens[i])),'Constituent order changed');

const rows=[];
for(const token of tokens){
  const [id,target,free,actualBalance,deployerClaim,curatorClaim]=await Promise.all([read('configId',[token]),read('targetBps',[token]),read('freeBalance',[token]),client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[vault],blockNumber:block.number}),read('claimable',[addresses.deployer,token]),read('claimable',[addresses.curator,token])]);
  const [admitted,oracle,buy,sell]=await client.readContract({address:addresses.policy,abi:policyAbi,functionName:'config',args:[id],blockNumber:block.number});
  assert(same(admitted,token)&&oracle===zeroAddress&&buy.length>2&&sell.length>2,'Route admission changed');
  assert(target===375,'Target changed');
  rows.push({token,id,target,free,actualBalance,deployerClaim,curatorClaim});
}
const [freeWeth,freeNative,deployerWethClaim,deployerNativeClaim,curatorWethClaim,curatorNativeClaim,actualWeth,actualNative]=await Promise.all([read('freeBalance',[addresses.weth]),read('freeBalance',[zeroAddress]),read('claimable',[addresses.deployer,addresses.weth]),read('claimable',[addresses.deployer,zeroAddress]),read('claimable',[addresses.curator,addresses.weth]),read('claimable',[addresses.curator,zeroAddress]),client.readContract({address:addresses.weth,abi:erc20Abi,functionName:'balanceOf',args:[vault],blockNumber:block.number}),client.getBalance({address:vault,blockNumber:block.number})]);

const allFreeZero=rows.every(row=>row.free===0n)&&freeWeth===0n&&freeNative===0n;
const allClaimsZero=rows.every(row=>row.deployerClaim===0n&&row.curatorClaim===0n)&&deployerWethClaim===0n&&deployerNativeClaim===0n&&curatorWethClaim===0n&&curatorNativeClaim===0n;
if(expected==='empty') assert(supply===0n&&allFreeZero,'Canary is not empty');
if(expected==='bootstrapped') assert(supply>0n&&deployerShares===supply&&rows.every(row=>row.free>0n)&&freeWeth>0n,'Bootstrap state mismatch');
if(expected==='participant') assert(supply>deployerShares&&curatorShares>0n,'Participant position missing');
if(expected==='participant-recovered') assert(curatorShares===0n&&deployerShares===supply&&paused,'Participant recovery incomplete');
if(expected==='complete'){
  assert(supply===0n&&deployerShares===0n&&curatorShares===0n&&allFreeZero&&allClaimsZero,'Canary recovery incomplete');
  assert(rows.every(row=>row.actualBalance===0n)&&actualWeth===0n&&actualNative===0n,'Vault balance remains');
  for(const token of [...tokens,addresses.weth]){
    const [atExecutor,atRouting]=await Promise.all([client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[addresses.executor],blockNumber:block.number}),client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[addresses.routing],blockNumber:block.number})]);
    assert(atExecutor===0n&&atRouting===0n,'Routing residue remains');
  }
}

const hashes=process.argv.slice(2);
const receipts=[];
const minimumConfirmations=BigInt(process.env.HOODX_MIN_CONFIRMATIONS??'12');
assert(minimumConfirmations>=0n&&minimumConfirmations<=1000n,'Invalid confirmation requirement');
const allowedTargets=[addresses.registry,addresses.policy,addresses.factory,vault];
for(const hash of hashes){
  assert(/^0x[0-9a-fA-F]{64}$/.test(hash),'Invalid transaction hash');
  const receipt=await client.getTransactionReceipt({hash});
  assert(receipt.status==='success','Transaction reverted');
  assert(receipt.blockNumber<=block.number,'Receipt beyond pinned block');
  const confirmations=block.number-receipt.blockNumber+1n;
  assert(confirmations>=minimumConfirmations,'Receipt is not final enough');
  assert([addresses.deployer,addresses.curator].some(signer=>same(receipt.from,signer)),'Unexpected receipt signer');
  assert(receipt.to&&allowedTargets.some(target=>same(receipt.to,target)),'Unexpected receipt target');
  receipts.push({hash,blockNumber:receipt.blockNumber,confirmations,from:receipt.from,to:receipt.to,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice});
}
const stringify=value=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2);
console.log(stringify({chainId:4663,blockNumber:block.number,blockTimestamp:block.timestamp,expected,vault,paused,nonce,supply,deployerShares,curatorShares,freeWeth,freeNative,actualWeth,actualNative,allFreeZero,allClaimsZero,rows,receipts}));
