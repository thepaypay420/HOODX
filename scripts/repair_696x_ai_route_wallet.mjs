// Local wallet handoff for the reviewed 696X AI route repair. RPC stays server-side.
import httpServer from "node:http";
import fs from "node:fs";
import {
  createPublicClient, http, parseAbi, encodeAbiParameters, encodeFunctionData,
  keccak256, toBytes, toHex, formatEther,
} from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL;
delete process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw new Error("RPC configuration missing");
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });

const account = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const vault = "0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292";
const controller = "0x32d806935f5118a60bB90137e699B81a0348e643";
const policy = "0x8e36fB11545Fc1683f35a079d3F9f1A715DbEC70";
const factory = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const ai = "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const expectedPool = "0xD78480CAFEf722D75519e13B9f516e5704D0D659";
const expectedOldId = "0x17b85823374be0347634df4ccc0ab36eac3d3145e8553ac3df5a9ea15005355f";
const oracle = "0xC2730EB5a2f7BAD1609749BE19a47386F6bCeeEC";
const evidence = keccak256(toBytes("696X_AI_DIRECT_0.3_PERCENT_ROUTE_REVIEW_2026_09_25"));
const statePath = "deployments/robinhood-4663-696x-ai-route-repair.json";
const zero = "0x0000000000000000000000000000000000000000";
const stages = ["approve", "replace"];
const labels = ["Approve stronger AI route", "Switch 696X to stronger AI route"];
const budgets = [700_000_000_000_000n, 600_000_000_000_000n];

