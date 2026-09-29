"""Run the HUNTX FEEX-base signer behind the private read-only RPC relay."""

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
    environment["HOODX_FEE_MACHINE_LIVE_PATH"] = "deployments/huntx-v3-base-live.json"
    with local_rpc(endpoint) as relay:
        environment["ROBINHOOD_RPC_URL"] = relay
        raise SystemExit(subprocess.run(
            ["node", "scripts/fee_machine_bootstrap_wallet.mjs"], cwd=ROOT, env=environment, check=False
        ).returncode)


if __name__ == "__main__":
    main()
