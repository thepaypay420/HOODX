import fs from "node:fs";
import http from "node:http";
import {
  createPublicClient, encodeAbiParameters, encodeDeployData, encodeFunctionData, formatEther,
  getAddress, http as viemHttp, keccak256, parseAbi, parseAbiParameters, toBytes,
} from "viem";

const PORT = 8795;
const CHAIN_ID = 4663;
const ADMIN = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const DEPLOYER = getAddress("0xf63E63a80A25611154C5d1c06E55FD763E0cfC19");
const POLICY = getAddress("0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21");
const IMPLEMENTATION = getAddress("0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7");
const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const EXPECTED_FINGERPRINT = "0x794a8579af3b2619d85c6a793d67b5265ca7ec3657d8d83ba8f105c850b593cf";
const rpcUrl = fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim();
const catalog = JSON.parse(fs.readFileSync("deployments/official-vault-catalog-2026-09-24.json", "utf8"));
const routeArtifact = JSON.parse(fs.readFileSync("out/HoodxRouteAdminV3.sol/HoodxRouteAdminV3.json", "utf8"));
const factoryArtifact = JSON.parse(fs.readFileSync("out/HoodxAtomicFactoryV3.sol/HoodxAtomicFactoryV3.json", "utf8"));
const statePath = "deployments/official-vault-launch-state.json";
const client = createPublicClient({ transport: viemHttp(rpcUrl, { timeout: 30_000, retryCount: 2 }) });
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { transactions: [] };

const policyAbi = parseAbi([
  "function owner() view returns(address)", "function pendingOwner() view returns(address)",
  "function transferOwnership(address)", "function config(bytes32) view returns(address,address,bytes,bytes)",
]);
const adminAbi = parseAbi([
  "function owner() view returns(address)", "function policy() view returns(address)", "function acceptPolicyOwnership()",
  "function approveRoutes(address[] tokens,bytes[] buys,bytes[] sells,bytes32 evidence) returns(bytes32[])",
]);
const factoryAbi = parseAbi([
  "function owner() view returns(address)", "function treasury() view returns(address)", "function implementation() view returns(address)",
  "function bySlug(string) view returns(address)",
  "function createAtomicBatch(string[] slugs,(address curator,address creator,address recipient,address treasury,string name,string symbol,uint16 creatorFee,uint16 protocolFee,uint16 cashBps,uint256 firstDeposit,string imageURI)[] params,bytes32[][] configs,uint16[][] weights) returns(address[] vaults,address[] controllers)",
]);
const hopType = parseAbiParameters("(uint8 kind,address tokenIn,address tokenOut,uint24 fee,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint256 minHopPriceX36,bytes hookData)[]");
const names = ["On-chain Finance", "Silicon Stack", "AI Stack", "Retail Pulse", "Health Frontier", "Cloud Layer", "Real Assets", "Core and Carry", "Frontier Systems", "Consumer Icons"];
const zeroKey = { currency0: "0x0000000000000000000000000000000000000000", currency1: "0x0000000000000000000000000000000000000000", fee: 0, tickSpacing: 0, hooks: "0x0000000000000000000000000000000000000000" };
const evidence = keccak256(toBytes(`HOODX_OFFICIAL_VAULT_ROUTES_V1_BLOCK_${catalog.block}`));

function routeBytes(asset) {
  const route = asset.route;
  const assetHop = {
    kind: route.version, tokenIn: getAddress(route.quote), tokenOut: getAddress(asset.token), fee: route.version === 3 ? route.fee : 0,
    key: route.version === 4 ? { currency0: getAddress(route.key.currency0), currency1: getAddress(route.key.currency1), fee: route.key.fee, tickSpacing: route.key.tickSpacing, hooks: getAddress(route.key.hooks) } : zeroKey,
    minHopPriceX36: 0n, hookData: "0x",
  };
  const bridge = { kind: 3, tokenIn: WETH, tokenOut: USDG, fee: 100, key: zeroKey, minHopPriceX36: 0n, hookData: "0x" };
  const buyHops = assetHop.tokenIn.toLowerCase() === USDG.toLowerCase() ? [bridge, assetHop] : [assetHop];
  const sellHops = [...buyHops].reverse().map((hop) => ({ ...hop, tokenIn: hop.tokenOut, tokenOut: hop.tokenIn }));
  return { buy: encodeAbiParameters(hopType, [buyHops]), sell: encodeAbiParameters(hopType, [sellHops]) };
}

