// Local, narrowly scoped Rabby handoff for the reviewed 696X MEME oracle repair.
// RPC stays server-side. Keys and signing stay in Rabby.
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
const vault = "0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292";
const meme = "0x385F4f8ae47651ce5F58F5265395a669f8281e18";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const factory = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const alternatePool = "0xE2c12a7379706A291CadAaEc1d22458be2f7239D";
const reviewedDepth = 16_229_335_552_032_950_196_823n;
const evidence = keccak256(toBytes("MEME_ALTERNATE_V3_REFERENCE_REVIEW_2026_09_22"));
const statePath = "deployments/robinhood-4663-meme-oracle-repair.json";
const stages = ["secondary", "redundant", "approve", "replace"];
const labels = ["Deploy alternate TWAP", "Deploy redundant oracle", "Approve MEME configuration", "Switch 696X configuration"];
const budgets = [2_000_000_000_000_000n, 1_500_000_000_000_000n, 1_000_000_000_000_000n, 1_000_000_000_000_000n];
const secondaryArtifact = JSON.parse(fs.readFileSync("out/HoodxTwapV2.sol/HoodxTwapV2.json", "utf8"));
const redundantArtifact = JSON.parse(fs.readFileSync("out/HoodxRedundantOracleV2.sol/HoodxRedundantOracleV2.json", "utf8"));

const vaultAbi = parseAbi([
  "function owner() view returns(address)", "function policy() view returns(address)",
  "function configId(address) view returns(bytes32)", "function replaceConfig(bytes32)",
  "function totalAssets() view returns(uint256)", "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function withdraw(uint256,uint256,uint256) returns(uint256)",
]);
const policyAbi = parseAbi([
  "function owner() view returns(address)",
  "function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)",
  "function approveConfig(address,address,bytes,bytes,bytes32) returns(bytes32)",
]);
const twapAbi = parseAbi([
  "function token() view returns(address)", "function pool() view returns(address)",
  "function minLiquidity() view returns(uint128)", "function value(address,uint256) view returns(uint256)",
]);
const redundantAbi = parseAbi([
  "function token() view returns(address)", "function primary() view returns(address)",
  "function secondary() view returns(address)", "function maxDivergenceBps() view returns(uint16)",
  "function value(address,uint256) view returns(uint256)",
]);

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { chainId: 4663, vault, token: meme, evidence, receipts: {} }; }
}
function saveState(state) { fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); }
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

async function baseline() {
  if (await client.getChainId() !== 4663) throw new Error("Wrong RPC chain");
  const [owner, policy, currentId] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "policy" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "configId", args: [meme] }),
  ]);
  const policyOwner = await client.readContract({ address: policy, abi: policyAbi, functionName: "owner" });
  if (!same(owner, account) || !same(policyOwner, account)) throw new Error("Curator ownership changed");
  const state = readState();
  const baseId = state.oldConfigId ?? currentId;
  const config = await client.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [baseId] });
  if (!same(config[0], meme)) throw new Error("MEME configuration identity mismatch");
  state.policy = policy; state.oldConfigId = baseId; state.primaryOracle = config[1];
  state.buy = config[2]; state.sell = config[3]; saveState(state);
  return { state, policy, currentId, config };
}

async function verifyStage(stage, state) {
  if (stage === "secondary") {
    if (!state.secondary) return false;
    const [token, pool, depth, price] = await Promise.all([
      client.readContract({ address: state.secondary, abi: twapAbi, functionName: "token" }),
      client.readContract({ address: state.secondary, abi: twapAbi, functionName: "pool" }),
      client.readContract({ address: state.secondary, abi: twapAbi, functionName: "minLiquidity" }),
      client.readContract({ address: state.secondary, abi: twapAbi, functionName: "value", args: [meme, 10n ** 18n] }),
    ]);
    return same(token, meme) && same(pool, alternatePool) && depth === reviewedDepth && price > 0n;
  }
  if (stage === "redundant") {
    if (!state.redundant || !state.secondary) return false;
    const [token, primary, secondary, divergence, price] = await Promise.all([
      client.readContract({ address: state.redundant, abi: redundantAbi, functionName: "token" }),
      client.readContract({ address: state.redundant, abi: redundantAbi, functionName: "primary" }),
      client.readContract({ address: state.redundant, abi: redundantAbi, functionName: "secondary" }),
      client.readContract({ address: state.redundant, abi: redundantAbi, functionName: "maxDivergenceBps" }),
      client.readContract({ address: state.redundant, abi: redundantAbi, functionName: "value", args: [meme, 10n ** 18n] }),
    ]);
    return same(token, meme) && same(primary, state.primaryOracle) && same(secondary, state.secondary) && divergence === 300 && price > 0n;
  }
  if (stage === "approve") {
    if (!state.newConfigId || !state.redundant) return false;
    try {
      const config = await client.readContract({ address: state.policy, abi: policyAbi, functionName: "config", args: [state.newConfigId] });
      return same(config[0], meme) && same(config[1], state.redundant) && config[2] === state.buy && config[3] === state.sell;
    } catch { return false; }
  }
  if (stage === "replace") {
    if (!state.newConfigId) return false;
    const id = await client.readContract({ address: vault, abi: vaultAbi, functionName: "configId", args: [meme] });
    return id === state.newConfigId;
  }
  return false;
}

