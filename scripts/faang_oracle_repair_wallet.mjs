// Local Rabby handoff for the reviewed FAANGX oracle repair. RPC stays server-side.
import httpServer from "node:http";
import fs from "node:fs";
import {
  createPublicClient, http, parseAbi, encodeDeployData, encodeFunctionData,
  encodeAbiParameters, keccak256, toBytes, toHex, formatEther,
} from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL;
delete process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw new Error("RPC configuration missing");
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });

const account = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";
const vault = "0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0";
const controller = "0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb";
const factory = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const bridge = "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca";
const amzn = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const amznPool = "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef";
const googl = "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3";
const googlPrimaryPool = "0x8c2B4303fA0B99d07A5D3E9411497A277e65b673";
const googlSecondaryPool = "0x8fB9301586f27e2cff85312F7c1d0F16C6167cdE";
const amznDepth = 500_000_000_000_000_000n;
const bridgeDepth = 2_500_000_000_000_000_000n;
const googlPrimaryDepth = 250_000_000_000_000_000_000n;
const googlSecondaryDepth = 900_000_000_000_000_000n;
const amznEvidence = keccak256(toBytes("FAANGX_AMZN_REFERENCE_REVIEW_2026_09_24"));
const googlEvidence = keccak256(toBytes("FAANGX_GOOGL_REDUNDANT_REFERENCE_REVIEW_2026_09_24"));
const statePath = "deployments/robinhood-4663-faang-oracle-repair.json";
const stages = ["amznOracle", "amznApprove", "amznReplace", "googlPrimary", "googlSecondary", "googlRedundant", "googlApprove", "googlReplace"];
const labels = ["Deploy AMZN TWAP", "Approve AMZN configuration", "Switch AMZN configuration", "Deploy GOOGL primary TWAP", "Deploy GOOGL fallback TWAP", "Deploy GOOGL redundant oracle", "Approve GOOGL configuration", "Switch GOOGL configuration"];
const budgets = [1_250_000_000_000_000n, 700_000_000_000_000n, 600_000_000_000_000n, 1_250_000_000_000_000n, 1_250_000_000_000_000n, 1_000_000_000_000_000n, 700_000_000_000_000n, 600_000_000_000_000n];
const twapArtifact = JSON.parse(fs.readFileSync("out/HoodxTwapV2.sol/HoodxTwapV2.json", "utf8"));
const redundantArtifact = JSON.parse(fs.readFileSync("out/HoodxRedundantOracleV2.sol/HoodxRedundantOracleV2.json", "utf8"));

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
const twapAbi = parseAbi([
  "function token() view returns(address)", "function pool() view returns(address)",
  "function minLiquidity() view returns(uint128)", "function minBridgeLiquidity() view returns(uint128)",
  "function value(address,uint256) view returns(uint256)",
]);
const redundantAbi = parseAbi([
  "function token() view returns(address)", "function primary() view returns(address)",
  "function secondary() view returns(address)", "function maxDivergenceBps() view returns(uint16)",
  "function value(address,uint256) view returns(uint256)",
]);

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { chainId: 4663, vault, controller, receipts: {} }; }
}
function saveState(state) { fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); }
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

async function baseline() {
  if (await client.getChainId() !== 4663) throw new Error("Wrong RPC chain");
  const [owner, policy, currentAmznId, currentGooglId, controllerCurator, controllerVault] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "policy" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "configId", args: [amzn] }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "configId", args: [googl] }),
    client.readContract({ address: controller, abi: controllerAbi, functionName: "curator" }),
    client.readContract({ address: controller, abi: controllerAbi, functionName: "vault" }),
  ]);
  const policyOwner = await client.readContract({ address: policy, abi: policyAbi, functionName: "owner" });
  if (!same(owner, controller) || !same(controllerCurator, account) || !same(controllerVault, vault) || !same(policyOwner, account)) throw new Error("Authority changed");
  const state = readState();
  state.policy = policy;
  state.amznOldId ??= currentAmznId;
  state.googlOldId ??= currentGooglId;
  const [amznConfig, googlConfig] = await Promise.all([
    client.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [state.amznOldId] }),
    client.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [state.googlOldId] }),
  ]);
  if (!same(amznConfig[0], amzn) || !same(googlConfig[0], googl)) throw new Error("Configuration identity mismatch");
  state.amznBuy = amznConfig[2]; state.amznSell = amznConfig[3];
  state.googlBuy = googlConfig[2]; state.googlSell = googlConfig[3];
  saveState(state);
  return { state, policy, currentAmznId, currentGooglId };
}

