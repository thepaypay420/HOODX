"""HOODX Stock LP V2 keeper ("autopilot"). Runs every 15 minutes.

Every action it sends is a permissionless, rule-bound crank on HoodxStockLpControllerV2: the contracts decide
whether a reband/compound is allowed and how much liquidity to use, so the keeper wallet chooses nothing and
can move no funds. The keeper wallet only pays gas. Each send is simulated first and skipped if it would revert.

Keeper policy on top of the contract's 15-minute minimum (docs/AUTOLP-PROFITABILITY-2026-10-14.md, research/slp3
study2 "edge ±2% wait 2h brake"): re-place a sleeve only after 2 hours out of range, and after 24 hours when its last
two re-placements went the same way as this one (a stock trending through its band); compound and claim weekly.
The re-placement history is kept in the state file (cloud: restored between loops by the workflow's cache).

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
# The controller restarts a breach timer if a sleeve is not observed for 2 h (MAX_OBSERVATION_GAP). Observing an open
# breach every 90 minutes keeps it alive with margin; nothing else needs a signal, so the keeper no longer pays for an
# all-sleeve signalAll (about 720k gas) every 15 minutes while a sleeve waits at the band edge.
KEEPALIVE = 90 * 60
WAIT = 2 * 3600          # out of range this long before a re-placement
BRAKE_K = 2              # ... unless the last BRAKE_K re-placements went the same way as this one:
BRAKE_WAIT = DAY         # then wait this long
COMPOUND_EVERY = WEEK    # harvest + compound, and claim the performance fee


def next_band(tick: int, lower: int, upper: int, spacing: int, maker: int) -> tuple[int, int] | None:
    """The range executeReband would move an out-of-range sleeve to, or None when it would be a no-op (the sleeve
    already sits in the band beside the price). Mirrors the controller's floor-to-spacing rule (lib/stockLp.ts)."""
    def floor(t: int) -> int:
        c = int(t / spacing) * spacing
        return c - spacing if t < 0 and t % spacing != 0 else c
    if tick >= upper:
        hi = floor(tick)
        if hi > tick:
            hi -= spacing
        new = (hi - maker, hi)
    elif tick < lower:
        lo = floor(tick) + spacing
        new = (lo, lo + maker)
    else:
        return None
    return None if new == (lower, upper) else new


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


def brake_wait(dirs: list[bool], up: bool) -> int:
    """How long a sleeve must be out of range before it is re-placed (up = the price left through the top)."""
    return BRAKE_WAIT if len(dirs) >= BRAKE_K and all(d == up for d in dirs[-BRAKE_K:]) else WAIT


