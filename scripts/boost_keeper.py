"""HOODX Boosted ETH keeper. Run every 15 minutes.

Every action is a permissionless, rule-bound crank; the keeper wallet chooses nothing and can move no funds:
  - HoodxBoostSignalV1.poke()   once per clock hour: reads Chainlink ETH/USD and BTC/USD and updates the signal.
  - HoodxBoostVaultV1.rebalance() whenever rebalanceStatus() says it is ready: the vault computes the target, the size
                                (at most one $100k slice per hour) and the oracle-bounded swap limits itself.
  - crystalliseFees()           once the 30-day fee period has passed.
Each transaction is simulated first and skipped if it would revert.

Signer (pick one):
  --keystore <file> --password-file <file>   unattended (the gas-only keeper wallet)
  --private-key-env <ENV_VAR>                 cloud / local fork tests
RPC: --rpc-env <ENV_VAR> (default ROBINHOOD_RPC_URL), else the first line of Desktop/RH RPC.txt. Never printed.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_LOCAL_CAST = Path.home() / ".foundry" / "bin" / ("cast.exe" if os.name == "nt" else "cast")
CAST = str(_LOCAL_CAST) if _LOCAL_CAST.exists() else (shutil.which("cast") or "cast")
LIVE = ROOT / "deployments" / "boost-eth-v1-live.json"
FEE_PERIOD = 30 * 86400
SMALL_VAULT_USD = 2_000   # below this NAV the signal is poked every 2 hours instead of every hour (research: docs/BOOST-ETH-ECONOMICS)
STATE_SIG = "state()((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {msg}", flush=True)


class Chain:
    def __init__(self, rpc: str, signer: list[str]):
        self.rpc = rpc
        self.signer = signer

    def _run(self, args: list[str]) -> subprocess.CompletedProcess:
        r = subprocess.run([CAST, *args, "--rpc-url", self.rpc], capture_output=True, text=True)
        r.stdout = r.stdout.replace(self.rpc, "<rpc>")
        r.stderr = r.stderr.replace(self.rpc, "<rpc>")
        return r

    def call(self, to: str, sig: str, *args) -> list[str]:
        r = self._run(["call", to, sig, *map(str, args)])
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip()[:300])
        return [line.split(" [")[0].strip() for line in r.stdout.strip().splitlines()]

    def would_succeed(self, to: str, sig: str, *args) -> bool:
        return self._run(["call", "--from", self.address(), to, sig, *map(str, args)]).returncode == 0

    def send(self, to: str, sig: str, *args) -> bool:
        if not self.would_succeed(to, sig, *args):
            log(f"skip {sig}: simulation reverts")
            return False
        r = self._run(["send", to, sig, *map(str, args), *self.signer])
        if r.returncode != 0:
            log(f"FAILED {sig}: {r.stderr.strip()[:300]}")
            return False
        status = next((ln.split()[-1] for ln in r.stdout.splitlines() if ln.strip().startswith("status")), "?")
        tx = next((ln.split()[-1] for ln in r.stdout.splitlines() if ln.strip().startswith("transactionHash")), "?")
        log(f"sent {sig} tx {tx} status {status}")
        return "success" in status or status == "1"

    def address(self) -> str:
        if not hasattr(self, "_addr"):
            ident = [x for j, x in enumerate(self.signer)
                     if x not in ("--legacy", "--gas-price") and (j == 0 or self.signer[j - 1] != "--gas-price")]
            r = subprocess.run([CAST, "wallet", "address", *ident], capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError("cannot read keeper address: " + r.stderr.strip()[:200])
            self._addr = r.stdout.strip()
        return self._addr

    def balance_eth(self, who: str) -> float:
        r = self._run(["balance", who, "--ether"])
        return float(r.stdout.strip() or 0)


def tuple_field(line: str, i: int) -> int:
    """cast prints a returned struct as one line "(a [1e18], b, ...)"; field i as an int."""
    return int(line.strip().strip("()").split(",")[i].strip().split(" ")[0])


def wad(x: str) -> float:
    return int(x) / 1e18


def run_once(chain: Chain, vault: str, signal: str, min_gas_eth: float) -> dict:
    now = int(time.time())
    keeper = chain.address()
    bal = chain.balance_eth(keeper)
    if bal < min_gas_eth:
        log(f"WARNING keeper gas low: {bal:.5f} ETH at {keeper}")
    summary: dict = {"sent": []}

    # Poke cadence by size: every 2 hours while the vault is small (gas outweighs the ~2 pt/yr cost of a slower signal),
    # every hour above SMALL_VAULT_USD. The contract accepts both; the vault trades on a signal at most 2 clock hours old.
    nav_usd = tuple_field(chain.call(vault, STATE_SIG)[0], 8) / 1e6
    every = 2 if nav_usd < SMALL_VAULT_USD else 1
    last_hour = int(chain.call(signal, "lastHour()(uint256)")[0])
    if now // 3600 - last_hour >= every:
        if chain.send(signal, "poke()"):
            summary["sent"].append("poke")
    summary["pokeEveryHours"] = every

    ready, emergency, lev, target, fresh = chain.call(vault, "rebalanceStatus()(bool,bool,uint256,uint256,bool)")
    log(f"leverage {wad(lev):.3f}x target {wad(target):.3f}x fresh={fresh} ready={ready} emergency={emergency}")
    summary.update(leverage=round(wad(lev), 3), target=round(wad(target), 3))
    if ready == "true":
        if chain.send(vault, "rebalance()"):
            summary["sent"].append("rebalance" + (" (emergency)" if emergency == "true" else ""))

    last_fee = int(chain.call(vault, "lastFeeTime()(uint64)")[0])
    if now >= last_fee + FEE_PERIOD:
        if chain.send(vault, "crystalliseFees()"):
            summary["sent"].append("crystalliseFees")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vault")
    ap.add_argument("--signal")
    ap.add_argument("--keystore")
    ap.add_argument("--password-file")
    ap.add_argument("--private-key-env", help="ENV var holding a key")
    ap.add_argument("--rpc-env", default="ROBINHOOD_RPC_URL")
    ap.add_argument("--min-gas-eth", type=float, default=0.002)
    ap.add_argument("--gas-price-wei", type=int, help="fixed legacy gas price (local forks without fee history)")
    a = ap.parse_args()

    rpc = os.environ.get(a.rpc_env, "")
    if not rpc:
        f = Path.home() / "Desktop" / "RH RPC.txt"
        rpc = f.read_text().strip().splitlines()[0] if f.exists() else ""
    if not rpc:
        log("no RPC configured")
        return 2
    if a.private_key_env:
        signer = ["--private-key", os.environ[a.private_key_env]]
    elif a.keystore and a.password_file:
        signer = ["--keystore", a.keystore, "--password-file", a.password_file]
    else:
        log("no signer: pass --keystore + --password-file")
        return 2
    if a.gas_price_wei:
        signer = [*signer, "--legacy", "--gas-price", str(a.gas_price_wei)]
    if not (a.vault and a.signal) and not LIVE.exists():
        log("Boosted ETH is not live yet; nothing to do")
        return 0
    cfg = json.loads(LIVE.read_text()) if LIVE.exists() else {}
    try:
        summary = run_once(Chain(rpc, signer), a.vault or cfg["vault"], a.signal or cfg["signal"], a.min_gas_eth)
    except Exception as exc:  # one bad run must never crash the schedule
        log(f"ERROR {str(exc)[:300]}")
        return 1
    log("done " + json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