const routes = catalog.assets.map((asset) => ({ token: getAddress(asset.token), ...routeBytes(asset) }));
let digest = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [evidence, BigInt(routes.length)]));
for (const route of routes) digest = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,bytes32"), [digest, route.token, keccak256(route.buy), keccak256(route.sell)]));
if (digest !== EXPECTED_FINGERPRINT) throw new Error(`Route fingerprint mismatch: ${digest}`);

const runtimeHashes = await Promise.all(routes.map(async ({ token }) => keccak256(await client.getCode({ address: token }))));
const ids = routes.map((route, index) => keccak256(encodeAbiParameters(parseAbiParameters("address,bytes32,bytes,bytes,bytes32"), [route.token, runtimeHashes[index], route.buy, route.sell, evidence])));
const assetIndex = new Map(catalog.assets.map((asset, index) => [asset.symbol, index]));
const slugs = catalog.vaults.map((vault) => vault.slug);
const params = catalog.vaults.map((vault, index) => ({
  curator: ADMIN,
  creator: ADMIN,
  recipient: ADMIN,
  treasury: ADMIN,
  name: names[index],
  symbol: vault.symbol,
  creatorFee: 40,
  protocolFee: 10,
  cashBps: vault.cashTargetBps,
  firstDeposit: 20_000_000_000_000_000n,
  imageURI: `https://www.xhoodindex.com/vaults/${vault.symbol.toLowerCase()}.png`,
}));
const vaultConfigs = catalog.vaults.map((vault) => vault.assets.map((symbol) => ids[assetIndex.get(symbol)]));
const vaultWeights = catalog.vaults.map((vault) => vault.weightsBps);

function save() { fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); }
function addressReady(value) { return value && /^0x[0-9a-fA-F]{40}$/.test(value); }
async function hasCode(address) { return addressReady(address) && (await client.getCode({ address })).length > 2; }
async function policyConfigExists(id) { try { const [token] = await client.readContract({ address: POLICY, abi: policyAbi, functionName: "config", args: [id] }); return token !== "0x0000000000000000000000000000000000000000"; } catch { return false; } }

const stages = [
  { label: "Deploy bounded route administrator", signer: ADMIN },
  { label: "Nominate route administrator", signer: DEPLOYER },
  { label: "Accept policy administration", signer: ADMIN },
  { label: "Admit official routes 1–20", signer: ADMIN },
  { label: "Admit official routes 21–40", signer: ADMIN },
  { label: "Admit official routes 41–47", signer: ADMIN },
  { label: "Deploy official atomic factory", signer: ADMIN },
  { label: "Create ten empty smart-weight vaults", signer: ADMIN },
];

async function done(index) {
  if (index === 0) return hasCode(state.routeAdmin);
  if (!await hasCode(state.routeAdmin)) return false;
  if (index === 1) {
    const [owner, pending] = await Promise.all([client.readContract({ address: POLICY, abi: policyAbi, functionName: "owner" }), client.readContract({ address: POLICY, abi: policyAbi, functionName: "pendingOwner" })]);
    return owner.toLowerCase() === state.routeAdmin.toLowerCase() || pending.toLowerCase() === state.routeAdmin.toLowerCase();
  }
  if (index === 2) return (await client.readContract({ address: POLICY, abi: policyAbi, functionName: "owner" })).toLowerCase() === state.routeAdmin.toLowerCase();
  if (index >= 3 && index <= 5) {
    const start = (index - 3) * 20, end = Math.min(start + 20, ids.length);
    return (await Promise.all(ids.slice(start, end).map(policyConfigExists))).every(Boolean);
  }
  if (index === 6) return hasCode(state.factory);
  if (index === 7) {
    if (!await hasCode(state.factory)) return false;
    const vaults = await Promise.all(slugs.map((slug) => client.readContract({ address: state.factory, abi: factoryAbi, functionName: "bySlug", args: [slug] })));
    return vaults.every((vault) => vault !== "0x0000000000000000000000000000000000000000");
  }
  return false;
}

