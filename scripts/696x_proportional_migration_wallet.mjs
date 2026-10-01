// Local, narrowly scoped Rabby handoff: launch $696X on the proportional (oracle-free) vault through the
// atomic factory. RPC stays server-side. Keys and signing stay in Rabby. The legacy V2 vault is not touched.
// Rehearsed on a fork by test/v3/Proportional696xLiveFork.t.sol (test696xAtomicMigrationRehearsal).
import httpServer from "node:http";
import fs from "node:fs";
import {
  createPublicClient, http, parseAbi, encodeFunctionData, encodeAbiParameters, decodeErrorResult,
  keccak256, toBytes, toHex, formatEther, parseEther, zeroAddress, BaseError, ContractFunctionRevertedError,
} from "viem";

const rpc = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
delete process.env.ROBINHOOD_RPC_URL;
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
const PORT = Number(process.env.HOODX_HANDOFF_PORT || 8796);
// Rehearsal only: a local fork (anvil) reports its own gas price, so the real chain's price can be supplied instead.
// Ignored unless the RPC is a loopback fork, so it cannot affect a live run.
const forkGasPrice = /^https?:\/\/127\.0\.0\.1[:/]/.test(rpc) && process.env.HOODX_FORK_GAS_PRICE_WEI ? BigInt(process.env.HOODX_FORK_GAS_PRICE_WEI) : null;

const account = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6";          // curator: owns the route admin and the atomic factory
const legacyVault = "0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292";      // V2 $696X (read only: source of the basket and routes)
const routeAdmin = "0x49bAe4Eb7b7a7567f67A600Ca8752027e9d12Fa3";
const proportionalPolicy = "0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21";
const atomicFactory = "0x29349C79863B58E7ab470865F7C6Df0b31dC7C17";
const reviewedImplementation = "0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7";
const slug = "696x";
const image = "https://www.xhoodindex.com/vaults/696x.png";
const evidence = keccak256(toBytes("HOODX_696X_PROPORTIONAL_MIGRATION_2026_10_01"));
const seedWei = parseEther(process.env.HOODX_696X_SEED_ETH || "0.02"); // vault minimum first deposit; raise with HOODX_696X_SEED_ETH
const statePath = process.env.HOODX_696X_STATE || "deployments/robinhood-4663-696x-proportional-migration.json";
const stages = ["approve", "register", "create", "seed"];
const labels = ["Approve the 8 token routes", "Register the routes with the factory", "Create the 696X proportional vault", `Seed the vault with ${formatEther(seedWei)} ETH`];
// ~3x the gas measured on a fork at the live gas price (0.0004 / 0.00008 / 0.00046 / 0.00039 ETH)
const gasCaps = [1_200_000_000_000_000n, 400_000_000_000_000n, 1_500_000_000_000_000n, 1_200_000_000_000_000n];

const legacyAbi = parseAbi([
  "function constituents() view returns(address[])", "function configId(address) view returns(bytes32)",
  "function targetBps(address) view returns(uint16)", "function policy() view returns(address)",
]);
const legacyPolicyAbi = parseAbi(["function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)"]);
const routeAdminAbi = parseAbi([
  "function owner() view returns(address)",
  "function approveRoutes(address[] tokens,bytes[] buys,bytes[] sells,bytes32 evidence) returns(bytes32[] ids)",
]);
const policyAbi = parseAbi(["function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)"]);
const factoryAbi = parseAbi([
  "function owner() view returns(address)", "function implementation() view returns(address)", "function treasury() view returns(address)",
  "function bySlug(string) view returns(address)", "function configIdByToken(address) view returns(bytes32)",
  "function registerConfigs(bytes32[] ids)",
  "function createAtomic(string slug,(address curator,address creator,address recipient,address treasury,string name,string symbol,uint16 creatorFee,uint16 protocolFee,uint16 cashBps,uint256 firstDeposit,string imageURI) p,bytes32[] configs,uint16[] weights) returns (address vault,address controller)",
]);
const vaultAbi = parseAbi([
  "function owner() view returns(address)", "function creator() view returns(address)", "function creatorFeeBps() view returns(uint16)",
  "function constituents() view returns(address[])", "function totalSupply() view returns(uint256)", "function planNonce() view returns(uint256)",
  "function targetBps(address) view returns(uint16)", "function cashTargetBps() view returns(uint16)", "function balanceOf(address) view returns(uint256)",
  "function quoteBuys(uint256[] budgets) payable",
  "function bootstrap(uint256[] floors,uint256 nonce,uint256 deadline) payable returns(uint256 shares)",
  "error BuyQuote(uint256[] outputs)", "error QuoteUnavailable()",
]);
const tokenAbi = parseAbi(["function symbol() view returns(string)"]);

