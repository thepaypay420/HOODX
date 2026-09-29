"""Verify HUNTX V3 behind the private RPC relay."""
import os, pathlib, subprocess, sys
from v2_relay import local_rpc
ROOT=pathlib.Path(__file__).resolve().parents[1]; RPC_FILE=pathlib.Path.home()/"Desktop"/"RH RPC.txt"
def main():
    if len(sys.argv)!=2: raise SystemExit("Usage: python scripts/verify_huntx_v3_deployment.py <deployment-tx-hash>")
    endpoint=os.environ.get("ROBINHOOD_RPC_URL") or RPC_FILE.read_text(encoding="utf-8").strip(); env=os.environ.copy(); env.pop("ROBINHOOD_RPC_URL",None)
    with local_rpc(endpoint) as relay:
        env["ROBINHOOD_RPC_URL"]=relay
        raise SystemExit(subprocess.run(["node","scripts/verify_huntx_v3_deployment.mjs",sys.argv[1]],cwd=ROOT,env=env,check=False).returncode)
if __name__=="__main__": main()
