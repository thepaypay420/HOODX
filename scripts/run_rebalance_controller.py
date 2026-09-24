"""Run a reviewed rebalance-controller deployment without exposing the upstream RPC URL."""

import argparse
import os
import subprocess
from pathlib import Path

from v2_relay import local_rpc


DEPLOYER = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--broadcast", action="store_true")
    args = parser.parse_args()

    endpoint = os.environ.get("ROBINHOOD_RPC_URL")
    if not endpoint:
        raise SystemExit("ROBINHOOD_RPC_URL is missing")

    env = os.environ.copy()
    env.pop("ROBINHOOD_RPC_URL", None)
    if args.broadcast:
        required = {
            "HOODX_LIVE_BROADCAST": "1",
            "HOODX_DEPLOY_STAGE": "atomic-rebalance-controller",
        }
        for name, expected in required.items():
            if env.get(name) != expected:
                raise SystemExit(f"{name} must equal {expected}. Nothing was broadcast.")
        if not env.get("HOODX_REVIEWED_BUILD"):
            raise SystemExit("HOODX_REVIEWED_BUILD is missing. Nothing was broadcast.")
        print(
            "Signing with encrypted account hoodx-deployer-v2. "
            "Enter the password only at Foundry's hidden terminal prompt.",
            flush=True,
        )

    project = Path(__file__).resolve().parents[1]
    forge = os.environ.get("HOODX_FORGE", "forge")
    with local_rpc(endpoint) as url:
        command = [
            forge,
            "script",
            "script/DeployRebalanceController.s.sol:DeployRebalanceController",
            "--rpc-url",
            url,
            "--sender",
            DEPLOYER,
            "--disable-external-identification",
        ]
        if args.broadcast:
            command += ["--broadcast", "--slow", "--account", "hoodx-deployer-v2"]
        else:
            command += ["--non-interactive"]
        return subprocess.run(command, cwd=project, env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