const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const big = (k, v) => (typeof v === "bigint" ? v.toString() : v);
function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { chainId: 4663, slug, legacyVault, atomicFactory, evidence, receipts: {} }; }
}
function saveState(state) { fs.writeFileSync(statePath, JSON.stringify(state, big, 2) + "\n"); }

/** The basket is frozen the first time it is read, so every later step uses the exact approved inputs. */
async function baseline() {
  if (await client.getChainId() !== 4663) throw new Error("Wrong RPC chain");
  const [adminOwner, factoryOwner, implementation, treasury] = await Promise.all([
    client.readContract({ address: routeAdmin, abi: routeAdminAbi, functionName: "owner" }),
    client.readContract({ address: atomicFactory, abi: factoryAbi, functionName: "owner" }),
    client.readContract({ address: atomicFactory, abi: factoryAbi, functionName: "implementation" }),
    client.readContract({ address: atomicFactory, abi: factoryAbi, functionName: "treasury" }),
  ]);
  if (!same(adminOwner, account) || !same(factoryOwner, account)) throw new Error("Curator ownership changed");
  if (!same(implementation, reviewedImplementation)) throw new Error("Factory implementation is not the reviewed build");
  const state = readState();
  if (!state.tokens) {
    const legacyPolicy = await client.readContract({ address: legacyVault, abi: legacyAbi, functionName: "policy" });
    const all = await client.readContract({ address: legacyVault, abi: legacyAbi, functionName: "constituents" });
    const rows = [];
    for (const token of all) {
      const target = await client.readContract({ address: legacyVault, abi: legacyAbi, functionName: "targetBps", args: [token] });
      if (target === 0) continue;
      const id = await client.readContract({ address: legacyVault, abi: legacyAbi, functionName: "configId", args: [token] });
      const [configured, , buy, sell] = await client.readContract({ address: legacyPolicy, abi: legacyPolicyAbi, functionName: "config", args: [id] });
      if (!same(configured, token)) throw new Error("Legacy route identity mismatch");
      const [symbol, code] = await Promise.all([
        client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }), client.getCode({ address: token }),
      ]);
      rows.push({ token, symbol, target, buy, sell, codehash: keccak256(code) });
    }
    if (rows.length !== 8) throw new Error("Expected the eight held 696X constituents");
    // keep today's relative weights, rescaled so holdings + 25% cash = 100%
    const sum = rows.reduce((n, r) => n + r.target, 0);
    const weights = rows.map((r) => Math.floor(r.target * 7500 / sum));
    weights[0] += 7500 - weights.reduce((n, w) => n + w, 0);
    state.tokens = rows.map((r) => r.token); state.symbols = rows.map((r) => r.symbol);
    state.buys = rows.map((r) => r.buy); state.sells = rows.map((r) => r.sell); state.weights = weights;
    // policy id = keccak256(abi.encode(token, token.codehash, buy, sell, evidence))
    state.ids = rows.map((r) => keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "bytes" }, { type: "bytes" }, { type: "bytes32" }],
      [r.token, r.codehash, r.buy, r.sell, evidence],
    )));
    state.treasury = treasury;
    saveState(state);
  }
  return state;
}

async function verifyStage(stage, state) {
  if (stage === "approve") {
    for (const [i, id] of state.ids.entries()) {
      try {
        const [token, , buy, sell] = await client.readContract({ address: proportionalPolicy, abi: policyAbi, functionName: "config", args: [id] });
        if (!same(token, state.tokens[i]) || buy !== state.buys[i] || sell !== state.sells[i]) return false;
      } catch { return false; }
    }
    return true;
  }
  if (stage === "register") {
    for (const [i, id] of state.ids.entries()) {
      if (await client.readContract({ address: atomicFactory, abi: factoryAbi, functionName: "configIdByToken", args: [state.tokens[i]] }) !== id) return false;
    }
    return true;
  }
  const vault = await client.readContract({ address: atomicFactory, abi: factoryAbi, functionName: "bySlug", args: [slug] });
  if (vault === zeroAddress) return false;
  if (stage === "create") {
    const [creator, fee, held, cash, code] = await Promise.all([
      client.readContract({ address: vault, abi: vaultAbi, functionName: "creator" }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "creatorFeeBps" }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "constituents" }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "cashTargetBps" }),
      client.getCode({ address: vault }),
    ]);
    const clone = `0x363d3d373d3d3d363d73${reviewedImplementation.slice(2)}5af43d82803e903d91602b57fd5bf3`.toLowerCase();
    const ok = same(creator, account) && fee === 40 && cash === 2500 && code?.toLowerCase() === clone
      && held.length === state.tokens.length && held.every((t, i) => same(t, state.tokens[i]));
    if (ok && !same(state.vault, vault)) { state.vault = vault; state.controller = await client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }); saveState(state); }
    return ok;
  }
  if (stage === "seed") return await client.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }) > 0n;
  return false;
}

