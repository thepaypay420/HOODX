import fs from "node:fs";
import httpServer from "node:http";
import { createPublicClient, encodeFunctionData, formatEther, getAddress, http, parseAbi, toHex } from "viem";

const rpc = (process.env.ROBINHOOD_RPC_URL || fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8")).trim();
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
const livePath = "deployments/fee-machine-live.json";
const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const account = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const launcher = getAddress(live.launcher);
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const quoter = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";
const router = "0xCaf681a66D020601342297493863E78C959E5cb2";
const launchAbi = parseAbi([
  "function curator() view returns(address)", "function seedWeth() view returns(uint256)",
  "function initialShares() view returns(uint256)", "function index() view returns(address)",
  "function sleeves(uint256) view returns(address)", "function bootstrapped() view returns(bool)",
  "function bootstrapFromEth(uint256[4],uint256[4],uint256[4],uint256) payable",
]);
const sleeveAbi = parseAbi(["function token1() view returns(address)", "function fee() view returns(uint24)", "function positionLiquidity() view returns(uint128)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns(uint256)", "function totalSupply() view returns(uint256)", "function allowance(address,address) view returns(uint256)"]);
const quoterAbi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256 amountOut,uint160,uint32,uint256)"]);

const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
async function baseline() {
  const [chainId, curator, seed, shares, index, done, code] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: launcher, abi: launchAbi, functionName: "curator" }),
    client.readContract({ address: launcher, abi: launchAbi, functionName: "seedWeth" }),
    client.readContract({ address: launcher, abi: launchAbi, functionName: "initialShares" }),
    client.readContract({ address: launcher, abi: launchAbi, functionName: "index" }),
    client.readContract({ address: launcher, abi: launchAbi, functionName: "bootstrapped" }),
    client.getCode({ address: launcher }),
  ]);
  if (chainId !== 4663 || !same(curator, account) || seed !== BigInt(live.pilot.seedWei) || shares !== BigInt(live.pilot.initialShares) || !code) throw new Error("Verified deployment changed");
  return { seed, shares, index, done };
}
async function prepare() {
  const base = await baseline();
  if (base.done) return { done: true };
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
  const minTokenOut = [], minWethUsed = [], minTokenUsed = [];
  for (let i = 0; i < 4; i += 1) {
    const sleeve = await client.readContract({ address: launcher, abi: launchAbi, functionName: "sleeves", args: [BigInt(i)] });
    const [tokenOut, fee] = await Promise.all([
      client.readContract({ address: sleeve, abi: sleeveAbi, functionName: "token1" }),
      client.readContract({ address: sleeve, abi: sleeveAbi, functionName: "fee" }),
    ]);
    const side = base.seed * BigInt(i === 3 ? 500 : 1500) / 10_000n;
    const quoted = (await client.simulateContract({ address: quoter, abi: quoterAbi, account, functionName: "quoteExactInputSingle", args: [{ tokenIn: weth, tokenOut, amountIn: side, fee, sqrtPriceLimitX96: 0n }] })).result[0];
    minTokenOut.push(quoted * 97n / 100n);
    minWethUsed.push(side / 2n);
    minTokenUsed.push(quoted / 2n);
  }
  const data = encodeFunctionData({ abi: launchAbi, functionName: "bootstrapFromEth", args: [minTokenOut, minWethUsed, minTokenUsed, deadline] });
  const tx = { account, to: launcher, data, value: base.seed };
  await client.call(tx);
  const gas = (await client.estimateGas(tx)) * 125n / 100n;
  const maxFeePerGas = (await client.getGasPrice()) * 2n;
  const gasCap = gas * maxFeePerGas;
  if (await client.getBalance({ address: account }) < base.seed + gasCap) throw new Error(`Curator wallet needs ${formatEther(base.seed + gasCap)} ETH including the reviewed gas cap`);
  return { done: false, seedEth: formatEther(base.seed), gasCapEth: formatEther(gasCap), tx: { from: account, to: launcher, data, value: toHex(base.seed), chainId: "0x1237", gas: toHex(gas), maxFeePerGas: toHex(maxFeePerGas), maxPriorityFeePerGas: "0x0" } };
}
async function receipt(hash) {
  let r; try { r = await client.getTransactionReceipt({ hash }); } catch { return { confirmed: false }; }
  if (r.status !== "success") throw new Error("Bootstrap transaction reverted");
  const [base, tx] = await Promise.all([baseline(), client.getTransaction({ hash })]);
  if (!base.done || !same(tx.from, account) || !same(tx.to, launcher) || tx.value !== base.seed) throw new Error("Receipt identity or final state mismatch");
  const supply = await client.readContract({ address: base.index, abi: erc20Abi, functionName: "totalSupply" });
  const balance = await client.readContract({ address: base.index, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (supply !== base.shares || balance !== base.shares) throw new Error("FEEX supply mismatch");
  if (await client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [base.index] }) !== 0n) throw new Error("Unexpected idle WETH in index");
  if (await client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [launcher] }) !== 0n) throw new Error("Launcher WETH was not refunded");
  if (await client.readContract({ address: weth, abi: erc20Abi, functionName: "allowance", args: [launcher, router] }) !== 0n) throw new Error("Router allowance was not cleared");
  for (let i = 0; i < 4; i += 1) {
    const sleeve = await client.readContract({ address: launcher, abi: launchAbi, functionName: "sleeves", args: [BigInt(i)] });
    const token = await client.readContract({ address: sleeve, abi: sleeveAbi, functionName: "token1" });
    if (await client.readContract({ address: sleeve, abi: sleeveAbi, functionName: "positionLiquidity" }) === 0n) throw new Error(`Sleeve ${i} has no liquidity`);
    if (await client.readContract({ address: sleeve, abi: erc20Abi, functionName: "balanceOf", args: [base.index] }) === 0n) throw new Error(`Index has no sleeve ${i} shares`);
    const [tokenDust, wethAllowance, tokenAllowance] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [launcher] }),
      client.readContract({ address: weth, abi: erc20Abi, functionName: "allowance", args: [launcher, sleeve] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [launcher, sleeve] }),
    ]);
    if (tokenDust !== 0n || wethAllowance !== 0n || tokenAllowance !== 0n) throw new Error(`Sleeve ${i} dust or allowance was not cleared`);
  }
  live.status = "LIVE_CLOSED_PILOT"; live.bootstrap = { hash, blockNumber: r.blockNumber.toString(), gasUsed: r.gasUsed.toString(), feeWei: (r.gasUsed * r.effectiveGasPrice).toString(), verifiedAt: new Date().toISOString() };
  fs.writeFileSync(livePath, `${JSON.stringify(live, null, 2)}\n`);
  return { confirmed: true, hash, feeEth: formatEther(r.gasUsed * r.effectiveGasPrice), shares: formatEther(supply) };
}