async function transaction(index) {
  if (index === 0) return { from: ADMIN, data: encodeDeployData({ abi: routeArtifact.abi, bytecode: routeArtifact.bytecode.object, args: [ADMIN, POLICY] }), value: 0n };
  if (!await hasCode(state.routeAdmin)) throw new Error("Route administrator has not been deployed");
  if (index === 1) return { from: DEPLOYER, to: POLICY, data: encodeFunctionData({ abi: policyAbi, functionName: "transferOwnership", args: [state.routeAdmin] }), value: 0n };
  if (index === 2) return { from: ADMIN, to: state.routeAdmin, data: encodeFunctionData({ abi: adminAbi, functionName: "acceptPolicyOwnership" }), value: 0n };
  if (index >= 3 && index <= 5) {
    const start = (index - 3) * 20, end = Math.min(start + 20, routes.length), subset = routes.slice(start, end);
    return { from: ADMIN, to: state.routeAdmin, data: encodeFunctionData({ abi: adminAbi, functionName: "approveRoutes", args: [subset.map((route) => route.token), subset.map((route) => route.buy), subset.map((route) => route.sell), evidence] }), value: 0n };
  }
  if (index === 6) return { from: ADMIN, data: encodeDeployData({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode.object, args: [ADMIN, ADMIN, IMPLEMENTATION, ids] }), value: 0n };
  if (index === 7) {
    if (!await hasCode(state.factory)) throw new Error("Atomic factory has not been deployed");
    return { from: ADMIN, to: state.factory, data: encodeFunctionData({ abi: factoryAbi, functionName: "createAtomicBatch", args: [slugs, params, vaultConfigs, vaultWeights] }), value: 0n };
  }
  throw new Error("Unknown stage");
}