def run_once(chain: Chain, controller: str, state_path: Path | None, min_gas_eth: float,
             geometry: list[tuple[int, int]] | None = None) -> dict:
    """With state_path=None (stateless): compound and claim at the first run of Monday 00 UTC, and no trend brake."""
    state = json.loads(state_path.read_text()) if state_path and state_path.exists() else {}
    now = int(time.time())
    utc = datetime.now(timezone.utc)
    weekly_due = ((lambda key: utc.weekday() == 0 and utc.hour == 0 and utc.minute < 15) if state_path is None
                  else (lambda key: now - state.get(key, 0) >= COMPOUND_EVERY))
    bands = state.setdefault("bands", {})
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
                         "lastSeen": int(seen), "ready": ready == "true", "tick": int(tick)})
    summary = {"sleeves": n, "outOfRange": [i for i, s in enumerate(statuses) if not s["inRange"]],
               "referenceDisagrees": [i for i, s in enumerate(statuses) if not s["agrees"]], "sent": []}
    log(f"status: out of range {summary['outOfRange']}, reference disagrees {summary['referenceDisagrees']}")

    # 0) Each sleeve's range; a change since the last run is a re-placement (ours or anyone's): record its direction.
    for i, s in enumerate(statuses):
        lo = int(chain.call(sleeves[i], "tickLower()(int24)")[0])
        hi = int(chain.call(sleeves[i], "tickUpper()(int24)")[0])
        s["range"] = (lo, hi)
        h = bands.setdefault(sleeves[i].lower(), {"range": [lo, hi], "dirs": []})
        if tuple(h["range"]) != (lo, hi):
            h["dirs"] = (h["dirs"] + [lo > h["range"][0]])[-4:]
            h["range"] = [lo, hi]
        s["dirs"] = h["dirs"]

    # 1) Observe only the sleeves that need it (per-sleeve signal(i), about an eighth of signalAll's gas):
    #    out of range with no timer yet (starts the 15-minute clock), an open timer last seen >= 90 min ago (keeps it
    #    alive under the 2 h gap), or back in range with an old timer (clears it, so the next exit starts a fresh wait).
    #    A sleeve at the band edge (a re-placement would land on the same ticks) needs no timer: it is observed again
    #    once the price clears the pool's next tick step, and its wait starts then.
    for i, s in enumerate(statuses):
        if geometry is not None and not s["inRange"]:
            s["movable"] = next_band(s["tick"], *s["range"], *geometry[i]) is not None
        else:
            s["movable"] = True
        stale = s["lastSeen"] == 0 or now - s["lastSeen"] >= KEEPALIVE
        need = (not s["inRange"] and s["movable"] and (s["breachSince"] == 0 or stale)) or (s["inRange"] and s["breachSince"] != 0)
        if need and chain.send(controller, "signal(uint256)", i):
            summary["sent"].append(f"signal({i})")
            r = chain.call(controller, "status(uint256)(bool,bool,uint64,uint64,bool,int24)", i)
            s["breachSince"], s["ready"] = int(r[2]), r[4] == "true"
    # 2) Re-placements: the contract must allow it, and the sleeve must have been out for the keeper's wait.
    waiting = {}
    for i, s in enumerate(statuses):
        if not (s["ready"] and s["movable"]):
            continue
        wait = brake_wait(s["dirs"], s["tick"] >= s["range"][1])
        if now - s["breachSince"] < wait:
            waiting[i] = f"{(now - s['breachSince']) // 60}m of {wait // 60}m"
            continue
        if chain.send(controller, "executeReband(uint256)", i):
            summary["sent"].append(f"executeReband({i})")
    if waiting:
        summary["waiting"] = waiting
    # 3) Weekly harvest + compound per sleeve.
    for i in range(n):
        key = f"compound_{sleeves[i].lower()}"
        if weekly_due(key):
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
    ap.add_argument("--controller", help="controller address (default: the newest deployments/stock-lp-vault-v*-live.json)")
    ap.add_argument("--keystore")
    ap.add_argument("--password-file")
    ap.add_argument("--private-key-env", help="ENV var holding a key (local fork tests only)")
    ap.add_argument("--rpc-env", default="ROBINHOOD_RPC_URL")
    ap.add_argument("--state", default=str(Path.home() / ".hoodx" / "stock_lp_keeper_state.json"))
    ap.add_argument("--stateless", action="store_true", help="no state file: weekly steps by the UTC clock, no trend brake")
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
    # The newest live deployment (v3 replaced v2 on 2026-10-05; the retired vault needs no keeper to exit).
    lives = [ROOT / "deployments" / f"stock-lp-vault-{v}-live.json" for v in ("v3", "v2")]
    live = next((f for f in lives if f.exists()), lives[-1])
    if not a.controller and not live.exists():
        log("Automated LP is not live yet; nothing to do")
        return 0
    deployment = json.loads(live.read_text()) if live.exists() else {}
    controller = a.controller or deployment["controller"]
    # tick spacing and maker width per sleeve, in controller order (v3 live file); unknown -> treat every sleeve as movable
    geometry = None
    if controller.lower() == str(deployment.get("controller", "")).lower() and all("makerWidthTicks" in x for x in deployment.get("sleeves", [])):
        geometry = [(int(x["lp"]["tickSpacing"]), int(x["makerWidthTicks"])) for x in deployment["sleeves"]]
    try:
        summary = run_once(Chain(rpc, signer), controller, None if a.stateless else Path(a.state), a.min_gas_eth, geometry)
    except Exception as exc:  # one bad run must never crash the schedule
        log(f"ERROR {str(exc)[:300]}")
        return 1
    log("done " + json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