const page = `<!doctype html><meta charset="utf-8"><title>HOODX · Launch Fee Machine</title><style>body{background:#07110f;color:#e9f7f4;font:18px system-ui;max-width:780px;margin:48px auto;padding:28px}main{border:1px solid #24443e;border-radius:24px;padding:30px;background:linear-gradient(145deg,#10211e,#091210)}h1{font-size:44px;margin:0 0 8px}small,pre{color:#9dbab4}button{width:100%;padding:18px;border:0;border-radius:14px;background:#53d8ca;font:700 19px system-ui;margin-top:16px}button:disabled{opacity:.38}pre{white-space:pre-wrap}</style><main><small>ROBINHOOD CHAIN · CLOSED PROTOCOL PILOT</small><h1>Launch Fee Machine.</h1><p>One atomic curator transaction funds four reviewed LP sleeves and mints 200 FEEX. Public deposits remain disabled.</p><p>No approval or second funding step. Any failed pool check, quote minimum, or mint reverts everything.</p><button id="connect">Connect Rabby</button><button id="launch" disabled>Fund four sleeves + mint FEEX</button><pre id="status">Connect the official curator wallet.</pre></main><script src="/wallet.js"></script>`;
const js = `let provider;const status=document.querySelector('#status'),launch=document.querySelector('#launch'),providers=[];window.addEventListener('eip6963:announceProvider',e=>{if(!providers.some(p=>p.info.uuid===e.detail.info.uuid))providers.push(e.detail)});window.dispatchEvent(new Event('eip6963:requestProvider'));const injected=()=>providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null)||providers[0]?.provider||window.ethereum;document.querySelector('#connect').onclick=async()=>{try{window.dispatchEvent(new Event('eip6963:requestProvider'));await new Promise(r=>setTimeout(r,300));provider=injected();if(!provider)throw Error('Rabby was not detected. Enable it for this local page and retry.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!=='${account.toLowerCase()}')throw Error('Select the official curator wallet.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});const p=await(await fetch('/prepare')).json();if(p.error)throw Error(p.error);if(p.done){status.textContent='Fee Machine is already live.';return}status.textContent='Verified simulation passed. Seed '+p.seedEth+' ETH; maximum gas '+p.gasCapEth+' ETH.';launch.disabled=false}catch(e){status.textContent=e.message||String(e)}};launch.onclick=async()=>{launch.disabled=true;try{const p=await(await fetch('/prepare')).json();if(p.error)throw Error(p.error);status.textContent='Review the one atomic launch transaction in Rabby.';const hash=await provider.request({method:'eth_sendTransaction',params:[p.tx]});status.textContent='Submitted '+hash+' — verifying exact receipt and four positions…';for(let i=0;i<120;i++){const v=await(await fetch('/receipt?hash='+hash)).json();if(v.error)throw Error(v.error);if(v.confirmed){status.textContent='Live closed pilot. '+v.shares+' FEEX minted. Gas paid '+v.feeEth+' ETH.';return}await new Promise(r=>setTimeout(r,3000))}throw Error('Still pending. Check the transaction before any retry.')}catch(e){status.textContent=(e.message||String(e))+' No unverified retry was sent.';launch.disabled=false}};`;
const server = httpServer.createServer(async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'"); if (req.headers.host !== "127.0.0.1:8797" || req.method !== "GET") { res.writeHead(403); return res.end(); } try { const url = new URL(req.url, "http://127.0.0.1:8797"); if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(page); } if (url.pathname === "/wallet.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); } res.setHeader("Content-Type", "application/json"); if (url.pathname === "/prepare") return res.end(JSON.stringify(await prepare())); if (url.pathname === "/receipt") { const hash = url.searchParams.get("hash"); if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) throw new Error("Invalid hash"); return res.end(JSON.stringify(await receipt(hash))); } res.writeHead(404); res.end("{}"); } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "<redacted>") : "Request failed" })); } });
server.listen(8797, "127.0.0.1", () => console.log("Fee Machine signer: http://127.0.0.1:8797"));
