#!/usr/bin/env python3
"""Deploy hardened factory + 696x, prove deposit/exit, reject extract/hook binds.

Uses the other-bot launch wallet. Never prints keys or the RPC URL.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

from compile_factory import compile_factory  # noqa: E402
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
from vault_math import min_shares_floor  # noqa: E402
import launch_v2  # noqa: E402

WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2"
V4_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
V4_STATE = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
V4_POSM = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
IMAGE = "https://www.xhoodindex.com/curators/696_eth.jpg"
ORACLE = "0x815A0D4909460B29c70868e24831F575cA86F3aD"
RESCUE_TOK = "0xAaF2abfFff2caf2aB0bD4b6A5C749fFa0f1EE8fd"
RESCUE_POOL = "0x6C0F80E971d4a21481F23C0D373280F34D21A661"
ARIA = "0xA74a94c15B95f8d5F3abDd2Db00F6c7384037B55"
ARIA_POOL = "0x77ea11bbfb8f1259c702cb0ebc2105b7c007db89cf30c2f1a8776886a4467c07"
DEPOSIT_WEI = 8 * 10**16  # 0.08 first mint
SKIP_IDS = {"QUOTIENT", "QUOTRON", "HARMONIC", "PROMETHEUS", "ARIA", "RSC"}
ZERO = "0x0000000000000000000000000000000000000000"
MIN_POOL_WETH = 2 * 10**16


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


def deploy(w3, acct, abi, bytecode, args, label: str):
    c = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = c.constructor(*args).build_transaction({"from": acct.address})
    rcpt = send(w3, acct, tx, label)
    addr = rcpt["contractAddress"]
    print(f"{label} -> {addr}")
    return addr


def sim_fn(fn, from_addr: str, value: int = 0) -> bool:
    try:
        fn.call({"from": from_addr, "value": value})
        return True
    except Exception:
        return False


def v3_weth(w3, pool: str) -> int:
    erc = w3.eth.contract(
        address=_cs(w3, WETH),
        abi=[{"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"}],
    )
    return int(erc.functions.balanceOf(_cs(w3, pool)).call())


def v4_liq(w3, pool: str) -> int | None:
    if len(pool.replace("0x", "")) != 64:
        return None
    view = w3.eth.contract(
        address=_cs(w3, V4_STATE),
        abi=[
            {
                "inputs": [{"name": "poolId", "type": "bytes32"}],
                "name": "getLiquidity",
                "outputs": [{"type": "uint128"}],
                "stateMutability": "view",
                "type": "function",
            }
        ],
    )
    try:
        return int(view.functions.getLiquidity(bytes.fromhex(pool.replace("0x", ""))).call())
    except Exception:
        return None


def v4_hooks(w3, pool: str) -> str | None:
    if len(pool.replace("0x", "")) != 64:
        return None
    posm = w3.eth.contract(
        address=_cs(w3, V4_POSM),
        abi=[
            {
                "inputs": [{"name": "poolId", "type": "bytes25"}],
                "name": "poolKeys",
                "outputs": [
                    {"type": "address"},
                    {"type": "address"},
                    {"type": "uint24"},
                    {"type": "int24"},
                    {"type": "address"},
                ],
                "stateMutability": "view",
                "type": "function",
            }
        ],
    )
    try:
        return str(posm.functions.poolKeys(bytes.fromhex(pool.replace("0x", "")[:50])).call()[4]).lower()
    except Exception:
        return None


def pack_rows(w3):
    raw = json.loads((ROOT / "deployed.json").read_text())
    rows = []
    for row in raw.get("pack") or []:
        ident = str(row.get("id") or "").upper()
        if ident in SKIP_IDS:
            print(f"skip {ident} (unsafe/thin)")
            continue
        pool = str(row.get("pool") or "")
        hooks = str(row.get("hooks") or "").lower()
        if hooks and hooks != ZERO.lower():
            print(f"skip hooked {ident}")
            continue
        on = v4_hooks(w3, pool)
        if on and on != ZERO.lower():
            print(f"skip hooked {ident} {on}")
            continue
        if len(pool.replace("0x", "")) == 64:
            liq = v4_liq(w3, pool)
            if liq is None or liq == 0:
                print(f"skip empty v4 {ident}")
                continue
        if len(pool.replace("0x", "")) == 40 and v3_weth(w3, pool) < MIN_POOL_WETH:
            print(f"skip thin v3 {ident} weth={v3_weth(w3, pool) / 1e18:.4f}")
            continue
        rows.append(row)
    if len(rows) < 2:
        raise SystemExit("safe pack < 2")
    tokens = [_cs(w3, r["token"]) for r in rows]
    pools = [pool_ref(r["pool"]) for r in rows]
    print("pack " + " ".join(r["id"] for r in rows))
    return tokens, pools, rows


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("not curator")
    bal = w3.eth.get_balance(acct.address)
    print(f"eoa eth={bal / 1e18:.6f}")
    if bal < DEPOSIT_WEI + 2 * 10**16:
        raise SystemExit("need 0.08 ETH + gas")

    art = compile_factory()
    tokens, pools, rows = pack_rows(w3)

    existing = (os.environ.get("HARDEN_FACTORY") or "").strip()
    if existing:
        factory = _cs(w3, existing)
        fac = w3.eth.contract(address=factory, abi=art["factoryAbi"])
        vault_addr = fac.functions.bySlug("696x").call()
        impl = fac.functions.implementation().call()
        vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])
        swap = vault.functions.swapLogic().call()
        print(f"resume factory={factory} vault={vault_addr}")
        n = int(vault.functions.nTokens().call())
        tokens = [vault.functions.tokenAt(i).call() for i in range(n)]
        pools = []
    else:
        swap = deploy(w3, acct, art["swapAbi"], art["swapBytecode"], [_cs(w3, ORACLE)], "swap")
        impl = deploy(
            w3,
            acct,
            art["indexAbi"],
            art["indexBytecode"],
            [_cs(w3, ORACLE), _cs(w3, swap)],
            "implementation",
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
            "factory",
        )
        fac = w3.eth.contract(address=_cs(w3, factory), abi=art["factoryAbi"])
        create_tx = fac.functions.create696x(tokens, pools, _cs(w3, CURATOR), IMAGE).build_transaction(
            {"from": acct.address}
        )
        try:
            create_tx["gas"] = min(int(w3.eth.estimate_gas(create_tx) * 13 // 10) + 100_000, 12_000_000)
            send(w3, acct, create_tx, "create696x")
        except Exception as exc:  # noqa: BLE001
            print(f"full pack failed ({exc}); seed 2 + addTokens")
            seed = fac.functions.create696x(tokens[:2], pools[:2], _cs(w3, CURATOR), IMAGE).build_transaction(
                {"from": acct.address}
            )
            send(w3, acct, seed, "create696x-seed")
            vault_addr = fac.functions.bySlug("696x").call()
            vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])
            rest_t, rest_p = tokens[2:], pools[2:]
            for i in range(0, len(rest_t), 2):
                add_tx = vault.functions.addTokens(rest_t[i : i + 2], rest_p[i : i + 2]).build_transaction(
                    {"from": acct.address}
                )
                send(w3, acct, add_tx, f"addTokens-{i}")
            n = int(vault.functions.nTokens().call())
            each = (10_000 - 2500) // n
            listed = [vault.functions.tokenAt(i).call() for i in range(n)]
            send(w3, acct, vault.functions.setTargets(listed, [each] * n).build_transaction({"from": acct.address}), "setTargets")

        vault_addr = fac.functions.bySlug("696x").call()
        vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])

    n = int(vault.functions.nTokens().call())
    print(f"vault {vault_addr} names={n}")

    # --- attack simulations (must fail) ---
    if sim_fn(vault.functions.addToken(_cs(w3, RESCUE_TOK), pool_ref(RESCUE_POOL)), acct.address):
        raise SystemExit("FAIL: RescueTok bind should revert ThinPool")
    print("PASS extract bind blocked")

    if sim_fn(vault.functions.addToken(_cs(w3, ARIA), pool_ref(ARIA_POOL)), acct.address):
        raise SystemExit("FAIL: hooked Aria bind should revert")
    print("PASS hooked Aria bind blocked")

    if sim_fn(
        vault.functions.setFloors(
            int(vault.functions.minDeposit().call()),
            int(vault.functions.minFirstDeposit().call()),
            int(vault.functions.minSleeveWeth().call()),
            1000,
        ),
        acct.address,
    ):
        raise SystemExit("FAIL: cash floor 10% should revert")
    print("PASS cash floor cannot drop to 10%")

    pons = tokens[0]
    if sim_fn(vault.functions.strandToken(pons), acct.address):
        raise SystemExit("FAIL: strand of a liquid name should revert")
    print("PASS liquid strand blocked")

    if not bool(vault.functions.paused().call()):
        send(w3, acct, vault.functions.setPaused(True).build_transaction({"from": acct.address}), "pause-pre")
    if sim_fn(vault.functions.deposit(1), acct.address, DEPOSIT_WEI):
        raise SystemExit("FAIL: join while paused must revert")
    print("PASS pause blocks join")
    send(w3, acct, vault.functions.setPaused(False).build_transaction({"from": acct.address}), "unpause-pre")

    # --- deposit / pause / withdraw ---
    preview = vault.functions.previewDeposit(DEPOSIT_WEI).call()
    shares = int(preview[0])
    floor = min_shares_floor(shares, 300)
    print(f"deposit 0.08 previewShares={shares / 1e18:.6f} min={floor / 1e18:.6f}")
    send(
        w3,
        acct,
        vault.functions.deposit(floor).build_transaction(
            {"from": acct.address, "value": DEPOSIT_WEI, "gas": 8_000_000}
        ),
        "deposit",
    )
    held = int(vault.functions.balanceOf(acct.address).call())
    assets = int(vault.functions.totalAssets().call())
    redeemable = int(vault.functions.redeemableAssets().call())
    print(f"shares={held / 1e18:.6f} assets={assets / 1e18:.6f} redeemable={redeemable / 1e18:.6f}")
    if held <= 0 or redeemable <= 0:
        raise SystemExit("deposit minted nothing")
    can = bool(vault.functions.canWithdraw(held).call())
    min_out, names = vault.functions.previewSell(held).call()
    print(f"canWithdraw={can} previewSell={int(min_out) / 1e18:.6f} names={names}")
    if not can or int(min_out) <= 0:
        raise SystemExit("FAIL: exit closed after deposit")

    send(w3, acct, vault.functions.setPaused(True).build_transaction({"from": acct.address}), "pause")
    if not sim_fn(vault.functions.withdraw(held, 0), acct.address):
        raise SystemExit("FAIL: withdraw while paused must work")
    send(w3, acct, vault.functions.withdraw(held, 0).build_transaction({"from": acct.address, "gas": 8_000_000}), "withdraw-paused")
    send(w3, acct, vault.functions.setPaused(False).build_transaction({"from": acct.address}), "unpause")

    left = int(vault.functions.balanceOf(acct.address).call())
    print(f"eoa shares after exit={left / 1e18:.6f} eth={w3.eth.get_balance(acct.address) / 1e18:.6f}")
    if left != 0:
        raise SystemExit("FAIL: curator shares remaining")

    if sim_fn(vault.functions.claimDust(_cs(w3, RESCUE_TOK)), acct.address):
        raise SystemExit("FAIL: claimDust on never-stranded token")
    print("PASS claimDust unstranded reverts")

    dep = json.loads((ROOT / "deployed.json").read_text())
    dep["hookSafeFactory"] = dep.get("factory")
    dep["hookSafeVault"] = dep.get("vault696x")
    dep.update(
        {
            "factory": factory,
            "implementation": impl,
            "swapLogic": swap,
            "oracle": ORACLE,
            "vault696x": vault_addr,
            "pack": rows,
            "hardened": True,
        }
    )
    (ROOT / "deployed.json").write_text(json.dumps(dep, indent=2) + "\n")
    patch_hud(factory, vault_addr)
    print(f"READY {vault_addr}")


def patch_hud(factory: str, vault: str) -> None:
    old_vault = "0x466742D65C21eC1A4c82f2D0Fd9E3C01C78D89dE"
    old_factory = "0xc29a60cc325b35794f4AE65B8bc518639e716FbD"
    cfg = ROOT / "lib" / "config.ts"
    text = cfg.read_text()
    text = text.replace(
        f'export const SAFE_696X_ADDR = "{old_vault}";',
        f'export const SAFE_696X_ADDR = "{vault}";',
    )
    text = text.replace(
        f'export const LIVE_FACTORY_ADDR = "{old_factory}";',
        f'export const LIVE_FACTORY_ADDR = "{factory}";',
    )
    if f'SAFE_696X_ADDR = "{vault}"' not in text:
        raise SystemExit("failed to pin SAFE_696X_ADDR")
    cfg.write_text(text)
    env = ROOT / ".env.example"
    env.write_text(
        env.read_text()
        .replace(f"NEXT_PUBLIC_FACTORY_ADDRESS={old_factory}", f"NEXT_PUBLIC_FACTORY_ADDRESS={factory}")
        .replace(f"NEXT_PUBLIC_VAULT_ADDRESS={old_vault}", f"NEXT_PUBLIC_VAULT_ADDRESS={vault}")
    )
    live = ROOT / "live_funds.py"
    live.write_text(
        live.read_text().replace(
            'LIVE_696X = "0x6350f9e8e630785abf09fd1127366998ad821e33"',
            f'LIVE_696X = "{vault.lower()}"',
        )
    )
    tests = ROOT / "tests" / "test_vault.py"
    t = tests.read_text()
    t = t.replace(f'SAFE_VAULT = "{old_vault}"', f'SAFE_VAULT = "{vault}"')
    t = t.replace(f'LIVE_FACTORY = "{old_factory}"', f'LIVE_FACTORY = "{factory}"')
    tests.write_text(t)
    readme = ROOT / "README.md"
    if readme.exists():
        r = readme.read_text()
        r = r.replace("0x6350f9e8e630785ABF09fD1127366998Ad821E33", vault)
        r = r.replace("0x3860176e3cEd09519C377FFc9eDC8379aC4DDf71", factory)
        r = r.replace(old_vault, vault)
        r = r.replace(old_factory, factory)
        readme.write_text(r)


if __name__ == "__main__":
    main()
