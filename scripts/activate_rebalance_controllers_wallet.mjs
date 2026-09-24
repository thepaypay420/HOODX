// Local, narrowly scoped wallet handoff. RPC stays server-side; signing stays in Rabby.
import httpServer from 'node:http';
import fs from 'node:fs';
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
  toHex,
} from 'viem';

const rpc = process.env.ROBINHOOD_RPC_URL;
delete process.env.ROBINHOOD_RPC_URL;
if (!rpc) throw Error('RPC configuration missing');

const client = createPublicClient({transport: http(rpc, {timeout: 20_000, retryCount: 1})});
const account = '0x134D468B0bcaeA6DF127916f951F7938c06A37C6';
const vaultAbi = parseAbi([
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function transferOwnership(address newOwner)',
]);
const controllerAbi = parseAbi([
  'function vault() view returns (address)',
  'function curator() view returns (address)',
  'function activate()',
]);
const deployments = [
  {
    symbol: '696X',
    vault: '0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292',
    controller: '0x5A732854bD6A4EEa6e5bA9ED9D897bC089f58767',
  },
  {
    symbol: 'FAANGX',
    vault: '0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0',
    controller: '0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb',
  },
];
const stages = deployments.flatMap((deployment) => [
  {
    ...deployment,
    action: 'nominate',
    target: deployment.vault,
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName: 'transferOwnership',
      args: [deployment.controller],
    }),
    label: `${deployment.symbol}: nominate controller`,
  },
  {
    ...deployment,
    action: 'activate',
    target: deployment.controller,
    data: encodeFunctionData({abi: controllerAbi, functionName: 'activate'}),
    label: `${deployment.symbol}: activate controller`,
  },
]);
const perCallBudget = 500_000_000_000_000n;

async function state(stage) {
  const [owner, pendingOwner, controllerVault, controllerCurator] = await Promise.all([
    client.readContract({address: stage.vault, abi: vaultAbi, functionName: 'owner'}),
    client.readContract({address: stage.vault, abi: vaultAbi, functionName: 'pendingOwner'}),
    client.readContract({address: stage.controller, abi: controllerAbi, functionName: 'vault'}),
    client.readContract({address: stage.controller, abi: controllerAbi, functionName: 'curator'}),
  ]);
  if (controllerVault.toLowerCase() !== stage.vault.toLowerCase()) throw Error('Controller vault mismatch');
  if (controllerCurator.toLowerCase() !== account.toLowerCase()) throw Error('Controller curator mismatch');
  return {owner, pendingOwner};
}

function complete(stage, current) {
  if (stage.action === 'nominate') {
    return current.owner.toLowerCase() === stage.controller.toLowerCase()
      || current.pendingOwner.toLowerCase() === stage.controller.toLowerCase();
  }
  return current.owner.toLowerCase() === stage.controller.toLowerCase()
    && current.pendingOwner === '0x0000000000000000000000000000000000000000';
}

function validateReady(stage, current) {
  if (complete(stage, current)) return;
  if (current.owner.toLowerCase() !== account.toLowerCase()) throw Error(`${stage.symbol} owner is not the curator wallet`);
  if (stage.action === 'nominate') {
    if (current.pendingOwner !== '0x0000000000000000000000000000000000000000') {
      throw Error(`${stage.symbol} already has a different pending owner`);
    }
  } else if (current.pendingOwner.toLowerCase() !== stage.controller.toLowerCase()) {
    throw Error(`${stage.symbol} controller has not been nominated`);
  }
}