const routeType = { type: "tuple[]", components: [
  { name: "kind", type: "uint8" }, { name: "tokenIn", type: "address" },
  { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
  { name: "key", type: "tuple", components: [
    { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ]}, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" },
]};
const hop = (tokenIn, tokenOut) => ({ kind: 3, tokenIn, tokenOut, fee: 3000,
  key: { currency0: zero, currency1: zero, fee: 0, tickSpacing: 0, hooks: zero },
  minHopPriceX36: 0n, hookData: "0x" });
const buy = encodeAbiParameters([routeType], [[hop(weth, ai)]]);
const sell = encodeAbiParameters([routeType], [[hop(ai, weth)]]);
const configId = keccak256(encodeAbiParameters(
  [{type:"address"},{type:"address"},{type:"bytes"},{type:"bytes"},{type:"bytes32"}],
  [ai, oracle, buy, sell, evidence],
));

const vaultAbi = parseAbi([
  "function owner() view returns(address)", "function policy() view returns(address)",
  "function configId(address) view returns(bytes32)", "function totalAssets() view returns(uint256)",
  "function totalSupply() view returns(uint256)", "function balanceOf(address) view returns(uint256)",
  "function withdraw(uint256,uint256,uint256) returns(uint256)",
]);
const policyAbi = parseAbi([
  "function owner() view returns(address)",
  "function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)",
  "function approveConfig(address,address,bytes,bytes,bytes32) returns(bytes32)",
]);
const controllerAbi = parseAbi([
  "function curator() view returns(address)", "function vault() view returns(address)",
  "function replaceConfig(bytes32)",
]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns(address)"]);

const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
function readState() { try { return JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { return {chainId:4663,vault,controller,configId,receipts:{}}; } }
function saveState(state) { fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); }

async function baseline() {
  if (await client.getChainId() !== 4663) throw new Error("Wrong RPC chain");
  const [owner, policyAtVault, currentId, policyOwner, controllerCurator, controllerVault, pool] = await Promise.all([
    client.readContract({address:vault,abi:vaultAbi,functionName:"owner"}),
    client.readContract({address:vault,abi:vaultAbi,functionName:"policy"}),
    client.readContract({address:vault,abi:vaultAbi,functionName:"configId",args:[ai]}),
    client.readContract({address:policy,abi:policyAbi,functionName:"owner"}),
    client.readContract({address:controller,abi:controllerAbi,functionName:"curator"}),
    client.readContract({address:controller,abi:controllerAbi,functionName:"vault"}),
    client.readContract({address:factory,abi:factoryAbi,functionName:"getPool",args:[ai,weth,3000]}),
  ]);
  if (!same(owner,controller)||!same(policyAtVault,policy)||!same(policyOwner,account)||!same(controllerCurator,account)||!same(controllerVault,vault)) throw new Error("Authority changed");
  if (!same(pool,expectedPool)) throw new Error("Reviewed AI pool identity changed");
  if (currentId !== expectedOldId && currentId !== configId) throw new Error("AI configuration changed since review");
  return currentId;
}

async function approved() {
  try { const c=await client.readContract({address:policy,abi:policyAbi,functionName:"config",args:[configId]}); return same(c[0],ai)&&same(c[1],oracle)&&c[2]===buy&&c[3]===sell; }
  catch { return false; }
}
async function verifyStage(stage) {
  const currentId=await baseline();
  if (stage==="approve") return approved();
  return currentId===configId;
}
async function build(stage) {
  if (!stages.includes(stage)) throw new Error("Invalid stage");
  const i=stages.indexOf(stage); await baseline();
  if (await verifyStage(stage)) return {done:true,label:labels[i]};
  if (i&&!(await verifyStage(stages[i-1]))) throw new Error("Complete step 1 first");
  const to=stage==="approve"?policy:controller;
  const data=stage==="approve"
    ? encodeFunctionData({abi:policyAbi,functionName:"approveConfig",args:[ai,oracle,buy,sell,evidence]})
    : encodeFunctionData({abi:controllerAbi,functionName:"replaceConfig",args:[configId]});
  const tx={account,to,data,value:0n}; const gas=((await client.estimateGas(tx))*125n+99n)/100n;
  const maxFeePerGas=(await client.getGasPrice())*2n; const cap=gas*maxFeePerGas;
  if (cap>budgets[i]) throw new Error("Current gas exceeds the reviewed cap; wait and retry");
  if (await client.getBalance({address:account})<budgets.slice(i).reduce((a,b)=>a+b,0n)) throw new Error("Curator wallet needs more gas");
  const state=readState(); state.prepared??={}; state.prepared[stage]={to,data}; saveState(state);
  return {done:false,label:labels[i],cap:formatEther(cap),tx:{from:account,to,data,value:"0x0",chainId:"0x1237",gas:toHex(gas),maxFeePerGas:toHex(maxFeePerGas),maxPriorityFeePerGas:"0x0"}};
}
async function verifyReceipt(stage,hash) {
  let receipt; try { receipt=await client.getTransactionReceipt({hash}); } catch { return {confirmed:false}; }
  if (receipt.status!=="success") throw new Error("Transaction reverted");
  const tx=await client.getTransaction({hash}); const state=readState(); const prepared=state.prepared?.[stage];
  if (!prepared||!same(tx.from,account)||!same(tx.to,prepared.to)||tx.value!==0n||tx.input.toLowerCase()!==prepared.data.toLowerCase()) throw new Error("Transaction identity mismatch");
  if (!(await verifyStage(stage))) throw new Error("Post-transaction verification failed");
  state.receipts[stage]={hash,block:String(receipt.blockNumber),gasUsed:String(receipt.gasUsed),feeWei:String(receipt.gasUsed*receipt.effectiveGasPrice)};
  const result={confirmed:true,label:labels[stages.indexOf(stage)],hash,feeEth:formatEther(receipt.gasUsed*receipt.effectiveGasPrice)};
  if (stage==="replace") {
    const [shares,supply,assets]=await Promise.all([
      client.readContract({address:vault,abi:vaultAbi,functionName:"balanceOf",args:[account]}),
      client.readContract({address:vault,abi:vaultAbi,functionName:"totalSupply"}),
      client.readContract({address:vault,abi:vaultAbi,functionName:"totalAssets"}),
    ]);
    const minimum=assets*shares/supply*99n/100n;
    const {result:quoted}=await client.simulateContract({address:vault,abi:vaultAbi,account,functionName:"withdraw",args:[shares,minimum,BigInt(Math.floor(Date.now()/1000)+300)]});
    state.maxExitCheck={checkedAt:new Date().toISOString(),shares:String(shares),minimumWei:String(minimum),quotedWei:String(quoted)};
    result.maxExitEth=formatEther(quoted);
  }
  saveState(state); return result;
}

const page=`<!doctype html><meta charset="utf-8"><title>HOODX · Restore 696X exit</title><style>body{background:#091412;color:#e5f5f1;font:18px system-ui;max-width:820px;margin:40px auto;padding:24px}button{width:100%;background:#4bd0c1;border:0;border-radius:12px;padding:16px;margin:8px 0;font:700 18px system-ui;cursor:pointer}button:disabled{opacity:.35}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#afcbc3}.step{border:1px solid #25423d;border-radius:16px;padding:12px;margin:12px 0}small{color:#afcbc3}</style><h1>HOODX · Restore 696X ETH exit</h1><p>Switch AI from its marginal 1% route to the reviewed direct 0.3% route. The same immutable oracle floor remains enforced.</p><p>Two gas-only configuration transactions. No token approval, asset transfer, swap, withdrawal, migration, or contract upgrade occurs here.</p><small>Robinhood Chain · 4663<br>Curator: ${account}<br>Vault: ${vault}</small><button id="connect">Connect Rabby</button>${stages.map((s,i)=>`<div class="step"><button id="${s}" disabled>${i+1}. ${labels[i]}</button></div>`).join("")}<pre id="status">Connect the curator wallet. Review both transactions.</pre><script src="/wallet.js"></script>`;
const js=`let provider;const ps=[];const status=document.querySelector('#status');const stages=${JSON.stringify(stages)};window.addEventListener('eip6963:announceProvider',e=>{if(!ps.some(p=>p.info.uuid===e.detail.info.uuid))ps.push(e.detail)});const request=()=>window.dispatchEvent(new Event('eip6963:requestProvider'));const rabby=()=>ps.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);request();const enable=i=>stages.forEach((s,n)=>document.querySelector('#'+s).disabled=n!==i);async function resume(){let next=stages.length;for(let i=0;i<stages.length;i++){const p=await(await fetch('/prepare?stage='+stages[i])).json();if(!p.done){next=i;break}}enable(next);status.textContent=next<stages.length?'Connected. Continue with step '+(next+1)+'.':'Repair complete and full Max exit verified.'}document.querySelector('#connect').onclick=async()=>{try{request();await new Promise(r=>setTimeout(r,350));provider=rabby();if(!provider)throw Error('Rabby not detected. Enable it for 127.0.0.1 and retry.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Select the curator wallet.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});await resume()}catch(e){status.textContent=e.message||String(e)}};for(const[i,stage]of stages.entries())document.querySelector('#'+stage).onclick=async()=>{const b=document.querySelector('#'+stage);b.disabled=true;try{const r=await fetch('/prepare?stage='+stage);const p=await r.json();if(!r.ok)throw Error(p.error);if(p.done){await resume();return}status.textContent='Review '+p.label+' in Rabby. Maximum gas '+p.cap+' ETH.';const hash=await provider.request({method:'eth_sendTransaction',params:[p.tx]});status.textContent='Submitted '+hash+' — verifying…';for(let n=0;n<120;n++){const v=await(await fetch('/receipt?stage='+stage+'&hash='+hash)).json();if(v.confirmed){status.textContent=v.label+' confirmed. Gas paid: '+v.feeEth+' ETH'+(v.maxExitEth?'\nFull Max 696X exit now simulates: '+v.maxExitEth+' ETH':'');await resume();return}if(v.error)throw Error(v.error);await new Promise(r=>setTimeout(r,3000))}throw Error('Still pending. Check the transaction before retrying.')}catch(e){status.textContent=(e.message||String(e))+'\nNo unverified retry was sent.';b.disabled=false}};`;
const server=httpServer.createServer(async(req,res)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Frame-Options","DENY");res.setHeader("Content-Security-Policy","default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'");if(req.headers.host!=="127.0.0.1:8795"||req.method!=="GET"){res.writeHead(403);return res.end()}try{const url=new URL(req.url,"http://127.0.0.1:8795");if(url.pathname==="/"){res.setHeader("Content-Type","text/html");return res.end(page)}if(url.pathname==="/wallet.js"){res.setHeader("Content-Type","text/javascript");return res.end(js)}res.setHeader("Content-Type","application/json");const stage=url.searchParams.get("stage");if(!stages.includes(stage))throw Error("Invalid stage");if(url.pathname==="/prepare")return res.end(JSON.stringify(await build(stage)));if(url.pathname==="/receipt"){const hash=url.searchParams.get("hash");if(!/^0x[0-9a-fA-F]{64}$/.test(hash??""))throw Error("Invalid hash");return res.end(JSON.stringify(await verifyReceipt(stage,hash)))}res.writeHead(404);res.end("{}")}catch(error){res.writeHead(400);res.end(JSON.stringify({error:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,"<redacted>"):"Request failed"}))}});
server.listen(8795,"127.0.0.1",()=>console.log("Wallet handoff: http://127.0.0.1:8795"));
