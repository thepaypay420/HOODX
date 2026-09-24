"""Run the local controller-activation handoff behind the private RPC relay."""

import os
import subprocess
from pathlib import Path

from v2_relay import local_rpc


def main() -> int:
    endpoint = os.environ.get("ROBINHOOD_RPC_URL")
    if not endpoint:
        raise SystemExit("ROBINHOOD_RPC_URL is missing")
    env = os.environ.copy()
    env.pop("ROBINHOOD_RPC_URL", None)
    project = Path(__file__).resolve().parents[1]
    with local_rpc(endpoint) as url:
        env["ROBINHOOD_RPC_URL"] = url
        return subprocess.run(
            ["node", "scripts/activate_rebalance_controllers_wallet.mjs"],
            cwd=project,
            env=env,
        ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
