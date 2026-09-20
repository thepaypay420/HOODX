"""Human-terminal signing runner. Never use a private-key argument or password environment."""
import argparse,os,subprocess
from pathlib import Path
from v2_relay import local_rpc
def main():
    p=argparse.ArgumentParser()
    p.add_argument("stage",choices=["canary-deploy","canary-smoke","canary-step","production","recover"])
    p.add_argument("--broadcast",action="store_true",help="Requires the independent live environment switch and hidden keystore prompt.")
    a=p.parse_args()
    if a.stage=="production" and os.environ.get("HOODX_CANARY_ONLY")=="1":
        raise SystemExit("Production is disabled for this canary-only session.")
    if os.environ.get("HOODX_696X_ONLY")=="1":
        if a.stage not in ("canary-deploy", "canary-step"):
            raise SystemExit("Only stepwise 696X canary execution is enabled.")
        if a.stage=="canary-step" and os.environ.get("HOODX_CANARY_BASKET")!="696x":
            raise SystemExit("FAANGX is disabled until 696X is recovered and verified.")
    if a.broadcast and os.environ.get("HOODX_LIVE_BROADCAST")!="1":
        raise SystemExit("HOODX_LIVE_BROADCAST=1 is required. Nothing was broadcast.")
    endpoint=os.environ.get("ROBINHOOD_RPC_URL")
    if not endpoint:raise SystemExit("ROBINHOOD_RPC_URL is missing")
    env=os.environ.copy();env.pop("ROBINHOOD_RPC_URL",None)
    if not a.broadcast:env.pop("HOODX_LIVE_BROADCAST",None)
    target={"canary-deploy":"DeployV2","canary-smoke":"CanaryV2","canary-step":"CanaryStepV2","production":"DeployV2","recover":"RecoverCanaryV2"}[a.stage]
    env["HOODX_DEPLOY_STAGE"]="production"if a.stage=="production"else"canary"
    if a.broadcast and a.stage!="recover"and not env.get("HOODX_REVIEWED_BUILD"):
        raise SystemExit("Reviewed build fingerprint is missing. Nothing was broadcast.")
    with local_rpc(endpoint)as url:
        args=[os.environ.get("HOODX_FORGE","forge"),"script",f"script/{target}.s.sol:{target}","--rpc-url",url,"--sender","0xf63E63a80A25611154C5d1c06E55FD763E0cfC19","--disable-external-identification"]
        if a.broadcast:
            args+=["--broadcast","--slow","--account","hoodx-deployer-v2"]
            if os.environ.get("HOODX_CANARY_ONLY")=="1":
                args += ["--with-gas-price","0.26gwei"]
            print("Signing with encrypted account hoodx-deployer-v2. Enter the password only at Foundry's hidden terminal prompt.",flush=True)
        else:args+=["--non-interactive"]
        return subprocess.run(args,env=env,cwd=Path(__file__).resolve().parents[1]).returncode
if __name__=="__main__":raise SystemExit(main())
