#!/usr/bin/env python3
"""Adversarial on-chain tests for dust claims / emergency eject / sniping.

Runs against a fresh factory deploy or existing vault slug. Never prints keys.
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

from compile_factory import compile_factory  # noqa: E402
from create_faangx import (  # noqa: E402
    CREATOR_FEE_BPS,
    IMAGE,
    PACK,
    TEST_WEI,
    _cs,
    deposit,
    pool_ref,
    rebalance_equal,
    withdraw_all,
)
from eth_account import Account  # noqa: E402
from ready_faangx import assert_clean, deploy_stack, send  # noqa: E402
from tx_gas import send_eoa_tx  # noqa: E402
import launch_v2  # noqa: E402

CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
MIN_GAS = 5 * 10**15


def estimate_reverts(w3, tx: dict) -> bool:
    try:
        w3.eth.estimate_gas({**tx, "from": tx["from"]})
        return False
    except Exception:
        return True


def fund(w3, curator, to: str, wei: int) -> None:
    tx = {"from": curator, "to": to, "value": wei, "chainId": 4663}
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 12 // 10)
    h = send_eoa_tx(w3, launch_v2.load_account(), tx)
    w3.eth.wait_for_transaction_receipt(h, timeout=120)


def attack_suite(w3, acct, vault, art) -> None:
    idx = w3.eth.contract(address=_cs(w3, vault), abi=art["indexAbi"])
    try:
        rebalance_equal(w3, acct, idx)
    except SystemExit as exc:
        print(f"rebalance partial ({exc})")
    attacker = Account.create()
    fund(w3, acct.address, attacker.address, 3 * 10**15)
    print(f"attacker {attacker.address}")

    # --- 1. strand without pause must fail ---
    meta = _cs(w3, PACK[0][1])
    strand_tx = idx.functions.strandToken(meta).build_transaction({"from": acct.address, "gas": 500_000})
    if not estimate_reverts(w3, strand_tx):
        raise SystemExit("ATTACK FAIL: strand without pause succeeded")
    print("OK strand without pause reverts")

    # --- 2. pause blocks attacker deposit / transfer ---
    send(w3, acct, idx.functions.setPaused(True).build_transaction({"from": acct.address}), "attack-pause")
    dep_att = idx.functions.deposit(1).build_transaction(
        {"from": attacker.address, "value": TEST_WEI, "gas": 800_000}
    )
    if not estimate_reverts(w3, dep_att):
        raise SystemExit("ATTACK FAIL: attacker deposited while paused")
    print("OK attacker deposit blocked while paused")

    shares = int(idx.functions.balanceOf(acct.address).call())
    if shares > 0:
        xfer_att = idx.functions.transfer(attacker.address, shares // 10).build_transaction(
            {"from": acct.address, "gas": 200_000}
        )
        if not estimate_reverts(w3, xfer_att):
            raise SystemExit("ATTACK FAIL: share transfer while paused")
        print("OK share transfer blocked while paused")

    # --- 3. withdraw still open while paused ---
    wd_tx = idx.functions.withdraw(shares, 0).build_transaction({"from": acct.address, "gas": 8_000_000})
    if estimate_reverts(w3, wd_tx):
        raise SystemExit("ATTACK FAIL: withdraw blocked while paused")
    print("OK withdraw open while paused")

    # --- 4. emergency strand while paused (first token with a bag) ---
    erc = [{"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"}]
    strand_tok = None
    for sym, token, _, _ in PACK:
        bal = int(w3.eth.contract(address=_cs(w3, token), abi=erc).functions.balanceOf(vault).call())
        if bal > 0:
            strand_tok = _cs(w3, token)
            print(f"stranding {sym} bag={bal}")
            break
    if not strand_tok:
        raise SystemExit("ATTACK FAIL: no token bag to strand — rebalance did not fill")
    send(w3, acct, idx.functions.strandToken(strand_tok).build_transaction({"from": acct.address}), "attack-strand")
    dust_lock = bool(idx.functions.dustLock().call())
    dust_strands = int(idx.functions.dustStrands().call())
    if not dust_lock or dust_strands < 1:
        raise SystemExit("ATTACK FAIL: dustLock not set after strand")
    print(f"OK dustLock={dust_lock} dustStrands={dust_strands}")

    # --- 5. unpause while dust outstanding must fail ---
    unpause = idx.functions.setPaused(False).build_transaction({"from": acct.address, "gas": 200_000})
    if not estimate_reverts(w3, unpause):
        raise SystemExit("ATTACK FAIL: curator unpaused while dustLock")
    print("OK unpause blocked while dustLock")

    # --- 6. sniping: attacker deposit while dustLock (still paused) ---
    if not estimate_reverts(w3, dep_att):
        raise SystemExit("ATTACK FAIL: sniper deposited during dust claim window")
    print("OK sniper deposit blocked during dust window")

    # --- 7. curator claim pays caller not attacker ---
    bag = int(idx.functions.strandedBag(strand_tok).call())
    if bag == 0:
        raise SystemExit("ATTACK FAIL: strandedBag empty")
    claim_cur = idx.functions.claimDust(strand_tok).build_transaction({"from": acct.address, "gas": 400_000})
    send(w3, acct, claim_cur, "attack-claim-curator")
    claim_att = idx.functions.claimDust(strand_tok).build_transaction({"from": attacker.address, "gas": 400_000})
    if not estimate_reverts(w3, claim_att):
        raise SystemExit("ATTACK FAIL: attacker claimed without shares")
    print("OK attacker cannot claim without shares")

    # --- 8. double claim blocked ---
    if not estimate_reverts(w3, claim_cur):
        raise SystemExit("ATTACK FAIL: double claim allowed")
    print("OK double claim blocked")

    # --- 9. dustLock clears after bag drained ---
    if bool(idx.functions.dustLock().call()):
        raise SystemExit("ATTACK FAIL: dustLock still set after full claim")
    print("OK dustLock cleared after claim")

    send(w3, acct, idx.functions.setPaused(False).build_transaction({"from": acct.address}), "attack-unpause")
    print("OK unpause after dust cleared")

    # --- 10. exit remaining ETH ---
    shares = int(idx.functions.balanceOf(acct.address).call())
    if shares > 0:
        withdraw_all(w3, acct, idx, shares, "attack-exit")


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("not curator EOA")
    if w3.eth.get_balance(acct.address) < MIN_GAS + TEST_WEI:
        raise SystemExit("need gas + test wei")

    art = compile_factory()
    deployed = json.loads((ROOT / "deployed.json").read_text())
    oracle = deployed.get("oracle", "0x815A0D4909460B29c70868e24831f575cA86F3aD")

    swap, impl, factory = deploy_stack(w3, acct, art, oracle)
    fac = w3.eth.contract(address=_cs(w3, factory), abi=art["factoryAbi"])
    slug = "faangx"
    if int(fac.functions.bySlug(slug).call(), 16) != 0:
        raise SystemExit(f"factory already has {slug}")
    tokens = [_cs(w3, t) for _, t, _, _ in PACK]
    pools = [pool_ref(p, v4) for _, _, p, v4 in PACK]
    create_tx = fac.functions.create(
        "Attack Test",
        "ATK",
        slug,
        tokens,
        pools,
        CREATOR_FEE_BPS,
        _cs(w3, acct.address),
        IMAGE,
    ).build_transaction({"from": acct.address})
    create_tx["gas"] = min(int(w3.eth.estimate_gas(create_tx) * 13 // 10) + 120_000, 12_000_000)
    send(w3, acct, create_tx, "attack-create")
    vault = fac.functions.bySlug(slug).call()

    shares = deposit(w3, acct, w3.eth.contract(address=_cs(w3, vault), abi=art["indexAbi"]), TEST_WEI, "attack-deposit")
    print(f"deposited shares={shares / 1e18:.4f}")

    attack_suite(w3, acct, vault, art)
    assert_clean(w3, vault, swap)
    print("\nALL ATTACK TESTS PASSED")
    print(f"factory={factory} vault={vault} swap={swap} impl={impl}")


if __name__ == "__main__":
    main()
