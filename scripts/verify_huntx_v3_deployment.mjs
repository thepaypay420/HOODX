import fs from "node:fs";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";
const rpc=process.env.ROBINHOOD_RPC_URL?.trim(); if(!rpc) throw Error("ROBINHOOD_RPC_URL is required");
const client=createPublicClient({transport:http(rpc,{timeout:20_000,retryCount:1})});
const txHash=process.argv[2]||process.env.HUNTX_V3_DEPLOY_TX; if(!/^0x[0-9a-f]{64}$/i.test(txHash||"")) throw Error("Deployment transaction hash required");
const p=JSON.parse(fs.readFileSync("deployments/huntx-v3-launch-preflight.json","utf8"));
const CURATOR="0x134D468B0bcaeA6DF127916f951F7938c06A37C6", EXECUTOR="0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750", WETH="0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const la=parseAbi(["function baseIndex() view returns(address)","function baseSeedAmount() view returns(uint256)","function wethSeedAmount() view returns(uint256)","function riskReferenceAmount() view returns(uint256)","function initialShares() view returns(uint256)","function policy() view returns(address)","function vault() view returns(address)"]);
const po=parseAbi(["function owner() view returns(address)","function executor() view returns(address)"]);
const va=parseAbi(["function curator() view returns(address)","function weth() view returns(address)","function bootstrapped() view returns(bool)","function totalSupply() view returns(uint256)","function wethSeedAmount() view returns(uint256)","function riskReferenceAmount() view returns(uint256)","function initialShares() view returns(uint256)","function baseSleeves() view returns(address[])","function baseSeedAmounts() view returns(uint256[])","function PROFIT_TRIGGER_BPS() view returns(uint256)","function STOP_BPS() view returns(uint256)","function MAX_HOLD() view returns(uint256)","function MAX_ENTRIES_PER_DAY() view returns(uint256)","function IMAGE_URI() view returns(string)"]);
if(await client.getChainId()!==4663) throw Error("Wrong chain");
const [deployTx,deployReceipt]=await Promise.all([client.getTransaction({hash:txHash}),client.getTransactionReceipt({hash:txHash})]);
if(deployReceipt.status!=="success"||deployTx.to!==null||deployTx.from.toLowerCase()!=="0xf63E63a80A25611154C5d1c06E55FD763E0cfC19".toLowerCase()||keccak256(deployTx.input)!==p.deployment.deployDataHash) throw Error("Deployment provenance differs from preflight");
const launcher=getAddress(deployReceipt.contractAddress); if(launcher.toLowerCase()!==p.deployment.expectedLauncher.toLowerCase()) throw Error("Unexpected launcher address");
const code=await client.getCode({address:launcher}); if(!code) throw Error("Launcher missing");
const [base,baseAmt,wethAmt,risk,shares,policy,vault]=await Promise.all(["baseIndex","baseSeedAmount","wethSeedAmount","riskReferenceAmount","initialShares","policy","vault"].map(functionName=>client.readContract({address:launcher,abi:la,functionName})));
if(base.toLowerCase()!==p.base.index.toLowerCase()||baseAmt!==BigInt(p.base.seedShares)||wethAmt!==BigInt(p.huntx.wethSeedWei)||risk!==BigInt(p.huntx.riskReferenceWei)||shares!==BigInt(p.huntx.initialShares)) throw Error("Launcher terms differ from preflight");
const [owner,exec,curator,weth,done,supply,vSeed,vRisk,vShares,bases,amounts,tp,stop,hold,entries,image]=await Promise.all([
 client.readContract({address:policy,abi:po,functionName:"owner"}),client.readContract({address:policy,abi:po,functionName:"executor"}),
 ...["curator","weth","bootstrapped","totalSupply","wethSeedAmount","riskReferenceAmount","initialShares","baseSleeves","baseSeedAmounts","PROFIT_TRIGGER_BPS","STOP_BPS","MAX_HOLD","MAX_ENTRIES_PER_DAY","IMAGE_URI"].map(functionName=>client.readContract({address:vault,abi:va,functionName}))]);
if(owner.toLowerCase()!==CURATOR.toLowerCase()||exec.toLowerCase()!==EXECUTOR.toLowerCase()||curator.toLowerCase()!==CURATOR.toLowerCase()||weth.toLowerCase()!==WETH.toLowerCase()) throw Error("Authority or infrastructure mismatch");
if(done||supply!==0n||vSeed!==wethAmt||vRisk!==risk||vShares!==shares||bases.length!==1||bases[0].toLowerCase()!==base.toLowerCase()||amounts.length!==1||amounts[0]!==baseAmt) throw Error("Vault funding terms mismatch");
if(tp!==15000n||stop!==8000n||hold!==14400n||entries!==2n||!image.endsWith("/launch-hunter.png")) throw Error("Reviewed strategy constants changed");
const [policyCode,vaultCode,baseCode]=await Promise.all([client.getCode({address:policy}),client.getCode({address:vault}),client.getCode({address:base})]);
const manifest={status:"DEPLOYED_AWAITING_BASE_APPROVAL",verifiedAt:new Date().toISOString(),blockNumber:(await client.getBlockNumber()).toString(),deploymentTx:txHash,deployDataHash:keccak256(deployTx.input),launcher,launcherRuntimeCodeHash:keccak256(code),policy,policyRuntimeCodeHash:keccak256(policyCode),vault,vaultRuntimeCodeHash:keccak256(vaultCode),baseIndex:base,baseRuntimeCodeHash:keccak256(baseCode),terms:p.huntx};
fs.writeFileSync("deployments/huntx-v3-live.json",JSON.stringify(manifest,null,2)+"\n"); console.log(JSON.stringify(manifest,null,2));
