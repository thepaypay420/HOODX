"""Verify the deployed HUNTX FEEX base without exposing the private upstream RPC."""

import os
import pathlib
import subprocess
import sys

from v2_relay import local_rpc

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC_FILE = pathlib.Path.home() / "Desktop" / "RH RPC.txt"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/verify_huntx_v3_base.py <deployment-tx-hash>")
    endpoint = os.environ.get("ROBINHOOD_RPC_URL") or RPC_FILE.read_text(encoding="utf-8").strip()
    environment = os.environ.copy()
    environment.pop("ROBINHOOD_RPC_URL", None)
    environment["HOODX_FEE_MACHINE_PREFLIGHT_PATH"] = "deployments/huntx-v3-base-preflight.json"
    environment["HOODX_FEE_MACHINE_LIVE_PATH"] = "deployments/huntx-v3-base-live.json"
    with local_rpc(endpoint) as relay:
        environment["ROBINHOOD_RPC_URL"] = relay
        raise SystemExit(subprocess.run(
            ["node", "scripts/verify_fee_machine_deployment.mjs", sys.argv[1]],
            cwd=ROOT,
            env=environment,
            check=False,
        ).returncode)


if __name__ == "__main__":
    main()