async function build(stage) {
  const { state, policy } = await baseline();
  const i = stages.indexOf(stage);
  if (i < 0) throw new Error("Invalid stage");
  if (await verifyStage(stage, state)) return { done: true, stage, label: labels[i] };
  if (i > 0 && !(await verifyStage(stages[i - 1], state))) throw new Error(`Complete step ${i} first`);
  let to; let data;
  if (stage === "secondary") {
    data = encodeDeployData({ abi: secondaryArtifact.abi, bytecode: secondaryArtifact.bytecode.object, args: [factory, meme, weth, alternatePool, "0x0000000000000000000000000000000000000000", 1800, reviewedDepth, 0] });
  } else if (stage === "redundant") {
    data = encodeDeployData({ abi: redundantArtifact.abi, bytecode: redundantArtifact.bytecode.object, args: [meme, state.primaryOracle, state.secondary, 300] });
  } else if (stage === "approve") {
    to = policy;
    data = encodeFunctionData({ abi: policyAbi, functionName: "approveConfig", args: [meme, state.redundant, state.buy, state.sell, evidence] });
    state.newConfigId = keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "bytes" }, { type: "bytes" }, { type: "bytes32" }],
      [meme, state.redundant, state.buy, state.sell, evidence],
    ));
    saveState(state);
  } else {
    to = vault;
    data = encodeFunctionData({ abi: vaultAbi, functionName: "replaceConfig", args: [state.newConfigId] });
  }
  const tx = { account, data, value: 0n, ...(to ? { to } : {}) };
  const estimate = await client.estimateGas(tx);
  const gas = (estimate * 125n + 99n) / 100n;
  const price = await client.getGasPrice();
  const maxFeePerGas = price * 2n;
  if (gas * maxFeePerGas > budgets[i]) throw new Error("Current gas exceeds the reviewed step cap; wait and retry");
  if (await client.getBalance({ address: account }) < budgets.slice(i).reduce((sum, n) => sum + n, 0n)) throw new Error("Curator wallet balance is below the remaining reviewed gas reserve");
  state.prepared ??= {};
  state.prepared[stage] = { to: to ?? null, data };
  saveState(state);
  return {
    done: false, stage, label: labels[i], cap: formatEther(gas * maxFeePerGas),
    tx: { from: account, ...(to ? { to } : {}), data, value: "0x0", chainId: "0x1237", gas: toHex(gas), maxFeePerGas: toHex(maxFeePerGas), maxPriorityFeePerGas: "0x0" },
  };
}

async function verifyReceipt(stage, hash) {
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch { return { confirmed: false }; }
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  const tx = await client.getTransaction({ hash });
  const state = readState();
  const prepared = state.prepared?.[stage];
  if (!prepared || !same(tx.from, account) || tx.value !== 0n || tx.input.toLowerCase() !== prepared.data.toLowerCase()) {
    throw new Error("Transaction identity mismatch");
  }
  if (stage === "secondary" || stage === "redundant") {
    if (prepared.to !== null || tx.to !== null || !receipt.contractAddress) throw new Error("Deployment identity mismatch");
    state[stage] = receipt.contractAddress;
  } else {
    const expected = prepared.to;
    if (!same(tx.to, expected)) throw new Error("Transaction target mismatch");
  }
  state.receipts[stage] = { hash, block: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice) };
  saveState(state);
  if (!(await verifyStage(stage, state))) throw new Error("Post-transaction state verification failed");
  const result = { confirmed: true, stage, hash, feeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) };
  if (stage === "replace") {
    const [shares, supply, assets] = await Promise.all([
      client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
    ]);
    const minimum = assets * shares / supply * 95n / 100n;
    const { result: quoted } = await client.simulateContract({ address: vault, abi: vaultAbi, account, functionName: "withdraw", args: [shares, minimum, BigInt(Math.floor(Date.now() / 1000) + 300)] });
    state.maxExitCheck = { checkedAt: new Date().toISOString(), shares: String(shares), minimumWei: String(minimum), quotedWei: String(quoted) };
    saveState(state);
    result.maxExitEth = formatEther(quoted);
  }
  return result;
}