async function twapMatches(address, token, pool, depth, bridgeMinimum = 0n) {
  if (!address) return false;
  try {
    const [readToken, readPool, readDepth, readBridge, price] = await Promise.all([
      client.readContract({ address, abi: twapAbi, functionName: "token" }),
      client.readContract({ address, abi: twapAbi, functionName: "pool" }),
      client.readContract({ address, abi: twapAbi, functionName: "minLiquidity" }),
      client.readContract({ address, abi: twapAbi, functionName: "minBridgeLiquidity" }),
      client.readContract({ address, abi: twapAbi, functionName: "value", args: [token, 10n ** 18n] }),
    ]);
    return same(readToken, token) && same(readPool, pool) && readDepth === depth && readBridge === bridgeMinimum && price > 0n;
  } catch { return false; }
}

async function verifyStage(stage, state) {
  if (stage === "amznOracle") return twapMatches(state.amznOracle, amzn, amznPool, amznDepth, bridgeDepth);
  if (stage === "amznApprove") {
    if (!state.amznConfigId || !state.amznOracle) return false;
    try { const c = await client.readContract({ address: state.policy, abi: policyAbi, functionName: "config", args: [state.amznConfigId] }); return same(c[0], amzn) && same(c[1], state.amznOracle) && c[2] === state.amznBuy && c[3] === state.amznSell; } catch { return false; }
  }
  if (stage === "amznReplace") return state.amznConfigId && (await client.readContract({ address: vault, abi: vaultAbi, functionName: "configId", args: [amzn] })) === state.amznConfigId;
  if (stage === "googlPrimary") return twapMatches(state.googlPrimary, googl, googlPrimaryPool, googlPrimaryDepth);
  if (stage === "googlSecondary") return twapMatches(state.googlSecondary, googl, googlSecondaryPool, googlSecondaryDepth);
  if (stage === "googlRedundant") {
    if (!state.googlRedundant || !state.googlPrimary || !state.googlSecondary) return false;
    try {
      const [token, primary, secondary, divergence, price] = await Promise.all([
        client.readContract({ address: state.googlRedundant, abi: redundantAbi, functionName: "token" }),
        client.readContract({ address: state.googlRedundant, abi: redundantAbi, functionName: "primary" }),
        client.readContract({ address: state.googlRedundant, abi: redundantAbi, functionName: "secondary" }),
        client.readContract({ address: state.googlRedundant, abi: redundantAbi, functionName: "maxDivergenceBps" }),
        client.readContract({ address: state.googlRedundant, abi: redundantAbi, functionName: "value", args: [googl, 10n ** 18n] }),
      ]);
      return same(token, googl) && same(primary, state.googlPrimary) && same(secondary, state.googlSecondary) && divergence === 300 && price > 0n;
    } catch { return false; }
  }
  if (stage === "googlApprove") {
    if (!state.googlConfigId || !state.googlRedundant) return false;
    try { const c = await client.readContract({ address: state.policy, abi: policyAbi, functionName: "config", args: [state.googlConfigId] }); return same(c[0], googl) && same(c[1], state.googlRedundant) && c[2] === state.googlBuy && c[3] === state.googlSell; } catch { return false; }
  }
  if (stage === "googlReplace") return state.googlConfigId && (await client.readContract({ address: vault, abi: vaultAbi, functionName: "configId", args: [googl] })) === state.googlConfigId;
  return false;
}

