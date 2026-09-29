"""Run the HUNTX V3 curator signer behind the private RPC relay."""
import os,pathlib,subprocess
from v2_relay import local_rpc
ROOT=pathlib.Path(__file__).resolve().parents[1]; RPC_FILE=pathlib.Path.home()/"Desktop"/"RH RPC.txt"
def main():
    endpoint=os.environ.get("ROBINHOOD_RPC_URL") or RPC_FILE.read_text(encoding="utf-8").strip();env=os.environ.copy();env.pop("ROBINHOOD_RPC_URL",None)
    with local_rpc(endpoint) as relay:
        env["ROBINHOOD_RPC_URL"]=relay
        raise SystemExit(subprocess.run(["node","scripts/huntx_v3_bootstrap_wallet.mjs"],cwd=ROOT,env=env,check=False).returncode)
if __name__=="__main__":main()
