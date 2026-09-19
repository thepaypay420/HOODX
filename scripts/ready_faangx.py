#!/usr/bin/env python3
"""Deploy a clean FAANGX factory + vault and prove enter/exit.

Reuses the fixed implementation (swapLogic 0x032F…). Abandons:
  - broken vault 0x1e2f… (AMZN/NFLX strand)
  - superseded vault 0x5265… (USDG dust)

Never prints keys or RPC URL.
"""

from __future__ import annotations

import json
import re
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

WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2"
V4_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
V4_STATE = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
V4_POSM = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
MIN_GAS_HEAD = 8 * 10**15


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


def deploy(w3, acct, abi, bytecode, args, label: str) -> str:
    c = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = c.constructor(*args).build_transaction({"from": acct.address})
    rcpt = send(w3, acct, tx, label)
    return rcpt["contractAddress"]


def deploy_stack(w3, acct, art, oracle: str) -> tuple[str, str, str]:
    swap = deploy(w3, acct, art["swapAbi"], art["swapBytecode"], [_cs(w3, oracle)], "swap-v3")
    impl = deploy(
        w3,
        acct,
        art["indexAbi"],
        art["indexBytecode"],
        [_cs(w3, oracle), _cs(w3, swap)],
        "implementation-v3",
    )
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
        "factory-clean",
    )
    return swap, impl, factory


def deploy_factory(w3, acct, art, impl: str) -> str:
    c = w3.eth.contract(abi=art["factoryAbi"], bytecode=art["factoryBytecode"])
    tx = c.constructor(
        _cs(w3, WETH),
        _cs(w3, ROUTER),
        _cs(w3, CURATOR),
        _cs(w3, V4_MANAGER),
        _cs(w3, V4_STATE),
        _cs(w3, V4_POSM),
        _cs(w3, impl),
    ).build_transaction({"from": acct.address})
    rcpt = send(w3, acct, tx, "factory-clean")
    return rcpt["contractAddress"]


