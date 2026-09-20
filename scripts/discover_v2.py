"""Read-only V2 discovery. Never prints endpoint or remote error messages."""
import argparse, json, os, re, ssl, urllib.request
from pathlib import Path
from Crypto.Hash import keccak
ROOT = Path(__file__).resolve().parents[1]
def digest(b):
    return keccak.new(digest_bits=256, data=b).hexdigest()
def selector(s): return digest(s.encode())[:8]
def word(v): return (v[2:] if isinstance(v,str) else hex(v)[2:]).rjust(64,'0')
p=argparse.ArgumentParser(); p.add_argument('--public',action='store_true'); args=p.parse_args()
endpoint=os.environ.get('ROBINHOOD_RPC_URL')
if not endpoint and args.public: endpoint='https://rpc.mainnet.chain.robinhood.com'
if not endpoint: raise SystemExit('ROBINHOOD_RPC_URL is missing')
ctx=ssl.create_default_context()
def rpc(method,params):
    try:
        req=urllib.request.Request(endpoint,data=json.dumps(dict(jsonrpc='2.0',id=1,method=method,params=params)).encode(),headers={'Content-Type':'application/json','User-Agent':'HOODX-readonly-discovery/2.0'})
        with urllib.request.urlopen(req,context=ctx,timeout=35) as r: result=json.load(r)
        if 'error' in result: raise ValueError('RPC error')
        return result['result']
    except Exception: raise RuntimeError('RPC request failed: '+method) from None
chain=int(rpc('eth_chainId',[]),16)
if chain!=4663: raise SystemExit('Wrong chain')
block=rpc('eth_blockNumber',[])
def call(to,sig,params=()): return rpc('eth_call',[{'to':to,'data':'0x'+selector(sig)+''.join(word(x) for x in params)},block])
def num(to,sig,params=()): return int(call(to,sig,params),16)
def addr(to,sig,params=()): return '0x'+call(to,sig,params)[-40:]
def optional(fn):
    try: return fn()
    except Exception: return None
manifest=json.loads((ROOT/'deployed.json').read_text())
contracts={k:manifest[k] for k in ['weth','swapRouter','v4Manager','v4StateView','v4Posm']}
contracts.update(universalRouter='0x8876789976decbfcbbbe364623c63652db8c0904',permit2='0x000000000022D473030F116dDEE9F6B43aC78BA3',v4Quoter='0x8dc178efb8111bb0973dd9d722ebeff267c98f94',swapProxy='0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9')
report={'chainId':chain,'block':int(block,16),'rpcSource':'environment' if os.environ.get('ROBINHOOD_RPC_URL') else 'public','contracts':{},'vaults':{},'releaseApproved':False}
for name,address in contracts.items():
    code=bytes.fromhex(rpc('eth_getCode',[address,block])[2:])
    report['contracts'][name]={'address':address,'codeBytes':len(code),'runtimeKeccak256':'0x'+digest(code)}
quoteCandidates=set(re.findall(r'0x[0-9a-fA-F]{40}',(ROOT/'contracts/HoodxSwap.sol').read_text()))
for label,key in [('696X','vault696x'),('FAANGX','vaultFaangx')]:
    vault=manifest[key]; n=num(vault,'nTokens()'); rows=[]; quotes=set()
    for i in range(n):
        token=addr(vault,'tokenAt(uint256)',[i]); quote=addr(vault,'quoteOf(address)',[token]); quotes.add(quote)
        v4=bool(num(vault,'isV4(address)',[token])); pool=call(vault,'poolIdOf(address)',[token]) if v4 else addr(vault,'poolOf(address)',[token])
        keyraw=call(vault,'v4Key(address)',[token]) if v4 else None
        rows.append({'token':token,'balance':str(num(token,'balanceOf(address)',[vault])),'targetBps':num(vault,'targetBps(address)',[token]),'quote':quote,'v4':v4,'pool':pool,'poolKeyRaw':keyraw,'priceWeth':optional(lambda: str(num(vault,'priceWethWad(address)',[token])))})
    for q in quoteCandidates:
        if optional(lambda: num(vault,'allowedQuote(address)',[q])): quotes.add(q)
    quotes.update([manifest['weth'],'0x5fc5360d0400a0fd4f2af552add042d716f1d168']); quotes.discard('0x'+'0'*40)
    supply=num(vault,'totalSupply()'); dead=num(vault,'balanceOf(address)',['0x000000000000000000000000000000000000dead'])
    report['vaults'][label]={'address':vault,'nativeWei':str(int(rpc('eth_getBalance',[vault,block]),16)),'totalSupply':str(supply),'deadShares':str(dead),'liveShares':str(supply-dead),'totalAssets':optional(lambda:str(num(vault,'totalAssets()'))),'redeemableAssets':optional(lambda:str(num(vault,'redeemableAssets()'))),'roles':{r:optional(lambda r=r:addr(vault,r+'()')) for r in ['owner','creator','creatorRecipient','protocol','factory']},'constituents':rows,'quoteBalances':{q:optional(lambda q=q:str(num(q,'balanceOf(address)',[vault]))) for q in sorted(quotes)}}
    print(label+': '+str(n)+' constituents; live shares='+str(supply-dead))
(ROOT/'deployments').mkdir(exist_ok=True)
out=ROOT/'deployments'/'robinhood-4663-v2-discovery.json'; out.write_text(json.dumps(report,indent=2)+'\n')
print('Saved pinned read-only discovery at block '+str(report['block']))
for label,v in report['vaults'].items():
    nonzero=[r for r in v['constituents'] if int(r['balance'])]+[{'token':k,'balance':b} for k,b in v['quoteBalances'].items() if b and int(b)]
    print(label+': native='+v['nativeWei']+'; NAV='+str(v['totalAssets'])+'; nonzero holdings='+json.dumps(nonzero))