const page = `<!doctype html><meta charset="utf-8"><title>HOODX · Repair MEME exit</title>
<style>body{background:#091412;color:#e5f5f1;font:18px system-ui;max-width:850px;margin:55px auto;padding:24px}button{background:#4bd0c1;border:0;border-radius:10px;padding:16px;margin:8px;font:inherit;cursor:pointer}button:disabled{opacity:.35}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#afcbc3}.step{border:1px solid #25423d;border-radius:14px;padding:12px;margin:12px 0}small{color:#afcbc3}</style>
<h1>HOODX · Restore MEME ETH exits</h1><p>This keeps the existing 696X vault and assets. It adds a second immutable MEME/WETH TWAP at the same absolute depth floor, then installs a redundant oracle that rejects disagreement above 3%.</p><p>Four gas-only transactions. No token approval, transfer, swap, withdrawal, or migration occurs on this page. Combined gas caps: 0.0055 ETH.</p><small>Robinhood Chain · 4663<br>Curator: ${account}<br>Vault: ${vault}</small><p><button id="connect">Connect Rabby</button></p>${stages.map((s, i) => `<div class="step"><button id="${s}" disabled>${i + 1}. ${labels[i]}</button></div>`).join("")}<pre id="status">Connect the curator wallet. Review every transaction in Rabby.</pre><script src="/wallet.js"></script>`;
const js = `let provider;const providers=[];const status=document.querySelector('#status');const stages=${JSON.stringify(stages)};window.addEventListener('eip6963:announceProvider',e=>providers.push(e.detail));window.dispatchEvent(new Event('eip6963:requestProvider'));
const enable=i=>stages.forEach((s,n)=>document.querySelector('#'+s).disabled=n!==i);
document.querySelector('#connect').onclick=async()=>{try{provider=providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);if(!provider)throw Error('Rabby not detected. Open this page in Brave with Rabby enabled.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Select the approved curator wallet in Rabby.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});enable(0);status.textContent='Connected. Start with step 1. Each step is checked immediately before Rabby opens.';}catch(e){status.textContent=e.message;}};
for(const [i,stage]of stages.entries())document.querySelector('#'+stage).onclick=async()=>{const button=document.querySelector('#'+stage);button.disabled=true;let requested=false;try{if(localStorage.getItem('hoodx-meme-repair-'+stage)||localStorage.getItem('hoodx-meme-repair-pending-'+stage))throw Error('A previous '+stage+' request exists. Check its receipt before retrying.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)throw Error('Wrong network');const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Wrong wallet');status.textContent='Refreshing state, gas and balance for '+stage+'…';const response=await fetch('/prepare?stage='+stage);const prepared=await response.json();if(!response.ok)throw Error(prepared.error);if(prepared.done){status.textContent=prepared.label+' is already verified.';enable(i+1);return;}status.textContent='Review '+prepared.label+' in Rabby. Maximum gas cost '+prepared.cap+' ETH.';requested=true;localStorage.setItem('hoodx-meme-repair-pending-'+stage,'true');const hash=await provider.request({method:'eth_sendTransaction',params:[prepared.tx]});localStorage.setItem('hoodx-meme-repair-'+stage,hash);localStorage.removeItem('hoodx-meme-repair-pending-'+stage);status.textContent='Submitted '+hash+' — verifying receipt…';for(let n=0;n<120;n++){const check=await(await fetch('/receipt?stage='+stage+'&hash='+hash)).json();if(check.confirmed){status.textContent=prepared.label+' confirmed. '+hash+'\\nGas paid: '+check.feeEth+' ETH'+(check.maxExitEth?'\\nFull Max exit now simulates: '+check.maxExitEth+' ETH':'');enable(i+1);return;}if(check.error)throw Error(check.error);await new Promise(r=>setTimeout(r,3000));}status.textContent='Still pending: '+hash+'. Do not submit again.';}catch(e){if(e.code===4001){requested=false;localStorage.removeItem('hoodx-meme-repair-pending-'+stage);}const recorded=localStorage.getItem('hoodx-meme-repair-'+stage)||localStorage.getItem('hoodx-meme-repair-pending-'+stage);button.disabled=requested||!!recorded;status.textContent=e.message+(button.disabled?'\\nCheck the wallet request or receipt before retrying.':'\\nNo transaction was submitted. You can retry this check.');}};`;

const server = httpServer.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  if (req.headers.host !== "127.0.0.1:8795" || req.method !== "GET") { res.writeHead(403); return res.end(); }
  try {
    const url = new URL(req.url, "http://127.0.0.1:8795");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(page); }
    if (url.pathname === "/wallet.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); }
    res.setHeader("Content-Type", "application/json");
    const stage = url.searchParams.get("stage");
    if (!stages.includes(stage)) throw new Error("Invalid stage");
    if (url.pathname === "/prepare") return res.end(JSON.stringify(await build(stage)));
    if (url.pathname === "/receipt") {
      const hash = url.searchParams.get("hash");
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) throw new Error("Invalid hash");
      return res.end(JSON.stringify(await verifyReceipt(stage, hash)));
    }
    res.writeHead(404); return res.end("{}");
  } catch (error) {
    res.writeHead(400);
    const message = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "<redacted>") : "Request failed";
    return res.end(JSON.stringify({ error: message }));
  }
});
server.listen(8795, "127.0.0.1", () => console.log("Wallet handoff: http://127.0.0.1:8795"));
