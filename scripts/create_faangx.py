#!/usr/bin/env python3
"""Mint $FAANGX on the live factory, smoke-test enter/exit, seed 0.08 ETH.

Official Robinhood Chain stocks (Investors Center + on-chain name check):
META, AMZN, AAPL, NFLX, GOOGL. 0% curator fee. Equal USD targets (15% each + 25% cash).

Pool notes (Mar 2026):
- AMZN/NFLX thin WETH V3 stubs fail oracle warm — use V4/USDG pools.
- USDG-only V3 binds cannot be bought (guard checks WETH depth on pool) — avoid at create.
- After deposit, curator may need small swapV3 clips (esp. GOOGL WETH cap ~0.004 ETH/leg).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
from vault_math import min_shares_floor  # noqa: E402
import launch_v2  # noqa: E402

FACTORY = "0x56809a2738A23650aF939F73588E72C67CafC19b"
IMAGE = "https://www.xhoodindex.com/curators/faangx.png"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
TEST_WEI = 2 * 10**16
FINAL_WEI = 8 * 10**16
CREATOR_FEE_BPS = 0
MIN_LEG = 2 * 10**14
GOOGL_MAX_LEG = 4 * 10**15

# (symbol, token, pool, v4)
PACK: list[tuple[str, str, str, bool]] = [
    ("META", "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", "0xa4BdB396a69617eb7F70E2cc1EF526f7340b1B0d", False),
    ("AMZN", "0x12f190a9F9d7D37a250758b26824B97CE941bF54", "0xefc94885c96b02696b9b45de43eeeb8ac53c0199cab42b4daae4911b96fb8825", True),
    ("AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", "0x8bb3514e2204e1cdf3ac149efee7ff04d91b719f", False),
    ("NFLX", "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", "0xe4930a6215f21aa3b37c01adbded3362f56ae31b9a60066f5f9641e601d5111f", True),
    ("GOOGL", "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", "0x8c2b4303fa0b99d07a5d3e9411497a277e65b673", False),
]


def _cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


def pool_ref(pool: str, v4: bool) -> bytes:
    h = pool.lower().replace("0x", "")
    if v4:
        if len(h) != 64:
            raise SystemExit(f"bad v4 pool {pool}")
        return bytes.fromhex(h)
    if len(h) == 40:
        h = h.rjust(64, "0")
    if len(h) != 64:
        raise SystemExit(f"bad v3 pool {pool}")
    return bytes.fromhex(h)


def wait(w3, txh, label: str):
    print(f"{label} {tx_hash_hex(txh)}")
    rcpt = w3.eth.wait_for_transaction_receipt(txh, timeout=180)
    if int(rcpt.status) != 1:
        raise SystemExit(f"{label} reverted status={rcpt.status}")
    return rcpt


def send(w3, acct, tx, label: str):
    tx.setdefault("from", acct.address)
    tx.setdefault("chainId", 4663)
    if "gas" not in tx:
        tx["gas"] = int(w3.eth.estimate_gas(tx) * 13 // 10) + 80_000
    return wait(w3, send_eoa_tx(w3, acct, tx), label)


def deposit(w3, acct, vault, wei: int, label: str) -> int:
    preview = vault.functions.previewDeposit(wei).call()
    shares = int(preview[0])
    floor = min_shares_floor(shares, 300)
    send(
        w3,
        acct,
        vault.functions.deposit(floor).build_transaction(
            {"from": acct.address, "value": wei, "gas": 10_000_000}
        ),
        label,
    )
    held = int(vault.functions.balanceOf(acct.address).call())
    if held <= 0:
        raise SystemExit(f"{label} minted no shares")
    return held


def withdraw_all(w3, acct, vault, shares: int, label: str) -> None:
    can = bool(vault.functions.canWithdraw(shares).call())
    min_out, _ = vault.functions.previewSell(shares).call()
    print(f"{label} canWithdraw={can} previewSell={int(min_out) / 1e18:.6f}")
    if not can or int(min_out) <= 0:
        raise SystemExit(f"{label} exit closed")
    send(
        w3,
        acct,
        vault.functions.withdraw(shares, 0).build_transaction({"from": acct.address, "gas": 8_000_000}),
        label,
    )
    if int(vault.functions.balanceOf(acct.address).call()) != 0:
        raise SystemExit(f"{label} shares remaining")


def _quote_floor(vault, token_in: str, token_out: str, amount_in: int) -> int:
    twap = int(vault.functions.quoteOut(token_in, token_out, amount_in).call())
    return int(vault.functions.minOutFloor(twap).call()) if twap else 0


def _swap_clip(w3, acct, vault, token_in: str, token_out: str, amount_in: int, label: str) -> bool:
    floor = _quote_floor(vault, token_in, token_out, amount_in)
    if floor <= 0:
        return False
    try:
        send(
            w3,
            acct,
            vault.functions.swapV3(token_in, token_out, amount_in, floor).build_transaction(
                {"from": acct.address, "gas": 5_000_000}
            ),
            label,
        )
        return True
    except Exception:
        return False


def rebalance_equal(w3, acct, vault) -> None:
    """Buy underweight names from WETH buffer while respecting the 25% cash floor."""
    meta = [
        {"inputs": [], "name": "symbol", "outputs": [{"type": "string"}], "stateMutability": "view", "type": "function"},
        {"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    ]
    weth = _cs(w3, WETH)
    for _ in range(12):
        nav = int(vault.functions.totalAssets().call())
        cash_bps = int(vault.functions.cashBps().call())
        cash_need = nav * cash_bps // 10_000
        n = int(vault.functions.nTokens().call())
        each_bps = int(vault.functions.targetBps(vault.functions.tokenAt(0).call()).call())
        bought = False
        for i in range(n):
            t = vault.functions.tokenAt(i).call()
            sym = w3.eth.contract(address=t, abi=meta).functions.symbol().call()
            bal = int(w3.eth.contract(address=t, abi=meta).functions.balanceOf(vault.address).call())
            px = int(vault.functions.priceWethWad(t).call())
            val = bal * px // 10**18 if px else 0
            want = nav * each_bps // 10_000
            need = want - val
            room = int(vault.functions.wethBuffer().call()) - cash_need
            spend = min(need, room)
            if sym == "GOOGL" and spend > GOOGL_MAX_LEG:
                spend = GOOGL_MAX_LEG
            if spend < MIN_LEG:
                continue
            for clip in (spend, spend // 2, GOOGL_MAX_LEG if sym == "GOOGL" else spend // 4):
                if clip < MIN_LEG:
                    continue
                if _swap_clip(w3, acct, vault, weth, t, clip, f"rebal-{sym}"):
                    bought = True
                    time.sleep(0.35)
                    break
        if not bought:
            break


def print_bags(w3, vault) -> None:
    meta = [
        {"inputs": [], "name": "symbol", "outputs": [{"type": "string"}], "stateMutability": "view", "type": "function"},
        {"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    ]
    erc = [{"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"}]
    nav = int(vault.functions.totalAssets().call())
    weth_bal = int(w3.eth.contract(address=_cs(w3, WETH), abi=erc).functions.balanceOf(vault.address).call())
    print(f"nav={nav / 1e18:.6f} cash%={weth_bal / nav * 100:.1f}")
    n = int(vault.functions.nTokens().call())
    for i in range(n):
        t = vault.functions.tokenAt(i).call()
        sym = w3.eth.contract(address=t, abi=meta).functions.symbol().call()
        bal = int(w3.eth.contract(address=t, abi=meta).functions.balanceOf(vault.address).call())
        px = int(vault.functions.priceWethWad(t).call())
        val = bal * px // 10**18 if px else 0
        print(f"  {sym} {val / nav * 100:.1f}%")


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    bal = w3.eth.get_balance(acct.address)
    print(f"eoa {acct.address} eth={bal / 1e18:.6f}")
    if bal < FINAL_WEI + 2 * 10**16:
        raise SystemExit("need seed + gas headroom")

    art = json.loads((ROOT / "out" / "hoodx.json").read_text())
    fac = w3.eth.contract(address=_cs(w3, FACTORY), abi=art["factoryAbi"])
    vault_addr = fac.functions.bySlug("faangx").call()
    index_abi = art["indexAbi"]

    if int(vault_addr, 16) == 0:
        tokens = [_cs(w3, t) for _, t, _, _ in PACK]
        pools = [pool_ref(p, v4) for _, _, p, v4 in PACK]
        print("pack " + " ".join(sym for sym, _, _, _ in PACK))
        create_tx = fac.functions.create(
            "FAANG X",
            "FAANGX",
            "faangx",
            tokens,
            pools,
            CREATOR_FEE_BPS,
            _cs(w3, acct.address),
            IMAGE,
        ).build_transaction({"from": acct.address})
        create_tx["gas"] = min(int(w3.eth.estimate_gas(create_tx) * 13 // 10) + 120_000, 12_000_000)
        send(w3, acct, create_tx, "create-faangx")
        vault_addr = fac.functions.bySlug("faangx").call()
    else:
        print(f"resume vault {vault_addr}")

    vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=index_abi)
    fee = int(vault.functions.creatorFeeBps().call())
    if fee != CREATOR_FEE_BPS:
        raise SystemExit(f"creator fee {fee} != {CREATOR_FEE_BPS}")

    n = int(vault.functions.nTokens().call())
    each = (10_000 - 2500) // n
    listed = [vault.functions.tokenAt(i).call() for i in range(n)]
    send(w3, acct, vault.functions.setTargets(listed, [each] * n).build_transaction({"from": acct.address}), "setTargets")

    held = int(vault.functions.balanceOf(acct.address).call())
    if held == 0:
        test_shares = deposit(w3, acct, vault, TEST_WEI, "test-deposit")
        withdraw_all(w3, acct, vault, test_shares, "test-withdraw")
        print("PASS smoke enter/exit")
        deposit(w3, acct, vault, FINAL_WEI, "seed-deposit")
        rebalance_equal(w3, acct, vault)
    else:
        print(f"resume shares={held / 1e18:.6f}")

    print_bags(w3, vault)
    print(f"READY faangx={vault_addr} https://www.xhoodindex.com/i/faangx")


if __name__ == "__main__":
    main()
