#!/usr/bin/env python3
"""Deploy fixed swap logic + factory, recreate FAANGX, prove full exit.

The live FAANGX clone (0x5680… factory) bakes swapLogic immutably — it cannot be
patched in place. This script deploys a new factory with the _swapQuotedSell
rounding fix and mints a fresh faangx vault with the same pack.

Uses the other-bot launch wallet. Never prints keys or RPC URL.
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

from compile_factory import compile_factory  # noqa: E402
from create_faangx import (  # noqa: E402
    CREATOR_FEE_BPS,
    FINAL_WEI,
    IMAGE,
    PACK,
    TEST_WEI,
    deposit,
    pool_ref,
    print_bags,
    rebalance_equal,
    withdraw_all,
)
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
import launch_v2  # noqa: E402

ORACLE = "0x815A0D4909460B29c70868e24831f575cA86F3aD"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2"
V4_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
V4_STATE = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
V4_POSM = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"
OLD_FACTORY = "0x56809a2738A23650aF939F73588E72C67CafC19b"
OLD_VAULT = "0x1e2Fc61A6794C452f712730228abb4f87838f392"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
# Optional resume addresses (leave empty to deploy fresh swap/impl/factory).
RESUME_SWAP = ""
RESUME_IMPL = ""
RESUME_FACTORY = ""
RESUME_VAULT = ""
MIN_FIRST_WEI = 2 * 10**16  # vault minFirstDeposit


def _cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


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


def deploy(w3, acct, abi, bytecode, args, label: str):
    c = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = c.constructor(*args).build_transaction({"from": acct.address})
    rcpt = send(w3, acct, tx, label)
    addr = rcpt["contractAddress"]
    print(f"{label} -> {addr}")
    return addr


def sim_withdraw(w3, vault, acct, shares: int, label: str) -> float:
    try:
        out = vault.functions.withdraw(shares, 0).call({"from": acct.address})
        eth = int(out) / 1e18
        print(f"{label} simulate withdraw minOut=0 -> {eth:.6f} ETH")
        return eth
    except Exception as e:
        print(f"{label} simulate withdraw FAIL {str(e)[:160]}")
        return 0.0


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    art = compile_factory()
    bal = w3.eth.get_balance(acct.address)
    print(f"eoa {acct.address} eth={bal / 1e18:.6f}")
    gas_head = 2 * 10**16
    seed_wei = FINAL_WEI if bal >= FINAL_WEI + gas_head else MIN_FIRST_WEI
    old_vault = w3.eth.contract(address=_cs(w3, OLD_VAULT), abi=art["indexAbi"])
    old_shares = int(old_vault.functions.balanceOf(acct.address).call())
    if old_shares > 0:
        sim_withdraw(w3, old_vault, acct, old_shares, "OLD faangx")
    if bal < seed_wei + gas_head and old_shares > 0:
        print("wallet tight — exit broken old faangx for gas + reseed")
        send(
            w3,
            acct,
            old_vault.functions.withdraw(old_shares, 0).build_transaction(
                {"from": acct.address, "gas": 8_000_000}
            ),
            "old-faangx-exit",
        )
        bal = w3.eth.get_balance(acct.address)
        print(f"eoa after old exit eth={bal / 1e18:.6f}")
    if bal < seed_wei + 5 * 10**15:
        raise SystemExit("need seed + gas")
    print(f"seed_wei={seed_wei / 1e18:.4f}")

    swap = RESUME_SWAP or "0x0000000000000000000000000000000000000000"
    if not RESUME_SWAP or int(w3.eth.get_code(_cs(w3, swap)).hex(), 16) == 0:
        swap = deploy(w3, acct, art["swapAbi"], art["swapBytecode"], [_cs(w3, ORACLE)], "swap-fixed")
    else:
        print(f"resume swap {swap}")
    impl = RESUME_IMPL or "0x0000000000000000000000000000000000000000"
    if not RESUME_IMPL or int(w3.eth.get_code(_cs(w3, impl)).hex(), 16) == 0:
        impl = deploy(
            w3,
            acct,
            art["indexAbi"],
            art["indexBytecode"],
            [_cs(w3, ORACLE), _cs(w3, swap)],
            "implementation-fixed",
        )
    else:
        print(f"resume impl {impl}")
    factory = RESUME_FACTORY or "0x0000000000000000000000000000000000000000"
    if not RESUME_FACTORY or int(w3.eth.get_code(_cs(w3, factory)).hex(), 16) == 0:
        factory = deploy(
            w3,
            acct,
            art["factoryAbi"],
            art["factoryBytecode"],
            [
                _cs(w3, WETH),
                _cs(w3, ROUTER),
                _cs(w3, CURATOR),
                _cs(w3, V4_MANAGER),
                _cs(w3, V4_STATE),
                _cs(w3, V4_POSM),
                _cs(w3, impl),
            ],
            "factory-fixed",
        )
    else:
        print(f"resume factory {factory}")

    fac = w3.eth.contract(address=_cs(w3, factory), abi=art["factoryAbi"])
    vault_addr = fac.functions.bySlug("faangx").call()
    if int(vault_addr, 16) == 0 and RESUME_VAULT and int(w3.eth.get_code(_cs(w3, RESUME_VAULT)).hex(), 16) != 0:  # noqa: PLR1714
        vault_addr = RESUME_VAULT
        print(f"resume vault {vault_addr}")
    if int(vault_addr, 16) == 0:
        tokens = [_cs(w3, t) for _, t, _, _ in PACK]
        pools = [pool_ref(p, v4) for _, _, p, v4 in PACK]
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
        send(w3, acct, create_tx, "create-faangx-fixed")
        vault_addr = fac.functions.bySlug("faangx").call()
    else:
        print(f"resume vault {vault_addr}")

    vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])
    print(f"swapLogic on new vault -> {vault.functions.swapLogic().call()}")

    n = int(vault.functions.nTokens().call())
    each = (10_000 - 2500) // n
    listed = [vault.functions.tokenAt(i).call() for i in range(n)]
    send(w3, acct, vault.functions.setTargets(listed, [each] * n).build_transaction({"from": acct.address}), "setTargets")

    held = int(vault.functions.balanceOf(acct.address).call())
    if held == 0:
        deposit(w3, acct, vault, seed_wei, "seed-deposit")
        rebalance_equal(w3, acct, vault)
        held = int(vault.functions.balanceOf(acct.address).call())

    print_bags(w3, vault)
    sim_withdraw(w3, vault, acct, held, "NEW faangx pre-exit")
    withdraw_all(w3, acct, vault, held, "NEW faangx full-exit")
    print("PASS full exit on fixed factory")

    out = {
        "oldFactory": OLD_FACTORY,
        "oldVault": OLD_VAULT,
        "factory": factory,
        "implementation": impl,
        "swapLogic": swap,
        "vaultFaangx": vault_addr,
    }
    deployed = json.loads((ROOT / "deployed.json").read_text()) if (ROOT / "deployed.json").exists() else {}
    deployed.update(out)
    (ROOT / "deployed.json").write_text(json.dumps(deployed, indent=2) + "\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
