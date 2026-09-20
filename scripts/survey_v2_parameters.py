"""Read deployment parameters and reference depth at one block; environment RPC only."""
import json, os, urllib.request
from pathlib import Path
from Crypto.Hash import keccak
R=Path(__file__).resolve().parents[1]
URL=os.environ["ROBINHOOD_RPC_URL"]
def rpc(method,params):
    try:
        q=urllib.request.Request(URL,data=json.dumps(dict(jsonrpc="2.0",id=1,method=method,params=params)).encode(),headers={"Content-Type":"application/json","User-Agent":"HOODX-parameters/2"})
        with urllib.request.urlopen(q,timeout=40) as f:d=json.load(f)
        if "error" in d:raise ValueError()
        return d["result"]
    except Exception:raise RuntimeError("RPC request failed") from None
block=rpc("eth_blockNumber",[])
def w(x):return (x[2:] if isinstance(x,str) else hex(x)[2:]).rjust(64,"0")
def call(a,s,args=()):
    sel=keccak.new(digest_bits=256,data=s.encode()).hexdigest()[:8]
    return rpc("eth_call",[{"to":a,"data":"0x"+sel+"".join(w(x) for x in args)},block])
def string(a,s):
    b=bytes.fromhex(call(a,s)[2:]);offset=int.from_bytes(b[:32]);n=int.from_bytes(b[offset:offset+32]);return b[offset+32:offset+32+n].decode()
dis=json.loads((R/"deployments/robinhood-4663-v2-discovery.json").read_text())
survey=json.loads((R/"deployments/robinhood-4663-v2-reference-survey.json").read_text())
settings={}
for label,v in dis["vaults"].items():
    a=v["address"];settings[label]={k:string(a,k+"()") for k in ("name","symbol","imageURI")}
    for k in ("creatorFeeBps","protocolFeeBps","minDeposit","minFirstDeposit","genesisEthPerShare"):
        try:settings[label][k]=str(int(call(a,k+"()"),16))
        except RuntimeError:settings[label][k]=None
refs=[]
for a in survey["assets"]:
    cs=[x for x in a["references"] if x["history1800"] and int(x["liquidity"])>0]
    direct=[x for x in cs if x["quote"].lower()==dis["contracts"]["weth"]["address"].lower()]
    c=max(direct or cs,key=lambda x:int(x["liquidity"]))
    p=c["pool"];current=int(call(p,"liquidity()"),16)
    raw=bytes.fromhex(call(p,"observe(uint32[])",(32,2,1800,0))[2:])
    offset=int.from_bytes(raw[32:64]);s0=int.from_bytes(raw[offset+32:offset+64]);s1=int.from_bytes(raw[offset+64:offset+96])
    harmonic=(1800<<128)//((s1-s0)%(1<<160))
    balance=int(call(c["quote"],"balanceOf(address)",(p,)),16)
    bridge=None
    if not direct:bridge="0x"+call(dis["vaults"][a["vault"]]["address"],"quoteBridgeV3(address)",(c["quote"],))[-40:]
    refs.append(dict(token=a["token"],vault=a["vault"],pool=p,quote=c["quote"],bridge=bridge,liquidity=str(current),harmonicLiquidity1800=str(harmonic),minimumCandidate=str(min(current,harmonic)//2),quoteBalance=str(balance),approved=False))
out=dict(chainId=4663,block=int(block,16),settings=settings,references=refs,releaseApproved=False)
(R/"deployments/robinhood-4663-v2-parameters.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps({"block":out["block"],"settings":settings,"references":len(refs)}))