async function build(stage) {
  const { state, policy } = await baseline();
  const i = stages.indexOf(stage);
  if (i < 0) throw new Error("Invalid stage");
  if (await verifyStage(stage, state)) return { done: true, stage, label: labels[i] };
  if (i > 0 && !(await verifyStage(stages[i - 1], state))) throw new Error(`Complete step ${i} first`);
  let to; let data;
  if (stage === "amznOracle") data = encodeDeployData({ abi: twapArtifact.abi, bytecode: twapArtifact.bytecode.object, args: [factory, amzn, weth, amznPool, bridge, 1800, amznDepth, bridgeDepth] });
  else if (stage === "amznApprove") {
    to = policy; data = encodeFunctionData({ abi: policyAbi, functionName: "approveConfig", args: [amzn, state.amznOracle, state.amznBuy, state.amznSell, amznEvidence] });
    state.amznConfigId = keccak256(encodeAbiParameters([{type:"address"},{type:"address"},{type:"bytes"},{type:"bytes"},{type:"bytes32"}], [amzn,state.amznOracle,state.amznBuy,state.amznSell,amznEvidence]));
  } else if (stage === "amznReplace") { to = controller; data = encodeFunctionData({ abi: controllerAbi, functionName: "replaceConfig", args: [state.amznConfigId] }); }
  else if (stage === "googlPrimary") data = encodeDeployData({ abi: twapArtifact.abi, bytecode: twapArtifact.bytecode.object, args: [factory, googl, weth, googlPrimaryPool, "0x0000000000000000000000000000000000000000", 1800, googlPrimaryDepth, 0] });
  else if (stage === "googlSecondary") data = encodeDeployData({ abi: twapArtifact.abi, bytecode: twapArtifact.bytecode.object, args: [factory, googl, weth, googlSecondaryPool, "0x0000000000000000000000000000000000000000", 1800, googlSecondaryDepth, 0] });
  else if (stage === "googlRedundant") data = encodeDeployData({ abi: redundantArtifact.abi, bytecode: redundantArtifact.bytecode.object, args: [googl, state.googlPrimary, state.googlSecondary, 300] });
  else if (stage === "googlApprove") {
    to = policy; data = encodeFunctionData({ abi: policyAbi, functionName: "approveConfig", args: [googl, state.googlRedundant, state.googlBuy, state.googlSell, googlEvidence] });
    state.googlConfigId = keccak256(encodeAbiParameters([{type:"address"},{type:"address"},{type:"bytes"},{type:"bytes"},{type:"bytes32"}], [googl,state.googlRedundant,state.googlBuy,state.googlSell,googlEvidence]));
  } else { to = controller; data = encodeFunctionData({ abi: controllerAbi, functionName: "replaceConfig", args: [state.googlConfigId] }); }
  saveState(state);
  const tx = { account, data, value: 0n, ...(to ? { to } : {}) };
  const gas = ((await client.estimateGas(tx)) * 125n + 99n) / 100n;
  const maxFeePerGas = (await client.getGasPrice()) * 2n;
  if (gas * maxFeePerGas > budgets[i]) throw new Error("Current gas exceeds the reviewed step cap; wait and retry");
  if (await client.getBalance({ address: account }) < budgets.slice(i).reduce((sum, n) => sum + n, 0n)) throw new Error("Curator wallet balance is below the remaining reviewed gas reserve");
  state.prepared ??= {}; state.prepared[stage] = { to: to ?? null, data }; saveState(state);
  return { done:false, stage, label:labels[i], cap:formatEther(gas*maxFeePerGas), tx:{ from:account, ...(to?{to}:{}), data, value:"0x0", chainId:"0x1237", gas:toHex(gas), maxFeePerGas:toHex(maxFeePerGas), maxPriorityFeePerGas:"0x0" } };
}

