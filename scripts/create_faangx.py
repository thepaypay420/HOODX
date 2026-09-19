#!/usr/bin/env python3
"""Mint $FAANGX on the live factory, smoke-test enter/exit, seed 0.08 ETH.

Official Robinhood Chain stocks only (Investors Center catalog + on-chain name check).
0% curator fee. Equal USD weight across META, AMZN, AAPL, NFLX, GOOGL.
"""

from __future__ import annotations

import json
import sys
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
TEST_WEI = 2 * 10**16  # 0.02 — min first mint on create()
FINAL_WEI = 8 * 10**16  # 0.08 — user seed after smoke test
CREATOR_FEE_BPS = 0

# Deepest bindable V3 pools (WETH or USDG), verified on-chain Mar 2026.
PACK: list[tuple[str, str, str]] = [
    ("META", "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", "0xa4BdB396a69617eb7F70E2cc1EF526f7340b1B0d"),
    ("AMZN", "0x12f190a9F9d7D37a250758b26824B97CE941bF54", "0x8ac92da74ab5f3b1d024dc1943ad7e15dc4179ef"),
    ("AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D"),
    ("NFLX", "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", "0x59895C0302F41aEaa129D2fa2442CEc01E7eF45E"),
    ("GOOGL", "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", "0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7"),
]


def _cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


def pool_ref(pool: str) -> bytes:
    h = pool.lower().replace("0x", "")
    if len(h) == 40:
        h = h.rjust(64, "0")
    if len(h) != 64:
        raise SystemExit(f"bad pool ref {pool}")
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
    print(f"{label} previewShares={shares / 1e18:.6f} min={floor / 1e18:.6f}")
    send(
        w3,
        acct,
        vault.functions.deposit(floor).build_transaction(
            {"from": acct.address, "value": wei, "gas": 8_000_000}
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
    left = int(vault.functions.balanceOf(acct.address).call())
    if left != 0:
        raise SystemExit(f"{label} shares remaining={left}")


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    bal = w3.eth.get_balance(acct.address)
    print(f"eoa {acct.address} eth={bal / 1e18:.6f}")
    # Test deposit is withdrawn before the 0.08 seed — peak lock is FINAL_WEI plus gas.
    need = FINAL_WEI + 2 * 10**16
    if bal < need:
        raise SystemExit(f"need ~{(need / 1e18):.3f} ETH (seed + gas); have {bal / 1e18:.6f}")

    art = json.loads((ROOT / "out" / "hoodx.json").read_text())
    fac = w3.eth.contract(address=_cs(w3, FACTORY), abi=art["factoryAbi"])
    vault_addr = fac.functions.bySlug("faangx").call()
    index_abi = art["indexAbi"]

    if int(vault_addr, 16) == 0:
        tokens = [_cs(w3, t) for _, t, _ in PACK]
        pools = [pool_ref(p) for _, _, p in PACK]
        print("pack " + " ".join(sym for sym, _, _ in PACK))
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
    print(f"vault {vault_addr} creatorFeeBps={fee} image={vault.functions.imageURI().call()}")
    if fee != CREATOR_FEE_BPS:
        raise SystemExit(f"creator fee {fee} != {CREATOR_FEE_BPS}")

    n = int(vault.functions.nTokens().call())
    if n != len(PACK):
        raise SystemExit(f"expected {len(PACK)} tokens, got {n}")
    for sym, tok, _ in PACK:
        if not bool(vault.functions.listed(_cs(w3, tok)).call()):
            raise SystemExit(f"{sym} not listed")

    each = (10_000 - 2500) // n
    listed = [vault.functions.tokenAt(i).call() for i in range(n)]
    tgt = vault.functions.setTargets(listed, [each] * n).build_transaction({"from": acct.address})
    send(w3, acct, tgt, "setTargets")
    print(f"targets {each} bps each ({each / 100:.1f}% per name, 25% cash)")

    # Smoke test: min first mint, then full exit.
    test_shares = deposit(w3, acct, vault, TEST_WEI, "test-deposit")
    withdraw_all(w3, acct, vault, test_shares, "test-withdraw")
    print("PASS smoke enter/exit")

    final_shares = deposit(w3, acct, vault, FINAL_WEI, "seed-deposit")
    assets = int(vault.functions.totalAssets().call())
    redeemable = int(vault.functions.redeemableAssets().call())
    print(
        f"READY faangx={vault_addr} shares={final_shares / 1e18:.6f} "
        f"assets={assets / 1e18:.6f} redeemable={redeemable / 1e18:.6f}"
    )


if __name__ == "__main__":
    main()