def assert_clean(w3, vault_addr: str, swap_expect: str = "") -> None:
    erc = [{"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"}]
    usdg = int(w3.eth.contract(address=USDG, abi=erc).functions.balanceOf(vault_addr).call())
    if usdg > 0:
        raise SystemExit(f"vault has USDG dust {usdg / 1e6:.2f}")
    idx = [
        {"inputs": [], "name": "swapLogic", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
        {"inputs": [], "name": "totalAssets", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    ]
    v = w3.eth.contract(address=_cs(w3, vault_addr), abi=idx)
    swap = v.functions.swapLogic().call().lower()
    if swap_expect and swap != swap_expect.lower():
        raise SystemExit(f"wrong swapLogic {swap}")
    nav = int(v.functions.totalAssets().call())
    if nav > 0:
        raise SystemExit(f"vault still has nav {nav / 1e18:.6f} ETH after exit")
    print(f"clean check OK swapLogic={swap[:10]}… USDG=0 nav=0")


def patch_config(factory: str, vault: str, old_factory: str, impl: str, swap: str) -> None:
    path = ROOT / "lib" / "config.ts"
    src = path.read_text()
    src = re.sub(
        r'export const LIVE_FACTORY_ADDR = "0x[a-fA-F0-9]{40}";',
        f'export const LIVE_FACTORY_ADDR = "{factory}";',
        src,
        count=1,
    )
    src = re.sub(
        r'export const SUPERSEDED_FAANGX_FACTORY_ADDR = "0x[a-fA-F0-9]{40}";',
        f'export const SUPERSEDED_FAANGX_FACTORY_ADDR = "{old_factory}";',
        src,
        count=1,
    )
    src = re.sub(
        r'export const INDEX_IMPL_ADDR = "0x[a-fA-F0-9]{40}";',
        f'export const INDEX_IMPL_ADDR = "{impl}";',
        src,
        count=1,
    )
    src = re.sub(
        r'export const SWAP_LOGIC_ADDR = "0x[a-fA-F0-9]{40}";',
        f'export const SWAP_LOGIC_ADDR = "{swap}";',
        src,
        count=1,
    )
    src = re.sub(
        r'export const SAFE_FAANGX_VAULT_ADDR = "[^"]*" as `0x\$\{string\}` \| "";',
        f'export const SAFE_FAANGX_VAULT_ADDR = "{vault}" as `0x${{string}}` | "";',
        src,
        count=1,
    )
    path.write_text(src)
    print(f"patched {path.name}")


def _estimate_reverts(w3, tx: dict) -> bool:
    try:
        w3.eth.estimate_gas({**tx, "from": tx.get("from")})
        return False
    except Exception:
        return True


def test_emergency_latch(w3, acct, vault, art) -> None:
    """Paused vault blocks deposits and share transfers; withdraw stays open."""
    idx = w3.eth.contract(address=_cs(w3, vault), abi=art["indexAbi"])
    send(w3, acct, idx.functions.setPaused(True).build_transaction({"from": acct.address}), "emergency-latch")
    dep = idx.functions.deposit(1).build_transaction({"from": acct.address, "value": TEST_WEI, "gas": 500_000})
    if not _estimate_reverts(w3, dep):
        raise SystemExit("deposit should fail when paused")
    shares = int(idx.functions.balanceOf(acct.address).call())
    if shares > 0:
        xfer = idx.functions.transfer(_cs(w3, CURATOR), 1).build_transaction({"from": acct.address, "gas": 200_000})
        if not _estimate_reverts(w3, xfer):
            raise SystemExit("transfer should fail when paused")
        wd = idx.functions.withdraw(shares, 0).build_transaction({"from": acct.address, "gas": 8_000_000})
        if _estimate_reverts(w3, wd):
            raise SystemExit("withdraw must stay open when paused")
    send(w3, acct, idx.functions.setPaused(False).build_transaction({"from": acct.address}), "emergency-unlatch")
    print("emergency latch OK — deposits/transfers blocked, withdraw open while paused")


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("not curator EOA")

    deployed = json.loads((ROOT / "deployed.json").read_text())
    old_factory = deployed.get("factory", "")
    oracle = deployed.get("oracle", "0x815A0D4909460B29c70868e24831f575cA86F3aD")

    bal = w3.eth.get_balance(acct.address)
    need = TEST_WEI + MIN_GAS_HEAD
    print(f"eoa eth={bal / 1e18:.6f} need>={need / 1e18:.4f} for deploy + smoke test")
    if bal < need:
        raise SystemExit("need more ETH on curator EOA for deploy + smoke test")

    art = compile_factory()
    swap, impl, factory = deploy_stack(w3, acct, art, oracle)
    fac = w3.eth.contract(address=_cs(w3, factory), abi=art["factoryAbi"])
    vault_addr = fac.functions.bySlug("faangx").call()
    if int(vault_addr, 16) != 0:
        raise SystemExit(f"factory already has faangx at {vault_addr}")

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
    send(w3, acct, create_tx, "create-faangx-clean")
    vault_addr = fac.functions.bySlug("faangx").call()
    assert_clean(w3, vault_addr, swap)

    vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])
    n = int(vault.functions.nTokens().call())
    each = (10_000 - 2500) // n
    listed = [vault.functions.tokenAt(i).call() for i in range(n)]
    send(w3, acct, vault.functions.setTargets(listed, [each] * n).build_transaction({"from": acct.address}), "setTargets")

    shares = deposit(w3, acct, vault, TEST_WEI, "smoke-deposit")
    try:
        rebalance_equal(w3, acct, vault)
    except SystemExit as exc:
        print(f"rebalance partial ({exc}) — continuing to exit test")
    print_bags(w3, vault)

    min_out, names = vault.functions.previewSell(shares).call()
    print(f"previewSell minOut={int(min_out) / 1e18:.6f} names={names}")
    if int(min_out) <= 0:
        raise SystemExit("previewSell zero — exit would brick")

    test_emergency_latch(w3, acct, vault_addr, art)

    withdraw_all(w3, acct, vault, shares, "smoke-exit")
    assert_clean(w3, vault_addr, swap)

    deployed.update(
        {
            "factory": factory,
            "implementation": impl,
            "swapLogic": swap,
            "vaultFaangx": vault_addr,
            "supersededFaangxFactory": old_factory,
            "supersededFaangxVault": deployed.get("vaultFaangx"),
            "brokenFaangxVault": deployed.get("brokenFaangxVault"),
            "faangxReady": True,
            "faangxUsdGBridgeFix": True,
            "faangxEmergencyLatch": True,
        }
    )
    (ROOT / "deployed.json").write_text(json.dumps(deployed, indent=2) + "\n")
    patch_config(factory, vault_addr, old_factory, impl, swap)

    print(f"\nREADY faangx={vault_addr} factory={factory}")
    print("https://www.xhoodindex.com/i/faangx")
    print(f"eoa eth after {w3.eth.get_balance(acct.address) / 1e18:.6f}")


if __name__ == "__main__":
    main()
