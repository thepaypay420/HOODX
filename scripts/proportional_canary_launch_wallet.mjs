import fs from "node:fs";
import http from "node:http";
import { execFileSync } from "node:child_process";
import {
  createPublicClient,
  custom,
  formatEther,
  getAddress,
  keccak256,
  parseAbi,
} from "viem";

const PORT = 8796;
const ZERO = "0x0000000000000000000000000000000000000000";
const readiness = JSON.parse(fs.readFileSync("deployments/proportional-canary-live-readiness.json", "utf8"));
const envelope = JSON.parse(fs.readFileSync("deployments/proportional-canary-signing-envelope-2026-09-26.json", "utf8"));
if (!readiness.ready || readiness.broadcast || envelope.safety?.broadcastsPerformed !== false) {
  throw new Error("Reviewed readiness checkpoint is missing");
}
if (envelope.routeFingerprint !== readiness.expectedRouteFingerprint || envelope.transactions.length !== 5) {
  throw new Error("Signing envelope mismatch");
}

const rpcUrl = process.env.ROBINHOOD_RPC_URL
  || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim();
const transport = custom({
  async request({ method, params }) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] });
    // The 20-route admission is intentionally near the supported batch ceiling and
    // takes longer to simulate on a fork. Keep ordinary reads tightly bounded while
    // giving this required pre-signature simulation a finite, explicit budget.
    const timeoutSeconds = method === "eth_estimateGas" ? "120" : "25";
    let output;
    try {
      output = execFileSync("curl.exe", [
        "--silent", "--show-error", "--fail-with-body", "--max-time", timeoutSeconds,
        "--header", "content-type: application/json", "--data-binary", "@-", rpcUrl,
      ], { input: payload, encoding: "utf8", windowsHide: true });
    } catch {
      throw new Error(`RPC request failed for ${method}`);
    }
    const response = JSON.parse(output);
    if (response.error) throw new Error(response.error.message || `RPC error for ${method}`);
    return response.result;
  },
});
const client = createPublicClient({ transport });

const registry = getAddress(readiness.contracts.registry.address);
const policy = getAddress(readiness.contracts.policy.address);
const routeAdmin = getAddress(readiness.contracts.routeAdmin.address);
const factory = getAddress(readiness.contracts.factory.address);
const hooks = readiness.hooks.map((item) => getAddress(item.address));
const registryAbi = parseAbi([
  "function owner() view returns(address)",
  "function isApprovedHook(address) view returns(bool)",
  "function approvedCodeHash(address) view returns(bytes32)",
  "function proposals(address) view returns(bytes32 codeHash,bytes32 evidence,uint256 readyAt)",
]);
const policyAbi = parseAbi([
  "function owner() view returns(address)",
  "function config(bytes32) view returns(address,address,bytes,bytes)",
]);
const routeAdminAbi = parseAbi([
  "function owner() view returns(address)",
  "function policy() view returns(address)",
  "function MAX_BATCH() view returns(uint256)",
]);
const factoryAbi = parseAbi([
  "function owner() view returns(address)",
  "function treasury() view returns(address)",
  "function implementation() view returns(address)",
  "function bySlug(string) view returns(address)",
]);
const vaultAbi = parseAbi([
  "function owner() view returns(address)",
  "function creator() view returns(address)",
  "function creatorRecipient() view returns(address)",
  "function treasury() view returns(address)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function creatorFeeBps() view returns(uint16)",
  "function protocolFeeBps() view returns(uint16)",
  "function cashTargetBps() view returns(uint16)",
  "function minFirstDeposit() view returns(uint256)",
  "function totalSupply() view returns(uint256)",
  "function policy() view returns(address)",
  "function constituents() view returns(address[])",
  "function configId(address) view returns(bytes32)",
  "function targetBps(address) view returns(uint16)",
]);

