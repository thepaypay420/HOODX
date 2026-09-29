"""Run bounded HUNTX/FEEX fork rehearsals without exposing the upstream RPC."""
import os,pathlib,subprocess,sys
from v2_relay import local_rpc
ROOT=pathlib.Path(__file__).resolve().parents[1];RPC_FILE=pathlib.Path.home()/"Desktop"/"RH RPC.txt"
def main():
    endpoint=os.environ.get("ROBINHOOD_RPC_URL") or RPC_FILE.read_text(encoding="utf-8").strip();env=os.environ.copy();env.pop("ROBINHOOD_RPC_URL",None)
    env["HOODX_FORK_TEST"]="true";env["HOODX_FORK_BLOCK"]="75942583"
    with local_rpc(endpoint) as relay:
        env["ROBINHOOD_RPC_URL"]=relay
        forge=ROOT.parent/"work"/"foundry"/"forge.exe"
        command=[str(forge),"test","--match-path","test/liquidity/FeeMachineLaunchFork.t.sol"]
        if len(sys.argv)>1: command += ["--match-test",sys.argv[1]]
        command += ["-vv"]
        raise SystemExit(subprocess.run(command,cwd=ROOT,env=env,check=False).returncode)
if __name__=="__main__":main()
