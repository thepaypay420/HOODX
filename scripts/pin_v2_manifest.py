"""Pin candidate routes and reference thresholds. This does not approve release."""
import json,os,urllib.request
from pathlib import Path
from Crypto.Hash import keccak
from eth_abi import encode,decode
R=Path(__file__).resolve().parents[1];URL=os.environ["ROBINHOOD_RPC_URL"]
def h(b):return keccak.new(digest_bits=256,data=b).digest()
def rpc(method,params):
    try:
        q=urllib.request.Request(URL,data=json.dumps(dict(jsonrpc="2.0",id=1,method=method,params=params)).encode(),headers={"Content-Type":"application/json","User-Agent":"HOODX-manifest/2"})
        with urllib.request.urlopen(q,timeout=35)as f:d=json.load(f)
        if "error"in d:raise ValueError()
        return d["result"]
    except Exception:raise RuntimeError("RPC request failed")from None
block=rpc("eth_blockNumber",[])
def call(a,s,types=(),values=()):
    return bytes.fromhex(rpc("eth_call",[{"to":a,"data":"0x"+(h(s.encode())[:4]+encode(types,values)).hex()},block])[2:])
def num(a,s):return int.from_bytes(call(a,s))
dis=json.loads((R/"deployments/robinhood-4663-v2-discovery.json").read_text())
params=json.loads((R/"deployments/robinhood-4663-v2-parameters.json").read_text())
W=dis["contracts"]["weth"]["address"].lower();Z="0x"+"00"*20
bridge="0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"
bfee=num(bridge,"fee()");bliq=num(bridge,"liquidity()")
_,spl=decode(["int56[]","uint160[]"],call(bridge,"observe(uint32[])",["uint32[]"],[[1800,0]]))
bh=(1800<<128)//((spl[1]-spl[0])%(1<<160));bmin=min(bliq,bh)//2
empty=(Z,Z,0,0,Z)
def v3(i,o,f):return(3,i,o,f,empty,0,b"")
typ="(uint8,address,address,uint24,(address,address,uint24,int24,address),uint256,bytes)[]"
rows=[]
for label,v in dis["vaults"].items():
    for row in v["constituents"]:
        t=row["token"];q=row["quote"].lower();bridged=q not in (W,Z)
        if row["v4"]:
            key=decode(["address","address","uint24","int24","address"],bytes.fromhex(row["poolKeyRaw"][2:]))
            other=key[1] if key[0].lower()==t else key[0]
            buy=(4,other,t,0,key,0,b"");sell=(4,t,other,0,key,0,b"")
        else:
            fee=num(row["pool"],"fee()");buy=v3(q if bridged else W,t,fee);sell=v3(t,q if bridged else W,fee)
        bs=([v3(W,q,bfee)]if bridged else [])+[buy]
        ss=[sell]+([v3(q,W,bfee)]if bridged else [])
        buyBytes=encode([typ],[bs]);sellBytes=encode([typ],[ss])
        ref=next(x for x in params["references"]if x["token"]==t)
        rows.append(dict(vault=label,token=t,targetBps=row["targetBps"],buy="0x"+buyBytes.hex(),sell="0x"+sellBytes.hex(),routeHash="0x"+h(encode(["bytes","bytes"],[buyBytes,sellBytes])).hex(),referencePool=ref["pool"],referenceQuote=ref["quote"],minimumLiquidity=ref["minimumCandidate"],referenceBridge=ref["bridge"],minimumBridgeLiquidity=str(bmin)if ref["bridge"]else"0",status="fork-tested-candidate"))
out=dict(chainId=4663,parameterBlock=params["block"],routePinBlock=int(block,16),router=dis["contracts"]["universalRouter"],twapWindow=1800,depthPolicy="Fixed 50% of min(current, 30-minute harmonic liquidity) at the recorded snapshot; a retention floor, not a formal manipulation-cost bound.",settings=params["settings"],assets=rows,releaseApproved=False)
evidence="0x"+h(json.dumps(out,sort_keys=True,separators=(",",":")).encode()).hex();out["evidenceHash"]=evidence
(R/"deployments/robinhood-4663-routing-v2.json").write_text(json.dumps(out,indent=2)+"\n")
lines=["// SPDX-License-Identifier: MIT","pragma solidity ^0.8.24;","// Generated from the candidate routing manifest; release remains gated.","library PinnedV2Config {",f"    bytes32 internal constant EVIDENCE={evidence};"]
lines+=["    function asset(uint256 i) internal pure returns(address token,address referencePool,uint128 depth,uint128 bridgeDepth,uint16 weight,bytes32 routeHash) {"]
for i,a in enumerate(rows):
    lines.append(f'        if(i=={i})return(address(bytes20(hex"{a["token"][2:]}")),address(bytes20(hex"{a["referencePool"][2:]}")),{a["minimumLiquidity"]},{a["minimumBridgeLiquidity"]},{a["targetBps"]},{a["routeHash"]});')
lines+=['        revert("unknown asset");',"    }","}"]
(R/"script/PinnedV2Config.sol").write_text("\n".join(lines)+"\n")
print(json.dumps(dict(block=int(block,16),assets=len(rows),evidenceHash=evidence,bridgeMinimum=str(bmin))))
