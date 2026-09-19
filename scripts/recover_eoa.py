#!/usr/bin/env python3
"""Recover 696X curator funds to the EOA.

Sells every name that simulates, clips MEME/QUOTIENT, hunts hooked-pool
clips, then withdraws shares. User asked to get ETH back to the EOA.
Never prints keys or the RPC URL.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
import launch_v2  # noqa: E402

VAULT = "0x6350f9e8e630785ABF09fD1127366998Ad821E33"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
HOOKED = {
    "0xa74a94c15b95f8d5f3abdd2db00f6c7384037b55",  # Aria
    "0x20f24b8d2bcad7cd252fc60ee5f2db27c2f2f261",  # PROMETHEUS
}

INDEX_ABI = [
    {
        "inputs": [],
        "name": "constituents",
        "outputs": [{"type": "address[]"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint256"},
        ],
        "name": "quoteOut",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "twapOut", "type": "uint256"}],
        "name": "minOutFloor",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "pure",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "amountOutMin", "type": "uint256"},
        ],
        "name": "swapV3",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "shares", "type": "uint256"}, {"name": "minEthOut", "type": "uint256"}],
        "name": "withdraw",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "", "type": "address"}],
        "name": "isV4",
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "", "type": "address"}],
        "name": "v4Key",
        "outputs": [
            {"type": "address"},
            {"type": "address"},
            {"type": "uint24"},
            {"type": "int24"},
            {"type": "address"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "swapLogic",
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "totalAssets",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]
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


def cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


def send(w3, acct, tx, label: str):
    tx.setdefault("from", acct.address)
    tx.setdefault("chainId", 4663)
    if "gas" not in tx:
        tx["gas"] = min(int(w3.eth.estimate_gas(tx) * 13 // 10) + 50_000, 4_000_000)
    h = send_eoa_tx(w3, acct, tx)
    print(f"{label} {tx_hash_hex(h)}")
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    if int(rcpt.status) != 1:
        raise SystemExit(f"{label} reverted")
    return rcpt


def sim_sell(vault, owner, token, weth, amt) -> tuple[bool, int]:
    if amt <= 0:
        return False, 0
    q = int(vault.functions.quoteOut(token, weth, amt).call())
    floor = int(vault.functions.minOutFloor(q).call())
    if floor <= 0:
        return False, floor
    try:
        vault.functions.swapV3(token, weth, amt, floor).call({"from": owner})
        return True, floor
    except Exception:
        return False, floor


def clip_sell(w3, acct, vault, token, weth, bal) -> int:
    """Binary-search largest simulatable clip and send it. Returns amount sold."""
    lo, hi, best, best_floor = 1, bal, 0, 0
    while lo <= hi:
        mid = (lo + hi) // 2
        ok, floor = sim_sell(vault, acct.address, token, weth, mid)
        if ok:
            best, best_floor = mid, floor
            lo = mid + 1
        else:
            hi = mid - 1
    if best <= 0:
        return 0
    if best < 10**15:
        print(f"  skip dust clip {best} on {token[:10]}")
        return 0
    tx = vault.functions.swapV3(token, weth, best, best_floor).build_transaction(
        {"from": acct.address, "gas": 1_200_000}
    )
    send(w3, acct, tx, f"sell-clip-{token[:8]}")
    return best


def full_or_clip(w3, acct, vault, token, weth, bal, sym: str) -> None:
    ok, floor = sim_sell(vault, acct.address, token, weth, bal)
    if ok:
        tx = vault.functions.swapV3(token, weth, bal, floor).build_transaction(
            {"from": acct.address, "gas": 1_200_000}
        )
        send(w3, acct, tx, f"sell-all-{sym}")
        return
    sold = 0
    left = bal
    for i in range(40):
        n = clip_sell(w3, acct, vault, token, weth, left)
        if n <= 0:
            break
        sold += n
        left = int(
            w3.eth.contract(address=token, abi=ERC20).functions.balanceOf(vault.address).call()
        )
        print(f"  {sym} sold {n / 1e18:.6f} left {left / 1e18:.6f}")
        if left == 0:
            break
    print(f"{sym} clip-loop sold wei={sold} left={left}")


def hooked(vault, token: str) -> bool:
    if token.lower() in HOOKED:
        return True
    try:
        if not vault.functions.isV4(token).call():
            return False
        hooks = vault.functions.v4Key(token).call()[4]
        return int(hooks, 16) != 0
    except Exception:
        return token.lower() in HOOKED


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--withdraw", action="store_true", help="burn curator shares after sells")
    args = ap.parse_args()

    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("not curator EOA")
    vault = w3.eth.contract(address=cs(w3, VAULT), abi=INDEX_ABI)
    weth = cs(w3, WETH)
    tokens = [cs(w3, t) for t in vault.functions.constituents().call()]
    print(f"eoa eth={w3.eth.get_balance(acct.address) / 1e18:.6f} names={len(tokens)}")

    rows = []
    for token in tokens:
        bal = int(w3.eth.contract(address=token, abi=ERC20).functions.balanceOf(vault.address).call())
        if bal == 0:
            continue
        try:
            sym = w3.eth.contract(address=token, abi=ERC20).functions.symbol().call()
        except Exception:
            sym = token[:8]
        ok_all, _ = sim_sell(vault, acct.address, token, weth, bal)
        rows.append((sym, token, bal, hooked(vault, token), ok_all))
        print(f"{sym:12} bal={bal / 1e18:.4f} hooked={rows[-1][3]} sellAll={ok_all}")

    if not args.execute:
        print("dry-run — pass --execute to send sells")
        return

    for sym, token, bal, is_hook, ok_all in rows:
        if is_hook:
            print(f"skip hooked {sym} until unhooked names are cash")
            continue
        full_or_clip(w3, acct, vault, token, weth, bal, sym)

    # Second pass: hooked names — sell any clip that simulates.
    for sym, token, _, is_hook, _ in rows:
        if not is_hook:
            continue
        left = int(w3.eth.contract(address=token, abi=ERC20).functions.balanceOf(vault.address).call())
        print(f"hooked {sym} left {left / 1e18:.6f}")
        full_or_clip(w3, acct, vault, token, weth, left, sym)

    weth_left = int(w3.eth.contract(address=weth, abi=ERC20).functions.balanceOf(vault.address).call())
    shares = int(vault.functions.balanceOf(acct.address).call())
    print(f"vault WETH {weth_left / 1e18:.6f} shares {shares / 1e18:.6f}")

    if args.withdraw and shares > 0:
        tx = vault.functions.withdraw(shares, 0).build_transaction({"from": acct.address, "gas": 8_000_000})
        try:
            w3.eth.call({"from": acct.address, "to": vault.address, "data": tx["data"]})
            send(w3, acct, tx, "withdraw-all")
        except Exception as exc:  # noqa: BLE001
            print(f"withdraw-all sim fail: {exc}")
            # drip: largest shares that simulate
            lo, hi, best = 1, shares, 0
            while lo <= hi:
                mid = (lo + hi) // 2
                try:
                    vault.functions.withdraw(mid, 0).call({"from": acct.address})
                    best = mid
                    lo = mid + 1
                except Exception:
                    hi = mid - 1
            print(f"max simulatable withdraw shares={best}")
            if best > 0:
                tx = vault.functions.withdraw(best, 0).build_transaction(
                    {"from": acct.address, "gas": 8_000_000}
                )
                send(w3, acct, tx, "withdraw-max")

    print(f"eoa eth after {w3.eth.get_balance(acct.address) / 1e18:.6f}")


if __name__ == "__main__":
    main()