const page = `<!doctype html><meta charset="utf-8"><title>HOODX · Activate atomic rebalancing</title>
<style>body{background:#091412;color:#e5f5f1;font:18px system-ui;max-width:820px;margin:55px auto;padding:24px}button{background:#4bd0c1;border:0;border-radius:10px;padding:15px;margin:8px 10px 8px 0;font:inherit;cursor:pointer}button:disabled{opacity:.42;cursor:not-allowed}.step{padding:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#afcbc3}small{color:#afcbc3}</style>
<h1>HOODX · Atomic rebalancing</h1>
<p>Activate the verified one-signature rebalance controllers for the existing 696X and FAANGX vaults.</p>
<p>Four zero-value ownership calls. These calls do not trade, withdraw, approve, or move vault assets. Maximum gas allowance: 0.000500 ETH per call.</p>
<small>Robinhood Chain · 4663<br>Curator: ${account}<br>696X controller: ${deployments[0].controller}<br>FAANGX controller: ${deployments[1].controller}</small>
<p><button id="connect">Connect Rabby</button></p>
${stages.map((stage, index) => `<div class="step"><button id="stage-${index}" disabled>${index + 1}. ${stage.label}</button></div>`).join('')}
<pre id="status">Connect the curator wallet. Review and sign one exact transaction at a time.</pre><script src="/wallet.js"></script>`;

const js = `let provider;const providers=[];const status=document.querySelector('#status');window.addEventListener('eip6963:announceProvider',e=>providers.push(e.detail));window.dispatchEvent(new Event('eip6963:requestProvider'));
const account='${account.toLowerCase()}';
async function unlockNext(){const r=await fetch('/progress');const p=await r.json();if(!r.ok)throw Error(p.error);for(let i=0;i<${stages.length};i++){const b=document.querySelector('#stage-'+i);b.disabled=i!==p.next;b.textContent=(i+1)+'. '+${JSON.stringify(stages.map((stage) => stage.label))}[i]+(p.completed[i]?' ✓':'');}if(p.next===-1)status.textContent='Both controllers are active and verified. No rebalance has been executed.';}
document.querySelector('#connect').onclick=async()=>{try{provider=providers.find(p=>/rabby/i.test(p.info.name))?.provider||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);if(!provider)throw Error('Rabby not detected. Open this page in Brave with Rabby enabled.');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!==account)throw Error('Select the approved curator wallet in Rabby.');if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});await unlockNext();if(!/active and verified/.test(status.textContent))status.textContent='Connected. Complete each ownership step in order and verify every Rabby request.';}catch(e){status.textContent=e.message;}};
for(let i=0;i<${stages.length};i++)document.querySelector('#stage-'+i).onclick=async()=>{const button=document.querySelector('#stage-'+i);button.disabled=true;let requested=false;try{if(BigInt(await provider.request({method:'eth_chainId'}))!==4663n)throw Error('Wrong network');const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==account)throw Error('Wrong wallet');if(localStorage.getItem('hoodx-controller-pending-'+i))throw Error('A previous wallet request exists. Check Rabby before retrying.');status.textContent='Refreshing ownership, gas and balance…';const r=await fetch('/prepare?i='+i);const p=await r.json();if(!r.ok)throw Error(p.error);if(p.done){status.textContent=p.label+' already complete.';await unlockNext();return;}requested=true;localStorage.setItem('hoodx-controller-pending-'+i,'true');status.textContent='Review '+p.label+' in Rabby. Target: '+p.tx.to+' · Value: 0 ETH · Maximum gas cost: '+p.cap+' ETH.';const hash=await provider.request({method:'eth_sendTransaction',params:[p.tx]});localStorage.setItem('hoodx-controller-hash-'+i,hash);localStorage.removeItem('hoodx-controller-pending-'+i);status.textContent='Submitted '+hash+' — verifying receipt…';for(let n=0;n<120;n++){const v=await(await fetch('/receipt?i='+i+'&hash='+hash)).json();if(v.confirmed){status.textContent=v.label+' confirmed. '+hash+'\\nFee: '+v.feeEth+' ETH';await unlockNext();return;}if(v.error)throw Error(v.error);await new Promise(resolve=>setTimeout(resolve,3000));}status.textContent='Still pending: '+hash+'. Do not submit again.';}catch(e){if(e.code===4001){requested=false;localStorage.removeItem('hoodx-controller-pending-'+i);}button.disabled=requested;status.textContent=e.message+(requested?'\\nCheck the wallet request or receipt before retrying.':'\\nNo transaction was submitted.');}};
`;

