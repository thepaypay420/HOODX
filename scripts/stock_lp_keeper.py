"""HOODX Stock LP V2 keeper ("autopilot"). Run hourly.

Every action it sends is a permissionless, rule-bound crank on HoodxStockLpControllerV2: the contracts decide
whether a reband/compound is allowed and how much liquidity to use, so the keeper wallet chooses nothing and
can move no funds. The keeper wallet only pays gas. Each send is simulated first and skipped if it would revert.

Signer (pick one):
  --keystore <file> --password-file <file>   unattended (the gas-only keeper wallet)
  --private-key-env <ENV_VAR>                 local fork tests only
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
DAY = 24 * 3600
WEEK = 7 * DAY


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
        sender = self.address()
        r = self._run(["call", "--from", sender, to, sig, *map(str, args)])
        return r.returncode == 0

    def send(self, to: str, sig: str, *args) -> bool:
        if not self.would_succeed(to, sig, *args):
            log(f"skip {sig} {args}: simulation reverts")
            return False
        r = self._run(["send", to, sig, *map(str, args), *self.signer])
        if r.returncode != 0:
            log(f"FAILED {sig} {args}: {r.stderr.strip()[:300]}")
            return False
        status = next((ln.split()[-1] for ln in r.stdout.splitlines() if ln.strip().startswith("status")), "?")
        tx = next((ln.split()[-1] for ln in r.stdout.splitlines() if ln.strip().startswith("transactionHash")), "?")
        log(f"sent {sig} {args} tx {tx} status {status}")
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


def run_once(chain: Chain, controller: str, state_path: Path | None, min_gas_eth: float) -> dict:
    """With state_path=None (cloud, stateless): compound at the 00 UTC run, claim fees at the Monday 00 UTC run."""
    state = json.loads(state_path.read_text()) if state_path and state_path.exists() else {}
    now = int(time.time())
    utc = datetime.now(timezone.utc)
    daily_due = (lambda key: utc.hour == 0) if state_path is None else (lambda key: now - state.get(key, 0) >= DAY)
    weekly_due = (lambda key: utc.hour == 0 and utc.weekday() == 0) if state_path is None else (lambda key: now - state.get(key, 0) >= WEEK)
    keeper = chain.address()
    bal = chain.balance_eth(keeper)
    if bal < min_gas_eth:
        log(f"WARNING keeper gas low: {bal:.5f} ETH at {keeper}")
    sleeves = chain.call(controller, "sleeves()(address[])")[0].strip("[]").replace(" ", "").split(",")
    n = len(sleeves)
    statuses = []
    for i in range(n):
        in_range, agrees, since, seen, ready, tick = chain.call(
            controller, "status(uint256)(bool,bool,uint64,uint64,bool,int24)", i)
        statuses.append({"inRange": in_range == "true", "agrees": agrees == "true", "breachSince": int(since),
                         "ready": ready == "true", "tick": int(tick)})
    summary = {"sleeves": n, "outOfRange": [i for i, s in enumerate(statuses) if not s["inRange"]],
               "referenceDisagrees": [i for i, s in enumerate(statuses) if not s["agrees"]], "sent": []}
    log(f"status: out of range {summary['outOfRange']}, reference disagrees {summary['referenceDisagrees']}")

    # 1) Keep breach timers alive (only needed while something is out of range or a breach is open).
    if any(not s["inRange"] or s["breachSince"] for s in statuses):
        if chain.send(controller, "signalAll()"):
            summary["sent"].append("signalAll")
        for i in range(n):
            ready = chain.call(controller, "status(uint256)(bool,bool,uint64,uint64,bool,int24)", i)[4] == "true"
            statuses[i]["ready"] = ready
    # 2) Rebands the rules allow now.
    for i, s in enumerate(statuses):
        if s["ready"] and chain.send(controller, "executeReband(uint256)", i):
            summary["sent"].append(f"executeReband({i})")
    # 3) Daily harvest + compound per sleeve.
    for i in range(n):
        key = f"compound_{sleeves[i].lower()}"
        if daily_due(key):
            chain.send(controller, "harvest(uint256)", i)
            if chain.send(controller, "compound(uint256)", i):
                summary["sent"].append(f"compound({i})")
            state[key] = now
    # 4) Weekly: push the performance fee to the treasury (anyone may; failures never affect users).
    for i in range(n):
        key = f"claim_{sleeves[i].lower()}"
        if weekly_due(key):
            if chain.send(sleeves[i], "claimFees()"):
                summary["sent"].append(f"claimFees({i})")
            state[key] = now
    if state_path is not None:
        state["lastRun"] = now
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=1))
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--controller", help="controller address (default: deployments/stock-lp-vault-v2-live.json)")
    ap.add_argument("--keystore")
    ap.add_argument("--password-file")
    ap.add_argument("--private-key-env", help="ENV var holding a key (local fork tests only)")
    ap.add_argument("--rpc-env", default="ROBINHOOD_RPC_URL")
    ap.add_argument("--state", default=str(Path.home() / ".hoodx" / "stock_lp_keeper_state.json"))
    ap.add_argument("--stateless", action="store_true", help="cloud mode: schedule daily/weekly steps by the UTC clock")
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
    live = ROOT / "deployments" / "stock-lp-vault-v2-live.json"
    if not a.controller and not live.exists():
        log("Automated LP V2 is not live yet; nothing to do")
        return 0
    controller = a.controller or json.loads(live.read_text())["controller"]
    try:
        summary = run_once(Chain(rpc, signer), controller, None if a.stateless else Path(a.state), a.min_gas_eth)
    except Exception as exc:  # one bad run must never crash the schedule
        log(f"ERROR {str(exc)[:300]}")
        return 1
    log("done " + json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