async function verifyReceipt(stage, hash) {
  let receipt; try { receipt = await client.getTransactionReceipt({ hash }); } catch { return { confirmed:false }; }
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  const tx = await client.getTransaction({ hash }); const state = readState(); const prepared = state.prepared?.[stage];
  if (!prepared || !same(tx.from, account) || tx.value !== 0n || tx.input.toLowerCase() !== prepared.data.toLowerCase()) throw new Error("Transaction identity mismatch");
  if (prepared.to === null) {
    if (tx.to !== null || !receipt.contractAddress) throw new Error("Deployment identity mismatch");
    if (stage === "amznOracle") state.amznOracle = receipt.contractAddress;
    else if (stage === "googlPrimary") state.googlPrimary = receipt.contractAddress;
    else if (stage === "googlSecondary") state.googlSecondary = receipt.contractAddress;
    else if (stage === "googlRedundant") state.googlRedundant = receipt.contractAddress;
    else throw new Error("Unexpected deployment stage");
  } else if (!same(tx.to, prepared.to)) throw new Error("Transaction target mismatch");
  state.receipts[stage] = { hash, block:String(receipt.blockNumber), gasUsed:String(receipt.gasUsed), feeWei:String(receipt.gasUsed*receipt.effectiveGasPrice) }; saveState(state);
  if (!(await verifyStage(stage, state))) throw new Error("Post-transaction verification failed");
  const result = { confirmed:true, stage, hash, feeEth:formatEther(receipt.gasUsed*receipt.effectiveGasPrice) };
  if (stage === "googlReplace") {
    const [shares,supply,assets] = await Promise.all([
      client.readContract({address:vault,abi:vaultAbi,functionName:"balanceOf",args:[account]}),
      client.readContract({address:vault,abi:vaultAbi,functionName:"totalSupply"}),
      client.readContract({address:vault,abi:vaultAbi,functionName:"totalAssets"}),
    ]);
    const minimum=assets*shares/supply*95n/100n;
    const {result:quoted}=await client.simulateContract({address:vault,abi:vaultAbi,account,functionName:"withdraw",args:[shares,minimum,BigInt(Math.floor(Date.now()/1000)+300)]});
    state.maxExitCheck={checkedAt:new Date().toISOString(),shares:String(shares),assets:String(assets),minimumWei:String(minimum),quotedWei:String(quoted)}; saveState(state); result.maxExitEth=formatEther(quoted);
  }
  return result;
}