async function prepare(index) {
  if (await done(index)) return { done: true, label: stages[index].label };
  for (let i = 0; i < index; i += 1) if (!await done(i)) throw new Error(`Complete step ${i + 1} first`);
  const raw = await transaction(index);
  const estimate = await client.estimateGas({ account: raw.from, to: raw.to, data: raw.data, value: raw.value });
  const fees = await client.estimateFeesPerGas();
  const gas = estimate * 125n / 100n;
  const maxFeePerGas = (fees.maxFeePerGas || fees.gasPrice) * 125n / 100n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas || 0n;
  const balance = await client.getBalance({ address: raw.from });
  const cap = gas * maxFeePerGas;
  if (balance < cap) throw new Error(`Signer balance is below the ${formatEther(cap)} ETH maximum gas reserve`);
  return { done: false, label: stages[index].label, signer: raw.from, cap: formatEther(cap), tx: { from: raw.from, ...(raw.to ? { to: raw.to } : {}), data: raw.data, value: "0x0", gas: `0x${gas.toString(16)}`, maxFeePerGas: `0x${maxFeePerGas.toString(16)}`, maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}` } };
}

async function verifyReceipt(index, hash) {
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  if (index === 0) state.routeAdmin = receipt.contractAddress;
  if (index === 6) state.factory = receipt.contractAddress;
  state.transactions[index] = hash;
  save();
  if (!await done(index)) throw new Error("Receipt succeeded but the expected state was not found");
  if (index === 7) {
    state.vaults = Object.fromEntries(await Promise.all(slugs.map(async (slug) => [slug, await client.readContract({ address: state.factory, abi: factoryAbi, functionName: "bySlug", args: [slug] })])));
    save();
  }
  return { confirmed: true, label: stages[index].label, feeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) };
}

const html = `<!doctype html><meta charset="utf-8"><title>HOODX · Launch official collections</title><style>body{background:#07110f;color:#ecf8f5;font:17px system-ui;max-width:900px;margin:32px auto;padding:24px}h1{font-size:38px}button{background:#50d5c8;border:0;border-radius:12px;padding:16px 20px;margin:6px 0;font:700 17px system-ui;cursor:pointer}button:disabled{opacity:.35}.step{border:1px solid #24423d;border-radius:16px;padding:12px 16px;margin:10px 0;display:flex;align-items:center;justify-content:space-between;gap:16px}.step small{color:#9cb6b0}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b8d0ca;border:1px solid #24423d;border-radius:14px;padding:16px}.tag{color:#50d5c8;text-transform:uppercase;font-size:12px;letter-spacing:.12em}</style><p class="tag">Reviewed official launch</p><h1>Ten collections. Smart from entry one.</h1><p>Square-root market-cap weights, 25% WETH reserve, 47 fork-tested routes, and the official curator wallet on every vault. The vaults launch empty.</p><p>Eight gas-only setup transactions. No token approvals, swaps, deposits, seed funds, or investor asset movement.</p><p><button id="connect">Connect Rabby</button></p>${stages.map((stage,index)=>`<div class="step"><div><strong>${index + 1}. ${stage.label}</strong><br><small>${stage.signer === ADMIN ? "Official curator" : "Infrastructure deployer"}</small></div><button id="stage-${index}" disabled>Sign</button></div>`).join("")}<pre id="status">Open this page in Brave. Connect Rabby and review each exact transaction.</pre><script src="/wallet.js"></script>`;
const js = `let provider;const providers=[];const status=document.querySelector('#status');const stages=${JSON.stringify(stages)};window.addEventListener('eip6963:announceProvider',e=>{if(!providers.some(p=>p.info.uuid===e.detail.info.uuid))providers.push(e.detail)});const request=()=>window.dispatchEvent(new Event('eip6963:requestProvider'));request();const wait=ms=>new Promise(r=>setTimeout(r,ms));async function next(){let found=stages.length;for(let i=0;i<stages.length;i++){const r=await fetch('/prepare?i='+i),p=await r.json();if(!p.done){found=i;break}}stages.forEach((_,i)=>document.querySelector('#stage-'+i).disabled=i!==found);return found}document.querySelector('#connect').onclick=async()=>{try{status.textContent='Finding Rabby…';request();await wait(350);provider=providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.rabby||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);if(!provider)throw Error('Rabby not detected. Enable Rabby for this Brave tab and retry.');await provider.request({method:'eth_requestAccounts'});if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});const i=await next();status.textContent=i<stages.length?'Connected. Step '+(i+1)+' is ready. Rabby may ask you to select the signer shown beside that step.':'Launch already complete.'}catch(e){status.textContent=e.message||String(e)}};for(let i=0;i<stages.length;i++)document.querySelector('#stage-'+i).onclick=async()=>{let submitted=false;const button=document.querySelector('#stage-'+i);button.disabled=true;try{if(!provider)throw Error('Connect Rabby first');const p=await(await fetch('/prepare?i='+i)).json();if(p.done){await next();status.textContent=p.label+' already verified.';return}const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==p.signer.toLowerCase())throw Error('Switch Rabby to '+p.signer+' for this step, then reconnect.');status.textContent='Review '+p.label+' in Rabby. Value: 0 ETH. Maximum gas reserve: '+p.cap+' ETH.';const hash=await provider.request({method:'eth_sendTransaction',params:[p.tx]});submitted=true;status.textContent='Submitted '+hash+' — verifying…';for(let n=0;n<120;n++){try{const v=await(await fetch('/receipt?i='+i+'&hash='+hash)).json();if(v.confirmed){status.textContent=v.label+' confirmed.\\n'+hash+'\\nGas paid: '+v.feeEth+' ETH';await next();return}if(v.error)throw Error(v.error)}catch(e){if(!/not found|pending/i.test(e.message||''))throw e}await wait(3000)}status.textContent='Still pending: '+hash+'. Do not submit again.'}catch(e){button.disabled=submitted;status.textContent=(e.message||String(e))+(submitted?'\\nCheck the receipt before retrying.':'\\nNo transaction was submitted.')}};`;

// Fail before opening the signer if the generated browser bundle is invalid.
new Function(js);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(html); }
    if (url.pathname === "/wallet.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); return res.end(js); }
    if (url.pathname === "/prepare") { const index = Number(url.searchParams.get("i")); const result = await prepare(index); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(result)); }
    if (url.pathname === "/receipt") { const index = Number(url.searchParams.get("i")), hash = url.searchParams.get("hash"); const result = await verifyReceipt(index, hash); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(result)); }
    res.writeHead(404); res.end();
  } catch (error) { res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: error.shortMessage || error.message || String(error) })); }
});
server.listen(PORT, "127.0.0.1", () => console.log(`HOODX official launch signer: http://127.0.0.1:${PORT}`));