function same(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

async function configExists(id) {
  try {
    const [token] = await client.readContract({ address: policy, abi: policyAbi, functionName: "config", args: [id] });
    return token !== ZERO;
  } catch {
    return false;
  }
}

async function canaryMatches(address) {
  const expectedTokens = envelope.routeTokensByTransaction.flat();
  const expectedIds = envelope.routeIdsByTransaction.flat();
  const [owner, creator, recipient, treasury, name, symbol, creatorFee, protocolFee, cashTarget,
    firstDeposit, supply, vaultPolicy, tokens, nativeBalance] = await Promise.all([
    client.readContract({ address, abi: vaultAbi, functionName: "owner" }),
    client.readContract({ address, abi: vaultAbi, functionName: "creator" }),
    client.readContract({ address, abi: vaultAbi, functionName: "creatorRecipient" }),
    client.readContract({ address, abi: vaultAbi, functionName: "treasury" }),
    client.readContract({ address, abi: vaultAbi, functionName: "name" }),
    client.readContract({ address, abi: vaultAbi, functionName: "symbol" }),
    client.readContract({ address, abi: vaultAbi, functionName: "creatorFeeBps" }),
    client.readContract({ address, abi: vaultAbi, functionName: "protocolFeeBps" }),
    client.readContract({ address, abi: vaultAbi, functionName: "cashTargetBps" }),
    client.readContract({ address, abi: vaultAbi, functionName: "minFirstDeposit" }),
    client.readContract({ address, abi: vaultAbi, functionName: "totalSupply" }),
    client.readContract({ address, abi: vaultAbi, functionName: "policy" }),
    client.readContract({ address, abi: vaultAbi, functionName: "constituents" }),
    client.getBalance({ address }),
  ]);
  if (!same(owner, readiness.signers.curator.address)
    || !same(creator, readiness.signers.deployer.address)
    || !same(recipient, readiness.signers.curator.address)
    || !same(treasury, readiness.signers.curator.address)
    || name !== "696X Successor Canary" || symbol !== "696XC"
    || creatorFee !== 40 || protocolFee !== 10 || cashTarget !== 2500
    || firstDeposit !== 20_000_000_000_000_000n || supply !== 0n || nativeBalance !== 0n
    || !same(vaultPolicy, policy) || tokens.length !== expectedTokens.length) return false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (!same(tokens[index], expectedTokens[index])) return false;
    const [id, target] = await Promise.all([
      client.readContract({ address, abi: vaultAbi, functionName: "configId", args: [tokens[index]] }),
      client.readContract({ address, abi: vaultAbi, functionName: "targetBps", args: [tokens[index]] }),
    ]);
    if (id !== expectedIds[index] || target !== (index < 3 ? 358 : 357)) return false;
  }
  return true;
}

async function done(index) {
  if (index === 0 || index === 1) {
    return client.readContract({ address: registry, abi: registryAbi, functionName: "isApprovedHook", args: [hooks[index]] });
  }
  if (index === 2 || index === 3) {
    const ids = envelope.routeIdsByTransaction[index - 2];
    return (await Promise.all(ids.map(configExists))).every(Boolean);
  }
  if (index === 4) {
    const vault = await client.readContract({ address: factory, abi: factoryAbi, functionName: "bySlug", args: ["696xcanary"] });
    if (vault === ZERO) return false;
    if (!await canaryMatches(vault)) throw new Error("The 696xcanary slug is occupied by an unexpected vault");
    return true;
  }
  throw new Error("Unknown signing step");
}

async function assertPinnedState() {
  const [chainId, registryOwner, policyOwner, adminOwner, adminPolicy, maxBatch,
    factoryOwner, treasury, implementation, canary] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: registry, abi: registryAbi, functionName: "owner" }),
    client.readContract({ address: policy, abi: policyAbi, functionName: "owner" }),
    client.readContract({ address: routeAdmin, abi: routeAdminAbi, functionName: "owner" }),
    client.readContract({ address: routeAdmin, abi: routeAdminAbi, functionName: "policy" }),
    client.readContract({ address: routeAdmin, abi: routeAdminAbi, functionName: "MAX_BATCH" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "owner" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "treasury" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "implementation" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "bySlug", args: ["696xcanary"] }),
  ]);
  if (chainId !== 4663
    || !same(registryOwner, readiness.contracts.registry.owner)
    || !same(policyOwner, readiness.contracts.policy.owner)
    || !same(adminOwner, readiness.contracts.routeAdmin.owner)
    || !same(adminPolicy, policy)
    || maxBatch !== 20n
    || !same(factoryOwner, readiness.contracts.factory.owner)
    || !same(treasury, readiness.contracts.factory.treasury)
    || !same(implementation, readiness.contracts.factory.implementation)) {
    throw new Error("A pinned role or dependency changed");
  }
  for (let index = 0; index < hooks.length; index += 1) {
    const [proposal, active, approvedHash, code] = await Promise.all([
      client.readContract({ address: registry, abi: registryAbi, functionName: "proposals", args: [hooks[index]] }),
      client.readContract({ address: registry, abi: registryAbi, functionName: "isApprovedHook", args: [hooks[index]] }),
      client.readContract({ address: registry, abi: registryAbi, functionName: "approvedCodeHash", args: [hooks[index]] }),
      client.getCode({ address: hooks[index] }),
    ]);
    const expected = readiness.hooks[index];
    const liveHash = keccak256(code);
    const pendingMatches = proposal[0] === expected.proposedHash && proposal[1] === expected.evidence
      && proposal[2].toString() === expected.readyAt;
    const activeMatches = active && approvedHash === expected.liveHash;
    if (liveHash !== expected.liveHash || (!pendingMatches && !activeMatches)) {
      throw new Error("A hook proposal or code hash changed");
    }
  }
  return canary;
}

