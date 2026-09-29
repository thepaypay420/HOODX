import http from "node:http";
import fs from "node:fs";
import {
  createPublicClient, encodeFunctionData, formatEther, getAddress, http as rpcHttp, parseAbi,
} from "viem";

throw new Error("Launch Hunter V1 bootstrap is retired. V1 remains empty while the higher-utilization V2 is audited.");

const launcher = getAddress(process.argv[2] || "");
const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
const client = createPublicClient({ transport: rpcHttp(rpc, { timeout: 20_000, retryCount: 1 }) });
const curator = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const launcherAbi = parseAbi(["function vault() view returns(address)"]);
const vaultAbi = parseAbi([
  "function bootstrap(address)", "function bootstrapped() view returns(bool)", "function seedAmount() view returns(uint256)",
  "function initialShares() view returns(uint256)", "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)", "function weth() view returns(address)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
const vault = getAddress(await client.readContract({ address: launcher, abi: launcherAbi, functionName: "vault" }));

async function prepare() {
  const [done, seed, shares, weth, balance] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "bootstrapped" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "seedAmount" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "initialShares" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "weth" }),
    client.getBalance({ address: curator }),
  ]);
  if (done) return { done: true };
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "bootstrap", args: [curator] });
  const gas = await client.estimateGas({ account: curator, to: vault, data, value: seed });
  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas || fees.gasPrice;
  const gasLimit = gas * 125n / 100n;
  const required = seed + gasLimit * maxFeePerGas;
  if (balance < required) throw new Error(`Official curator needs ${formatEther(required - balance)} more ETH.`);
  await client.call({ account: curator, to: vault, data, value: seed });
  return {
    done: false, seedEth: formatEther(seed), shares: shares.toString(), gasCapEth: formatEther(gasLimit * maxFeePerGas),
    tx: { from: curator, to: vault, data, value: `0x${seed.toString(16)}`, gas: `0x${gasLimit.toString(16)}`, maxFeePerGas: `0x${maxFeePerGas.toString(16)}` },
  };
}

async function receipt(hash) {
  const r = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!r) return { confirmed: false };
  if (r.status !== "success") throw new Error("Bootstrap reverted. Do not retry until reviewed.");
  const [done, seed, shares, supply, held, weth] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "bootstrapped" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "seedAmount" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "initialShares" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [curator] }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "weth" }),
  ]);
  const wethBalance = await client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
  if (!done || supply !== shares || held !== shares || wethBalance !== seed) {
    throw new Error("Receipt succeeded but exact HUNTX state verification failed.");
  }
  return { confirmed: true, hash, vault, shares: formatEther(shares), seedEth: formatEther(seed) };
}

const page = `<!doctype html><meta charset="utf-8"><title>HOODX · Launch Hunter</title><style>body{background:#050b0a;color:#edf9f6;font:18px system-ui;max-width:760px;margin:45px auto;padding:24px}main{border:1px solid #244740;border-radius:26px;padding:32px;background:radial-gradient(circle at 80% 10%,#12342d,#08110f 55%)}small{color:#59e0ca;letter-spacing:.14em}h1{font-size:44px;margin:10px 0}p,pre{color:#a9c1bc;line-height:1.55}button{width:100%;padding:18px;margin-top:14px;border:0;border-radius:15px;background:#55dccb;color:#04100e;font:700 19px system-ui}button:disabled{opacity:.35}</style><main><small>ROBINHOOD CHAIN · CLOSED CANARY</small><h1>Launch Hunter.</h1><p>One transaction converts exactly 0.073973 ETH into WETH and mints 200 HUNTX to the official curator. It buys no launch token. Public deposits do not exist.</p><button id="connect">Connect Rabby</button><button id="launch" disabled>Fund canary + mint HUNTX</button><pre id="status">Connect the official curator wallet.</pre></main><script src="/wallet.js"></script>`;
const js = `let provider;const s=document.querySelector('#status'),b=document.querySelector('#launch'),ps=[];window.addEventListener('eip6963:announceProvider',e=>{if(!ps.some(p=>p.info.uuid===e.detail.info.uuid))ps.push(e.detail)});window.dispatchEvent(new Event('eip6963:requestProvider'));const pick=()=>ps.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null)||ps[0]?.provider||window.ethereum;document.querySelector('#connect').onclick=async()=>{try{window.dispatchEvent(new Event('eip6963:requestProvider'));await new Promise(r=>setTimeout(r,300));provider=pick();if(!provider)throw Error('Rabby was not detected. Enable it for this local page and retry.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!=='${curator.toLowerCase()}')throw Error('Select the official curator wallet.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});const p=await(await fetch('/prepare')).json();if(p.error)throw Error(p.error);if(p.done){s.textContent='Launch Hunter is already funded.';return}s.textContent='Simulation passed. Seed '+p.seedEth+' ETH; maximum gas '+p.gasCapEth+' ETH.';b.disabled=false}catch(e){s.textContent=e.message||String(e)}};b.onclick=async()=>{b.disabled=true;try{const p=await(await fetch('/prepare')).json();if(p.error)throw Error(p.error);s.textContent='Review the one exact bootstrap transaction in Rabby.';const h=await provider.request({method:'eth_sendTransaction',params:[p.tx]});s.textContent='Submitted '+h+' — verifying exact WETH and HUNTX balances…';for(let i=0;i<120;i++){const v=await(await fetch('/receipt?hash='+h)).json();if(v.error)throw Error(v.error);if(v.confirmed){s.textContent='Closed canary live: '+v.shares+' HUNTX backed by '+v.seedEth+' WETH.';return}await new Promise(r=>setTimeout(r,3000))}throw Error('Still pending. Check the transaction before retrying.')}catch(e){s.textContent=(e.message||String(e))+' No automatic retry was sent.';b.disabled=false}};`;
const server = http.createServer(async (req, res) => { try { if (req.url === "/") { res.setHeader("content-type","text/html"); return res.end(page); } if (req.url === "/wallet.js") { res.setHeader("content-type","text/javascript"); return res.end(js); } if (req.url === "/prepare") { res.setHeader("content-type","application/json"); return res.end(JSON.stringify(await prepare())); } if (req.url?.startsWith("/receipt?")) { const hash=new URL(req.url,"http://x").searchParams.get("hash"); res.setHeader("content-type","application/json"); return res.end(JSON.stringify(await receipt(hash))); } res.statusCode=404; res.end(); } catch(e) { res.setHeader("content-type","application/json"); res.end(JSON.stringify({error:e.message||String(e)})); } });
server.listen(8798, "127.0.0.1", () => console.log("Launch Hunter signer: http://127.0.0.1:8798"));