const server = httpServer.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Frame-Options', 'DENY');
  if (request.headers.host !== '127.0.0.1:8795' || request.method !== 'GET') {
    response.writeHead(403);
    return response.end();
  }
  try {
    const url = new URL(request.url, 'http://127.0.0.1:8795');
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      return response.end(page);
    }
    if (url.pathname === '/wallet.js') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(js);
    }
    response.setHeader('Content-Type', 'application/json');
    if (await client.getChainId() !== 4663) throw Error('Wrong RPC chain');
    if (url.pathname === '/progress') {
      const completed = [];
      let next = -1;
      for (let index = 0; index < stages.length; index++) {
        const current = await state(stages[index]);
        const done = complete(stages[index], current);
        completed.push(done);
        if (!done && next === -1) next = index;
      }
      return response.end(JSON.stringify({completed, next}));
    }
    const index = Number(url.searchParams.get('i'));
    if (!Number.isInteger(index) || index < 0 || index >= stages.length) throw Error('Invalid stage');
    const stage = stages[index];
    if (url.pathname === '/prepare') {
      const current = await state(stage);
      validateReady(stage, current);
      if (complete(stage, current)) return response.end(JSON.stringify({done: true, label: stage.label}));
      const gas = await client.estimateGas({account, to: stage.target, data: stage.data, value: 0n});
      const gasLimit = (gas * 125n + 99n) / 100n;
      const feeCap = perCallBudget / gasLimit;
      const gasPrice = await client.getGasPrice();
      if (gasPrice > feeCap) throw Error('Current fees exceed the displayed gas allowance. Retry later.');
      if (await client.getBalance({address: account}) < perCallBudget) throw Error('Curator wallet balance is below the displayed gas allowance.');
      return response.end(JSON.stringify({
        done: false,
        label: stage.label,
        cap: formatEther(gasLimit * feeCap),
        tx: {from: account, to: stage.target, data: stage.data, value: '0x0', chainId: '0x1237', gas: toHex(gasLimit), maxFeePerGas: toHex(feeCap), maxPriorityFeePerGas: '0x0'},
      }));
    }
    if (url.pathname === '/receipt') {
      const hash = url.searchParams.get('hash');
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Invalid transaction hash');
      let receipt;
      try { receipt = await client.getTransactionReceipt({hash}); } catch { return response.end(JSON.stringify({confirmed: false})); }
      const transaction = await client.getTransaction({hash});
      if (transaction.from.toLowerCase() !== account.toLowerCase()
        || transaction.to?.toLowerCase() !== stage.target.toLowerCase()
        || transaction.input.toLowerCase() !== stage.data.toLowerCase()
        || transaction.value !== 0n) throw Error('Transaction identity mismatch');
      if (receipt.status !== 'success') throw Error('Transaction reverted');
      const current = await state(stage);
      if (!complete(stage, current)) {
        if (stage.action !== 'nominate' || current.pendingOwner.toLowerCase() !== stage.controller.toLowerCase()) {
          throw Error('Post-transaction ownership verification failed');
        }
      }
      const result = {confirmed: true, label: stage.label, hash, block: String(receipt.blockNumber), feeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice)};
      fs.writeFileSync(`deployments/controller-${stage.symbol.toLowerCase()}-${stage.action}-receipt.json`, `${JSON.stringify(result, null, 2)}\n`);
      console.log(JSON.stringify(result));
      return response.end(JSON.stringify(result));
    }
    response.writeHead(404);
    response.end('{}');
  } catch (error) {
    response.writeHead(400);
    response.end(JSON.stringify({error: String(error.shortMessage || error.message).replace(/https?:\/\/\S+/g, '<redacted>')}));
  }
});

server.listen(8795, '127.0.0.1', () => console.log('Wallet handoff: http://127.0.0.1:8795'));