/** quoteBuys always reverts; a successful simulation reverts with BuyQuote(outputs). */
async function quoteSeed(vault, budgets, funding) {
  try {
    await client.simulateContract({ address: vault, abi: vaultAbi, account, functionName: "quoteBuys", args: [budgets], value: funding });
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === "BuyQuote") return revert.data.args[0];
    if (revert instanceof ContractFunctionRevertedError && revert.raw) {
      try { const d = decodeErrorResult({ abi: vaultAbi, data: revert.raw }); if (d.errorName === "BuyQuote") return d.args[0]; } catch { /* fall through */ }
    }
    throw new Error("Seed quote unavailable: a route cannot fill right now. Nothing was sent.");
  }
  throw new Error("Unexpected quote response");
}

async function build(stage) {
  const state = await baseline();
  const i = stages.indexOf(stage);
  if (i < 0) throw new Error("Invalid stage");
  if (await verifyStage(stage, state)) return { done: true, stage, label: labels[i] };
  if (i > 0 && !(await verifyStage(stages[i - 1], state))) throw new Error(`Complete step ${i} first`);
  // Balance first, so a short wallet is reported as that and not as a failed quote.
  const need = gasCaps.slice(i).reduce((sum, n) => sum + n, 0n) + seedWei;
  const balance = await client.getBalance({ address: account });
  if (balance < need) throw new Error(`Curator wallet holds ${formatEther(balance)} ETH; the remaining steps need ${formatEther(need)} ETH (seed ${formatEther(seedWei)} + gas reserve). Top up, or lower the seed with HOODX_696X_SEED_ETH (minimum 0.02).`);
  let to; let data; let value = 0n; let note = "";
  if (stage === "approve") {
    to = routeAdmin;
    data = encodeFunctionData({ abi: routeAdminAbi, functionName: "approveRoutes", args: [state.tokens, state.buys, state.sells, evidence] });
  } else if (stage === "register") {
    to = atomicFactory;
    data = encodeFunctionData({ abi: factoryAbi, functionName: "registerConfigs", args: [state.ids] });
  } else if (stage === "create") {
    to = atomicFactory;
    const init = { curator: account, creator: account, recipient: account, treasury: state.treasury, name: "696X", symbol: "696X",
      creatorFee: 40, protocolFee: 10, cashBps: 2500, firstDeposit: parseEther("0.02"), imageURI: image };
    data = encodeFunctionData({ abi: factoryAbi, functionName: "createAtomic", args: [slug, init, state.ids, state.weights] });
  } else {
    to = state.vault; value = seedWei;
    const net = seedWei * 9950n / 10000n;
    const budgets = state.weights.map((w) => net * BigInt(w) / 10000n);
    const outputs = await quoteSeed(state.vault, budgets, seedWei);
    const floors = outputs.map((o) => o * 9700n / 10000n);
    if (floors.some((f) => f === 0n)) throw new Error("Seed output too small for a holding");
    const nonce = await client.readContract({ address: state.vault, abi: vaultAbi, functionName: "planNonce" });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
    data = encodeFunctionData({ abi: vaultAbi, functionName: "bootstrap", args: [floors, nonce, deadline] });
    note = "Buys all 8 holdings with 3% per-holding floors; valid for 4 minutes.";
  }
  const tx = { account, to, data, value };
  const estimate = await client.estimateGas(tx);
  const gas = (estimate * 130n + 99n) / 100n;
  const price = forkGasPrice ?? await client.getGasPrice();
  const maxFeePerGas = price * 2n;
  if (gas * maxFeePerGas > gasCaps[i]) throw new Error("Current gas exceeds the reviewed step cap; wait and retry");
  state.prepared ??= {};
  state.prepared[stage] = { to, data, value: value.toString() };
  saveState(state);
  return {
    done: false, stage, label: labels[i], cap: formatEther(gas * maxFeePerGas), value: formatEther(value), note,
    tx: { from: account, to, data, value: toHex(value), chainId: "0x1237", gas: toHex(gas), maxFeePerGas: toHex(maxFeePerGas), maxPriorityFeePerGas: "0x0" },
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
  if (!prepared || !same(tx.from, account) || !same(tx.to, prepared.to) || tx.value !== BigInt(prepared.value) || tx.input.toLowerCase() !== prepared.data.toLowerCase()) {
    throw new Error("Transaction identity mismatch");
  }
  state.receipts[stage] = { hash, block: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice) };
  saveState(state);
  if (!(await verifyStage(stage, state))) throw new Error("Post-transaction state verification failed");
  const result = { confirmed: true, stage, hash, feeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) };
  const after = readState();
  if (stage === "create") result.vault = after.vault;
  if (stage === "seed") {
    result.vault = after.vault;
    result.shares = formatEther(await client.readContract({ address: after.vault, abi: vaultAbi, functionName: "balanceOf", args: [account] }));
  }
  return result;
}

