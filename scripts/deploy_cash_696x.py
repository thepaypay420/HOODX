#!/usr/bin/env python3
"""Scale existing 696X bags to the cash target (default 25%) and buy drift."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

from live_funds import LIVE_696X, refuse_fn, refuse_lockout  # noqa: E402
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
import launch_v2  # noqa: E402
from rebalance_696x import (  # noqa: E402
    CURATOR,
    MIN_WETH_WEI,
    WETH,
    _cs,
    eth_usd,
    load_vault,
    print_plan,
    quote_floor,
    revert_label,
    send,
    swap_one,
)

ERC20 = [
    {
        "inputs": [{"name": "a", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "symbol",
        "outputs": [{"type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def scaled_targets(snap: dict) -> tuple[list[str], list[int]]:
    """Renormalize current targets on held names to fill risk-on sleeve (100% - cashTarget)."""
    held: list[tuple[str, int]] = []
    for bag in snap["bags"]:
        if bag["bal"] <= 0:
            continue
        bps = int(bag["targetBps"])
        if bps <= 0:
            continue
        held.append((bag["token"], bps))
    if len(held) < 2:
        raise SystemExit("need at least 2 held names with targets")
    used = sum(b for _, b in held)
    risk_cap = 10_000 - int(snap["cashBps"])
    scaled = [max(1, int(b * risk_cap / used)) for _, b in held]
    drift = risk_cap - sum(scaled)
    if drift:
        scaled[0] += drift
    who = [t for t, _ in held]
    return who, scaled


def main() -> int:
    execute = "--execute" in sys.argv
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    art = json.loads((ROOT / "out" / "hoodx.json").read_text())
    vault = w3.eth.contract(address=_cs(w3, LIVE_696X), abi=art["indexAbi"])
    if str(vault.functions.owner().call()).lower() != CURATOR.lower():
        raise SystemExit("vault owner is not the curator EOA")

    px = eth_usd()
    snap = load_vault(w3, vault)
    who, bps = scaled_targets(snap)
    who = [_cs(w3, t) for t in who]
    cash_pct = snap["buf"] / snap["nav"] * 100 if snap["nav"] else 0
    print(f"cash now {cash_pct:.2f}%  target {(snap['cashBps'] / 100):.2f}%")
    print_plan(snap, who, bps, px, {"sleeves": []})
    if not execute:
        print("dry-run. pass --execute to setTargets and buy drift.")
        return 0

    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("wallet is not the curator EOA")
    refuse_lockout(LIVE_696X, "setTargets")
    try:
        send(w3, acct, vault.functions.warmOracles(), "warmOracles", gas=2_000_000)
    except Exception as exc:
        print(f"warmOracles skipped: {revert_label(exc)}")
    send(w3, acct, vault.functions.setTargets(who, bps), "setTargets")

    snap = load_vault(w3, vault)
    want = {t.lower(): b for t, b in zip(who, bps)}
    nav = snap["nav"]
    buys = []
    for bag in snap["bags"]:
        b = want.get(bag["token"].lower(), 0)
        if b <= 0 or bag["px"] <= 0:
            continue
        want_val = nav * b // 10_000
        need = want_val - bag["val"]
        if need <= MIN_WETH_WEI:
            continue
        buys.append((need, bag))
    buys.sort(reverse=True)
    for need, bag in buys:
        buf = int(vault.functions.wethBuffer().call())
        assets = int(vault.functions.totalAssets().call())
        floor = assets * snap["cashBps"] // 10_000
        room = buf - floor
        if room <= MIN_WETH_WEI:
            print("cash floor reached — stop buys")
            break
        amt = min(need, room)
        swap_one(w3, acct, vault, WETH, bag["token"], amt, f"buy-{bag['symbol']}")
        time.sleep(0.2)

    snap = load_vault(w3, vault)
    print_plan(snap, who, bps, px, {"sleeves": []})
    cash_pct = snap["buf"] / snap["nav"] * 100 if snap["nav"] else 0
    print(f"done — cash {cash_pct:.2f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