async function prepare(index) {
  if (!Number.isInteger(index) || index < 0 || index >= envelope.transactions.length) throw new Error("Invalid step");
  await assertPinnedState();
  if (await done(index)) return { done: true, label: envelope.transactions[index].label };
  for (let earlier = 0; earlier < index; earlier += 1) {
    if (!await done(earlier)) throw new Error(`Complete step ${earlier + 1} first`);
  }
  const reviewed = envelope.transactions[index];
  const signer = getAddress(reviewed.signer);
  const to = getAddress(reviewed.to);
  if (keccak256(reviewed.data) !== reviewed.dataHash) throw new Error("Reviewed calldata changed");
  const [estimate, fees, balance, latestNonce, pendingNonce] = await Promise.all([
    client.estimateGas({ account: signer, to, data: reviewed.data, value: 0n }),
    client.estimateFeesPerGas(),
    client.getBalance({ address: signer }),
    client.getTransactionCount({ address: signer, blockTag: "latest" }),
    client.getTransactionCount({ address: signer, blockTag: "pending" }),
  ]);
  if (pendingNonce !== latestNonce) throw new Error("Signer has a pending transaction; resolve it before continuing");
  const gas = (estimate * 125n + 99n) / 100n;
  const maxFeePerGas = ((fees.maxFeePerGas || fees.gasPrice) * 125n + 99n) / 100n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas || 0n;
  const cap = gas * maxFeePerGas;
  if (gas > BigInt(reviewed.gasLimit)) throw new Error("Fresh gas estimate exceeds the reviewed gas limit");
  if (cap > BigInt(reviewed.maximumCostWei)) throw new Error("Fresh maximum fee exceeds the reviewed spending cap");
  if (balance < cap) throw new Error("Signer balance is below the reviewed maximum gas reserve");
  return {
    done: false,
    label: reviewed.label,
    signer,
    cap: formatEther(cap),
    tx: {
      from: signer,
      to,
      data: reviewed.data,
      value: "0x0",
      gas: `0x${gas.toString(16)}`,
      maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
      maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
    },
  };
}

async function verifyReceipt(index, hash) {
  const reviewed = envelope.transactions[index];
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  if (!same(transaction.from, reviewed.signer) || !same(transaction.to, reviewed.to)
    || transaction.value !== 0n || keccak256(transaction.input) !== reviewed.dataHash) {
    throw new Error("Confirmed transaction does not match the reviewed envelope");
  }
  if (!await done(index)) throw new Error("Receipt succeeded but the expected state was not found");
  return {
    confirmed: true,
    label: reviewed.label,
    feeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
  };
}

