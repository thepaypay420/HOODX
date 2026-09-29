"""Refresh the read-only $160 FEEX base preflight through a loopback RPC relay."""

import os
import pathlib
import subprocess

from v2_relay import local_rpc

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC_FILE = pathlib.Path.home() / "Desktop" / "RH RPC.txt"


def main() -> None:
    endpoint = os.environ.get("ROBINHOOD_RPC_URL") or RPC_FILE.read_text(encoding="utf-8").strip()
    environment = os.environ.copy()
    environment.pop("ROBINHOOD_RPC_URL", None)
    environment["HOODX_FEE_MACHINE_TARGET_USD"] = "160"
    environment["HOODX_FEE_MACHINE_PREFLIGHT_PATH"] = "deployments/huntx-v3-base-preflight.json"
    with local_rpc(endpoint) as relay:
        environment["ROBINHOOD_RPC_URL"] = relay
        for script in ("scripts/audit_fee_machine_candidates.mjs", "scripts/prepare_fee_machine_launch.mjs"):
            result = subprocess.run(["node", script], cwd=ROOT, env=environment, check=False)
            if result.returncode:
                raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
