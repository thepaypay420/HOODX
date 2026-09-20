"""Unsigned deployment simulation. Signing and broadcast flags are never accepted."""
import os,subprocess
from pathlib import Path
from v2_relay import local_rpc
def main():
    endpoint=os.environ.get("ROBINHOOD_RPC_URL")
    if not endpoint:raise SystemExit("ROBINHOOD_RPC_URL is missing")
    env=os.environ.copy();env.pop("ROBINHOOD_RPC_URL",None);env.pop("HOODX_LIVE_BROADCAST",None)
    with local_rpc(endpoint)as url:
        return subprocess.run([os.environ.get("HOODX_FORGE","forge"),"script","script/DeployV2.s.sol:DeployV2","--rpc-url",url,"--sender","0xf63E63a80A25611154C5d1c06E55FD763E0cfC19","--non-interactive"],env=env,cwd=Path(__file__).resolve().parents[1]).returncode
if __name__=="__main__":raise SystemExit(main())