const steps = envelope.transactions.map(({ label, signer, maximumCostEth }) => ({ label, signer, maximumCostEth }));
const html = `<!doctype html><meta charset="utf-8"><title>HOODX · Prepare 696X successor</title><style>body{background:#07110f;color:#ecf8f5;font:17px system-ui;max-width:900px;margin:32px auto;padding:24px}h1{font-size:38px}button{background:#50d5c8;border:0;border-radius:12px;padding:16px 20px;margin:6px 0;font:700 17px system-ui;cursor:pointer}button:disabled{opacity:.35}.step{border:1px solid #24423d;border-radius:16px;padding:12px 16px;margin:10px 0;display:flex;align-items:center;justify-content:space-between;gap:16px}.step small{color:#9cb6b0}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b8d0ca;border:1px solid #24423d;border-radius:14px;padding:16px}.tag{color:#50d5c8;text-transform:uppercase;font-size:12px;letter-spacing:.12em}</style><p class="tag">Reviewed 21-asset successor canary</p><h1>Prepare the full 696X watchlist.</h1><p>Five gas-only transactions activate two matured hooks, admit the exact 21 reviewed routes, and create an empty canary. No deposit, swap, token approval, migration, or existing 696X vault call occurs.</p><p>Total reviewed maximum gas reserve: ${envelope.totalMaximumCostEth} ETH.</p><p><button id="connect">Connect Rabby</button></p>${steps.map((step,index)=>`<div class="step"><div><strong>${index + 1}. ${step.label}</strong><br><small>${step.signer} · max ${step.maximumCostEth} ETH</small></div><button id="stage-${index}" disabled>Sign</button></div>`).join("")}<pre id="status">Open this page in Brave. Connect Rabby and review each exact transaction.</pre><script src="/wallet.js"></script>`;
const browserJs = `let provider;const providers=[];const status=document.querySelector('#status');const steps=${JSON.stringify(steps)};window.addEventListener('eip6963:announceProvider',e=>{if(!providers.some(p=>p.info.uuid===e.detail.info.uuid))providers.push(e.detail)});const request=()=>window.dispatchEvent(new Event('eip6963:requestProvider'));const wait=ms=>new Promise(r=>setTimeout(r,ms));request();async function next(){let found=steps.length;for(let i=0;i<steps.length;i++){const r=await fetch('/prepare?i='+i),p=await r.json();if(!r.ok)throw Error(p.error);if(!p.done){found=i;break}}steps.forEach((_,i)=>document.querySelector('#stage-'+i).disabled=i!==found);return found}document.querySelector('#connect').onclick=async()=>{try{status.textContent='Finding Rabby…';request();await wait(350);provider=providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.rabby||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);if(!provider)throw Error('Rabby not detected. Enable Rabby for this Brave tab and retry.');await provider.request({method:'eth_requestAccounts'});if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});const i=await next();status.textContent=i<steps.length?'Connected. Step '+(i+1)+' is ready. Select the signer printed beside that step.':'All five preparation steps are complete.'}catch(e){status.textContent=e.message||String(e)}};for(let i=0;i<steps.length;i++)document.querySelector('#stage-'+i).onclick=async()=>{let submitted=false;const button=document.querySelector('#stage-'+i);button.disabled=true;try{if(!provider)throw Error('Connect Rabby first');const r=await fetch('/prepare?i='+i),p=await r.json();if(!r.ok)throw Error(p.error);if(p.done){await next();status.textContent=p.label+' already verified.';return}const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==p.signer.toLowerCase())throw Error('Switch Rabby to '+p.signer+' for this step, then reconnect.');status.textContent='Review '+p.label+'. Value: 0 ETH. Fresh maximum gas: '+p.cap+' ETH.';const hash=await provider.request({method:'eth_sendTransaction',params:[p.tx]});submitted=true;status.textContent='Submitted '+hash+' — verifying…';for(let n=0;n<120;n++){try{const v=await(await fetch('/receipt?i='+i+'&hash='+hash)).json();if(v.confirmed){status.textContent=v.label+' confirmed.\\n'+hash+'\\nGas paid: '+v.feeEth+' ETH';await next();return}if(v.error&&!/not found|not be found|pending/i.test(v.error))throw Error(v.error)}catch(e){if(!/not found|not be found|pending/i.test(e.message||''))throw e}await wait(3000)}status.textContent='Still pending: '+hash+'. Do not submit again.'}catch(e){button.disabled=submitted;status.textContent=(e.message||String(e))+(submitted?'\\nCheck the receipt before retrying.':'\\nNo transaction was submitted.')}};`;
new Function(browserJs);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return response.end(html);
    }
    if (url.pathname === "/wallet.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      return response.end(browserJs);
    }
    if (url.pathname === "/prepare") {
      const result = await prepare(Number(url.searchParams.get("i")));
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return response.end(JSON.stringify(result));
    }
    if (url.pathname === "/receipt") {
      const result = await verifyReceipt(Number(url.searchParams.get("i")), url.searchParams.get("hash"));
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return response.end(JSON.stringify(result));
    }
    response.writeHead(404);
    response.end();
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: error.shortMessage || error.message || String(error) }));
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`HOODX 696X successor signer: http://127.0.0.1:${PORT}`));
