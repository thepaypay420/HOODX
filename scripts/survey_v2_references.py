"""Read-only canonical V3 reference survey; no secret or remote errors are persisted."""
import json, os, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from Crypto.Hash import keccak
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ["ROBINHOOD_RPC_URL"]
FACTORY="0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
WETH="0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG="0x5fc5360d0400a0fd4f2af552add042d716f1d168"
def word(v): return (v[2:] if isinstance(v,str) else hex(v)[2:]).rjust(64,"0")
def rpc(method,params):
    try:
        req=urllib.request.Request(URL,data=json.dumps(dict(jsonrpc="2.0",id=1,method=method,params=params)).encode(),headers={"Content-Type":"application/json","User-Agent":"HOODX-reference-survey/2"})
        with urllib.request.urlopen(req,timeout=40) as r: result=json.load(r)
        if "error" in result: raise ValueError()
        return result["result"]
    except Exception: raise RuntimeError("RPC request failed") from None
BLOCK=rpc("eth_blockNumber",[])
assert int(rpc("eth_chainId",[]),16)==4663
def call(to,sig,args=()):
    selector=keccak.new(digest_bits=256,data=sig.encode()).hexdigest()[:8]
    return rpc("eth_call",[{"to":to,"data":"0x"+selector+"".join(word(a) for a in args)},BLOCK])
def survey(item):
    label,row=item; token=row["token"]; refs=[]
    for quote in (WETH,USDG):
        for fee in (100,500,3000,10000):
            pool="0x"+call(FACTORY,"getPool(address,address,uint24)",(token,quote,fee))[-40:]
            if int(pool,16)==0: continue
            liq=int(call(pool,"liquidity()"),16)
            try:
                # ABI dynamic uint32[]: offset, length, elements.
                raw=call(pool,"observe(uint32[])",(32,2,1800,0))
                history=True
            except RuntimeError: history=False
            refs.append(dict(pool=pool,quote=quote,fee=fee,liquidity=str(liq),history1800=history))
    return dict(vault=label,token=token,executionV4=row["v4"],references=refs,
                hasCandidate=any(int(r["liquidity"])>0 and r["history1800"] for r in refs))
data=json.loads((ROOT/"deployments/robinhood-4663-v2-discovery.json").read_text())
items=[(label,row) for label,v in data["vaults"].items() for row in v["constituents"]]
with ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(survey,items))
out=dict(chainId=4663,block=int(BLOCK,16),window=1800,assets=rows,releaseApproved=False,
         limitation="Candidate availability only; not manipulation-resistance or economic-depth approval.")
(ROOT/"deployments/robinhood-4663-v2-reference-survey.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps(dict(block=out["block"],assets=len(rows),withCandidates=sum(r["hasCandidate"] for r in rows),missing=[r["token"] for r in rows if not r["hasCandidate"]])))