const page=`<!doctype html><meta charset="utf-8"><title>HOODX · Restore FAANGX exits</title><style>body{background:#091412;color:#e5f5f1;font:18px system-ui;max-width:900px;margin:40px auto;padding:24px}button{background:#4bd0c1;border:0;border-radius:10px;padding:15px;margin:7px;font:inherit;cursor:pointer}button:disabled{opacity:.35}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#afcbc3}.step{border:1px solid #25423d;border-radius:14px;padding:9px;margin:9px 0}small{color:#afcbc3}</style><h1>HOODX · Restore FAANGX ETH exits</h1><p>Replace the depleted AMZN and GOOGL price references. GOOGL receives two independent TWAP sources with a 3% agreement guard. The reviewed fork completes a full Max ETH exit after this repair.</p><p>Eight gas-only configuration transactions. No token approval, transfer, swap, withdrawal, or vault migration occurs on this page. Combined maximum gas reserve: 0.00735 ETH.</p><small>Robinhood Chain · 4663<br>Curator: ${account}<br>Vault: ${vault}</small><p><button id="connect">Connect Rabby</button></p>${stages.map((s,i)=>`<div class="step"><button id="${s}" disabled>${i+1}. ${labels[i]}</button></div>`).join("")}<pre id="status">Connect the curator wallet. Review every transaction in Rabby.</pre><script src="/wallet.js"></script>`;
const js=`let provider;const providers=[];const status=document.querySelector('#status');const stages=${JSON.stringify(stages)};window.addEventListener('eip6963:announceProvider',e=>{if(!providers.some(p=>p.info.uuid===e.detail.info.uuid))providers.push(e.detail)});const requestProviders=()=>window.dispatchEvent(new Event('eip6963:requestProvider'));const findRabby=()=>providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);requestProviders();const enable=i=>stages.forEach((s,n)=>document.querySelector('#'+s).disabled=n!==i);document.querySelector('#connect').onclick=async()=>{try{status.textContent='Finding Rabby…';requestProviders();await new Promise(r=>setTimeout(r,350));provider=findRabby();if(!provider)throw Error('Rabby not detected. Confirm the Rabby extension is enabled for 127.0.0.1, then retry.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Select the approved curator wallet in Rabby.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});let next=stages.length;for(let i=0;i<stages.length;i++){const check=await(await fetch('/prepare?stage='+stages[i])).json();if(!check.done){next=i;break;}}enable(next);status.textContent=next<stages.length?'Connected. Resume at step '+(next+1)+'.':'Repair already complete.';}catch(e){status.textContent=e.message||String(e);}};for(const[i,stage]of stages.entries())document.querySelector('#'+stage).onclick=async()=>{const button=document.querySelector('#'+stage);button.disabled=true;let requested=false;try{if(localStorage.getItem('hoodx-faang-repair-'+stage)||localStorage.getItem('hoodx-faang-repair-pending-'+stage))throw Error('A previous request exists. Check its receipt before retrying.');const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Wrong wallet');status.textContent='Refreshing state and gas for '+stage+'…';const response=await fetch('/prepare?stage='+stage);const prepared=await response.json();if(!response.ok)throw Error(prepared.error);if(prepared.done){status.textContent=prepared.label+' is already verified.';enable(i+1);return;}status.textContent='Review '+prepared.label+' in Rabby. Maximum gas '+prepared.cap+' ETH.';requested=true;localStorage.setItem('hoodx-faang-repair-pending-'+stage,'true');const hash=await provider.request({method:'eth_sendTransaction',params:[prepared.tx]});localStorage.setItem('hoodx-faang-repair-'+stage,hash);localStorage.removeItem('hoodx-faang-repair-pending-'+stage);status.textContent='Submitted '+hash+' — verifying…';for(let n=0;n<120;n++){const check=await(await fetch('/receipt?stage='+stage+'&hash='+hash)).json();if(check.confirmed){status.textContent=prepared.label+' confirmed. '+hash+'\\nGas paid: '+check.feeEth+' ETH'+(check.maxExitEth?'\\nFull Max FAANGX exit now simulates: '+check.maxExitEth+' ETH':'');enable(i+1);return;}if(check.error)throw Error(check.error);await new Promise(r=>setTimeout(r,3000));}status.textContent='Still pending: '+hash+'. Do not submit again.';}catch(e){if(e.code===4001){requested=false;localStorage.removeItem('hoodx-faang-repair-pending-'+stage);}const recorded=localStorage.getItem('hoodx-faang-repair-'+stage)||localStorage.getItem('hoodx-faang-repair-pending-'+stage);button.disabled=requested||!!recorded;status.textContent=(e.message||String(e))+(button.disabled?'\\nCheck the wallet request or receipt before retrying.':'\\nNo transaction was submitted. You can retry.');}};`;

const server=httpServer.createServer(async(req,res)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Frame-Options","DENY");res.setHeader("Content-Security-Policy","default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'");if(req.headers.host!=="127.0.0.1:8794"||req.method!=="GET"){res.writeHead(403);return res.end();}try{const url=new URL(req.url,"http://127.0.0.1:8794");if(url.pathname==="/"){res.setHeader("Content-Type","text/html");return res.end(page);}if(url.pathname==="/wallet.js"){res.setHeader("Content-Type","text/javascript");return res.end(js);}res.setHeader("Content-Type","application/json");const stage=url.searchParams.get("stage");if(!stages.includes(stage))throw new Error("Invalid stage");if(url.pathname==="/prepare")return res.end(JSON.stringify(await build(stage)));if(url.pathname==="/receipt"){const hash=url.searchParams.get("hash");if(!/^0x[0-9a-fA-F]{64}$/.test(hash??""))throw new Error("Invalid hash");return res.end(JSON.stringify(await verifyReceipt(stage,hash)));}res.writeHead(404);return res.end("{}");}catch(error){res.writeHead(400);const message=error instanceof Error?error.message.replace(/https?:\/\/\S+/g,"<redacted>"):"Request failed";return res.end(JSON.stringify({error:message}));}});
server.listen(8794,"127.0.0.1",()=>console.log("Wallet handoff: http://127.0.0.1:8794"));
