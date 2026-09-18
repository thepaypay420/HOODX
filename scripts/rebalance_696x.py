#!/usr/bin/env python3
"""Write 696 list targets on live 696X and swap drift (sell tail, buy PONS/AI/CASHCAT).

Explicit curator rebalance. Does not pause, unwind, or remove names.
Later joins copy the live mix, so bags must match the book.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

from live_funds import LIVE_696X, refuse_fn, refuse_lockout  # noqa: E402
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
from weights import allocate, list_target_bps  # noqa: E402
import launch_v2  # noqa: E402

WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
DEX_WETH = "https://api.dexscreener.com/tokens/v1/robinhood/" + WETH
BAND = 0.02
MIN_WETH_WEI = 2 * 10**14  # skip dust legs (~0.0002 ETH)
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


def _cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


def eth_usd() -> float:
    req = urllib.request.Request(DEX_WETH, headers={"User-Agent": "hoodx-rebalance/1", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        rows = json.loads(resp.read().decode())
    px = float((rows[0] or {}).get("priceUsd") or 0) if rows else 0.0
    if px <= 0:
        raise SystemExit("no ETH/USD tape")
    return px


def wait(w3, txh, label: str, *, fatal: bool = True):
    print(f"{label} {tx_hash_hex(txh)}")
    rcpt = w3.eth.wait_for_transaction_receipt(txh, timeout=180)
    if int(rcpt.status) != 1:
        msg = f"{label} reverted"
        if fatal:
            raise SystemExit(msg)
        print(msg)
        return None
    return rcpt


def send(w3, acct, fn, label: str, gas: int | None = None, *, fatal: bool = True):
    refuse_fn(fn)
    tx = fn.build_transaction({"from": acct.address, "chainId": 4663})
    if gas:
        tx["gas"] = gas
    else:
        last = None
        for attempt in range(4):
            try:
                tx["gas"] = int(w3.eth.estimate_gas(tx) * 13 // 10) + 80_000
                last = None
                break
            except Exception as exc:
                last = exc
                time.sleep(0.6 * (attempt + 1))
        if last is not None:
            raise last
    return wait(w3, send_eoa_tx(w3, acct, tx), label, fatal=fatal)


def px_weth(vault, token: str) -> int:
    try:
        px = int(vault.functions.priceWethWad(token).call())
        if px > 0:
            return px
    except Exception:
        pass
    try:
        return int(vault.functions.lastPxWad(token).call())
    except Exception:
        return 0


def load_vault(w3, vault):
    listed = [str(a) for a in vault.functions.constituents().call()]
    nav = int(vault.functions.totalAssets().call())
    buf = int(vault.functions.wethBuffer().call())
    min_sleeve = int(vault.functions.minSleeveWeth().call())
    cash_bps = int(vault.functions.cashTargetBps().call())
    weth = w3.eth.contract(address=_cs(w3, WETH), abi=ERC20)
    bags = []
    for token in listed:
        erc = w3.eth.contract(address=_cs(w3, token), abi=ERC20)
        bal = int(erc.functions.balanceOf(vault.address).call())
        try:
            sym = erc.functions.symbol().call()
        except Exception:
            sym = token[:10]
        px = px_weth(vault, token)
        val = (bal * px) // 10**18 if px > 0 else 0
        tgt = int(vault.functions.targetBps(token).call())
        bags.append({"token": token, "symbol": sym, "bal": bal, "px": px, "val": val, "targetBps": tgt})
        time.sleep(0.05)
    return {
        "listed": listed,
        "nav": nav,
        "buf": buf,
        "minSleeve": min_sleeve,
        "cashBps": cash_bps,
        "wethBal": int(weth.functions.balanceOf(vault.address).call()),
        "bags": bags,
    }


def quote_floor(vault, token_in: str, token_out: str, amount_in: int) -> int:
    twap = int(vault.functions.quoteOut(token_in, token_out, amount_in).call())
    if twap <= 0:
        return 0
    return int(vault.functions.minOutFloor(twap).call())


def print_plan(snap, who, bps, px: float, plan) -> list[dict]:
    nav = snap["nav"]
    want = {t.lower(): b for t, b in zip(who, bps)}
    print(
        f"NAV {nav / 1e18:.6f} ETH (${nav / 1e18 * px:.0f})  "
        f"cash {snap['buf'] / 1e18:.6f}  minSleeve {snap['minSleeve'] / 1e18:.4f}  "
        f"ethUsd {px:.2f}"
    )
    used = sum(bps)
    print(f"696 list targets  {len(who)} names  risk-on {used / 100:.1f}%  cash {(10000 - used) / 100:.1f}%")
    by_id = {(s.get("token") or "").lower(): s["id"] for s in plan["sleeves"]}
    rows = []
    print(f"{'id':<14} {'now%':>7} {'want%':>7} {'delta ETH':>12}  action")
    for bag in snap["bags"]:
        now_w = bag["val"] / nav if nav else 0
        b = want.get(bag["token"].lower(), 0)
        want_w = b / 10_000
        want_val = nav * b // 10_000
        delta = want_val - bag["val"]
        name = by_id.get(bag["token"].lower(), bag["symbol"])
        if b == 0 and bag["bal"] > 0:
            action = "SELL→cash"
        elif delta > MIN_WETH_WEI and now_w < want_w * (1 - BAND):
            action = "BUY"
        elif bag["bal"] > 0 and (b == 0 or now_w > want_w * (1 + BAND)):
            action = "SELL"
        else:
            action = "hold"
        print(f"{name:<14} {now_w * 100:7.2f} {want_w * 100:7.2f} {delta / 1e18:12.6f}  {action}")
        rows.append({**bag, "name": name, "wantBps": b, "wantVal": want_val, "delta": delta, "action": action})
    cash_now = snap["buf"] / nav if nav else 0
    cash_want = 1 - used / 10_000
    print(f"{'WETH':<14} {cash_now * 100:7.2f} {cash_want * 100:7.2f}")
    return rows


def revert_label(exc: BaseException) -> str:
    data = getattr(exc, "data", None)
    if isinstance(data, dict):
        data = data.get("data") or data.get("message") or data
    raw = str(data or exc)
    return raw[:120]


def swap_one(w3, acct, vault, token_in: str, token_out: str, amount_in: int, label: str) -> bool:
    amt = int(amount_in)
    for clip in (amt, amt // 2, amt // 4):
        if clip <= 0:
            continue
        for attempt in range(6):
            floor = quote_floor(vault, token_in, token_out, clip)
            if floor <= 0:
                print(f"skip {label} clip={clip / 1e18:.6f} — no TWAP")
                break
            fn = vault.functions.swapV3(token_in, token_out, clip, floor)
            try:
                rcpt = send(w3, acct, fn, f"{label}:{clip / 1e18:.5f}", fatal=False)
                if rcpt is not None:
                    return True
            except Exception as exc:
                hint = revert_label(exc)
                print(f"retry {label} clip={clip / 1e18:.6f} #{attempt + 1}: {hint}")
                if "0x7dd37f70" not in hint and "Slippage" not in hint and "execution reverted" not in hint:
                    break
                time.sleep(0.45)
    return False


def main() -> int:
    execute = "--execute" in sys.argv
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    art = json.loads((ROOT / "out" / "hoodx.json").read_text())
    vault = w3.eth.contract(address=_cs(w3, LIVE_696X), abi=art["indexAbi"])
    owner = vault.functions.owner().call()
    if str(owner).lower() != CURATOR.lower():
        raise SystemExit("vault owner is not the curator EOA")
    px = eth_usd()
    plan = allocate()
    snap = load_vault(w3, vault)
    nav_usd = snap["nav"] / 1e18 * px
    who, bps = list_target_bps(
        snap["listed"], nav_usd, snap["nav"], snap["minSleeve"], snap["cashBps"], plan
    )
    if len(who) < 2:
        raise SystemExit("need 2 names above the sleeve floor")
    who = [_cs(w3, t) for t in who]
    rows = print_plan(snap, who, bps, px, plan)
    if not execute:
        print("dry-run. pass --execute to setTargets and swap drift.")
        return 0

    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("wallet is not the curator EOA")
    refuse_lockout(LIVE_696X, "setTargets")
    try:
        send(w3, acct, vault.functions.warmOracles(), "warmOracles", gas=2_000_000)
    except Exception as exc:
        print(f"warmOracles skipped: {revert_label(exc)}")
    tgt = vault.functions.setTargets(who, bps)
    send(w3, acct, tgt, "setTargets")

    # Sell overweight / parked names first so buys keep the 25% cash floor.
    weth = _cs(w3, WETH)
    for bag in sorted(rows, key=lambda r: r["delta"]):
        if bag["action"] not in {"SELL", "SELL→cash"}:
            continue
        quote = vault.functions.quoteOf(bag["token"]).call()
        if vault.functions.isV4(bag["token"]).call() and str(quote).lower() not in {
            "0x0000000000000000000000000000000000000000",
            WETH.lower(),
        }:
            print(f"skip {bag['name']} — quoted V4 sell cannot clear 97% TWAP after the hop")
            continue
        if bag["px"] <= 0 or bag["bal"] <= 0:
            continue
        if bag["action"] == "SELL→cash":
            amt = bag["bal"]
        else:
            excess = bag["val"] - bag["wantVal"]
            if excess <= MIN_WETH_WEI:
                continue
            amt = bag["bal"] * excess // bag["val"]
        if amt <= 0:
            continue
        swap_one(w3, acct, vault, bag["token"], weth, amt, f"sell-{bag['name']}")
        time.sleep(0.2)

    snap = load_vault(w3, vault)
    want = {t.lower(): b for t, b in zip(who, bps)}
    nav = snap["nav"]
    cash_need = nav * snap["cashBps"] // 10_000
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
        swap_one(w3, acct, vault, weth, bag["token"], amt, f"buy-{bag['symbol']}")
        time.sleep(0.2)

    snap = load_vault(w3, vault)
    print_plan(snap, who, bps, px, plan)
    print("rebalance done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
