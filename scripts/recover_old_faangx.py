#!/usr/bin/env python3
"""Diagnose / recover the pre-fix FAANGX vault (0x1e2f…).

The broken clone bakes swapLogic 0x2505… — AMZN/NFLX sells always revert (Slippage).
strandToken only works for hooked V4 pools; AMZN/NFLX have hooks=0.

This script tries owner swapV3 clip sells, then reports what is still stranded.
Never prints keys or RPC URL.
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

from recover_eoa import INDEX_ABI as FULL_ABI, full_or_clip, sim_sell  # noqa: E402
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
import launch_v2  # noqa: E402

OLD_VAULT = "0x1e2Fc61A6794C452f712730228abb4f87838f392"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"

INDEX_ABI = [
    {
        "inputs": [],
        "name": "constituents",
        "outputs": [{"type": "address[]"}],
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
    {
        "inputs": [{"name": "a", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"type": "uint256"}],
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
        "inputs": [
            {"name": "shares", "type": "uint256"},
            {"name": "minEthOut", "type": "uint256"},
        ],
        "name": "withdraw",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "nonpayable",
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args()

    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("not curator EOA")

    vault = w3.eth.contract(address=cs(w3, OLD_VAULT), abi=FULL_ABI)
    weth = cs(w3, WETH)
    swap_logic = vault.functions.swapLogic().call()
    nav = vault.functions.totalAssets().call()
    shares = vault.functions.balanceOf(acct.address).call()
    print(f"old vault={OLD_VAULT}")
    print(f"swapLogic={swap_logic} (broken if 0x2505…)")
    print(f"nav={nav / 1e18:.6f} ETH curator_shares={shares / 1e18:.6f}")
    print(f"eoa eth={w3.eth.get_balance(acct.address) / 1e18:.6f}")

    stuck = []
    for token in vault.functions.constituents().call():
        bal = int(w3.eth.contract(address=token, abi=ERC20).functions.balanceOf(OLD_VAULT).call())
        if bal == 0:
            continue
        sym = w3.eth.contract(address=token, abi=ERC20).functions.symbol().call()
        ok, _ = sim_sell(vault, acct.address, token, weth, bal)
        print(f"  {sym:8} bal={bal / 1e18:.6f} sellAll={ok}")
        if not ok:
            stuck.append((sym, token, bal))

    if stuck:
        print("\nSTRANDED on broken bytecode — owner swapV3 cannot sell these names.")
        print("Emergency tools that do NOT apply here:")
        print("  strandToken — only hooked V4 (AMZN/NFLX hooks=0)")
        print("  extract_via_lp — WETH extraction only")
        print("  claimDust — needs prior strand + live shares")
        print("Fix: use the new factory vault; old AMZN/NFLX need a future on-chain rescue or are a loss.")

    if not args.execute:
        print("\ndry-run — pass --execute to attempt sells anyway")
        return

    for sym, token, bal in stuck:
        full_or_clip(w3, acct, vault, token, weth, bal, sym)

    weth_left = int(w3.eth.contract(address=weth, abi=ERC20).functions.balanceOf(OLD_VAULT).call())
    print(f"vault WETH after attempts: {weth_left / 1e18:.6f}")
    if shares > 0 and weth_left > 0:
        tx = vault.functions.withdraw(shares, 0).build_transaction({"from": acct.address, "gas": 8_000_000})
        h = send_eoa_tx(w3, acct, tx)
        print(f"withdraw {tx_hash_hex(h)}")
        w3.eth.wait_for_transaction_receipt(h, timeout=180)
    print(f"eoa eth after {w3.eth.get_balance(acct.address) / 1e18:.6f}")


if __name__ == "__main__":
    main()