const page = `<!doctype html><meta charset="utf-8"><title>HOODX · 696X proportional vault</title>
<style>body{background:#091412;color:#e5f5f1;font:18px system-ui;max-width:850px;margin:55px auto;padding:24px}button{background:#4bd0c1;border:0;border-radius:10px;padding:16px;margin:8px;font:inherit;cursor:pointer}button:disabled{opacity:.35}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#afcbc3}.step{border:1px solid #25423d;border-radius:14px;padding:12px;margin:12px 0}small{color:#afcbc3}</style>
<h1>HOODX · Launch 696X on the proportional vault</h1><p>Creates a new 696X vault that needs no price oracle: joins buy each holder's exact slice and exits sell it. The legacy 696X vault and its assets are not touched by this page.</p><p>Steps 1–3 are gas only. <b>Step 4 sends ${formatEther(seedWei)} ETH</b> from the curator wallet to seed the new vault (you receive its shares).</p><small>Robinhood Chain · 4663<br>Curator: ${account}<br>Atomic factory: ${atomicFactory}<br>Legacy vault (read only): ${legacyVault}</small><p><button id="connect">Connect Rabby</button></p>${stages.map((s, i) => `<div class="step"><button id="${s}" disabled>${i + 1}. ${labels[i]}</button></div>`).join("")}<pre id="status">Connect the curator wallet. Review every transaction in Rabby.</pre><script src="/wallet.js"></script>`;
const js = `let provider;const providers=[];const status=document.querySelector('#status');const stages=${JSON.stringify(stages)};const K='hoodx-696x-prop-';window.addEventListener('eip6963:announceProvider',e=>providers.push(e.detail));window.dispatchEvent(new Event('eip6963:requestProvider'));
const enable=i=>stages.forEach((s,n)=>document.querySelector('#'+s).disabled=n!==i);
document.querySelector('#connect').onclick=async()=>{try{provider=providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);if(!provider)throw Error('Rabby not detected. Open this page in Brave with Rabby enabled.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Select the approved curator wallet in Rabby.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});enable(0);status.textContent='Connected. Start with step 1. Each step is checked immediately before Rabby opens.';}catch(e){status.textContent=e.message;}};
for(const [i,stage]of stages.entries())document.querySelector('#'+stage).onclick=async()=>{const button=document.querySelector('#'+stage);button.disabled=true;let requested=false;try{if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)throw Error('Wrong network');const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Wrong wallet');status.textContent='Refreshing state, gas and balance for '+stage+'…';const response=await fetch('/prepare?stage='+stage);const prepared=await response.json();if(!response.ok)throw Error(prepared.error);if(prepared.done){status.textContent=prepared.label+' is already verified.';enable(i+1);return;}if(localStorage.getItem(K+stage)||localStorage.getItem(K+'pending-'+stage))throw Error('A previous '+stage+' request exists. Check its receipt before retrying.');status.textContent='Review '+prepared.label+' in Rabby. Sends '+prepared.value+' ETH. Maximum gas cost '+prepared.cap+' ETH. '+prepared.note;requested=true;localStorage.setItem(K+'pending-'+stage,'true');const hash=await provider.request({method:'eth_sendTransaction',params:[prepared.tx]});localStorage.setItem(K+stage,hash);localStorage.removeItem(K+'pending-'+stage);status.textContent='Submitted '+hash+' — verifying receipt…';for(let n=0;n<120;n++){const check=await(await fetch('/receipt?stage='+stage+'&hash='+hash)).json();if(check.confirmed){status.textContent=prepared.label+' confirmed. '+hash+'\\nGas paid: '+check.feeEth+' ETH'+(check.vault?'\\nVault: '+check.vault:'')+(check.shares?'\\nYour seed shares: '+check.shares:'');enable(i+1);return;}if(check.error)throw Error(check.error);await new Promise(r=>setTimeout(r,3000));}status.textContent='Still pending: '+hash+'. Do not submit again.';}catch(e){if(e.code===4001){requested=false;localStorage.removeItem(K+'pending-'+stage);}const recorded=localStorage.getItem(K+stage)||localStorage.getItem(K+'pending-'+stage);button.disabled=requested||!!recorded;status.textContent=e.message+(button.disabled?'\\nCheck the wallet request or receipt before retrying.':'\\nNo transaction was submitted. You can retry this check.');}};`;

const server = httpServer.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  if (req.headers.host !== `127.0.0.1:${PORT}` || req.method !== "GET") { res.writeHead(403); return res.end(); }
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
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
server.listen(PORT, "127.0.0.1", () => console.log(`Wallet handoff: http://127.0.0.1:${PORT}`));
