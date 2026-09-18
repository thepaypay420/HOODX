#!/usr/bin/env python3
"""Deploy UniTwapOracle + HoodxSwap + HoodxIndex + HoodxFactory, mint 696x, seed 0.13 ETH.

Uses the other-bot launch wallet. Never prints keys or the RPC URL.
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
PROMETHEUS = "0x20f24b8D2BCaD7cd252fC60EE5f2Db27C2f2f261"
PROMETHEUS_SPCX = "0x627c2c78063757b8e85ef1eae046df8ad0695a1ebd3dbb6b62aec2ee516de2e8"
DEPOSIT_WEI = 13 * 10**16  # 0.13 ETH
OLD_VAULT = "0xeBFA7c94D6d708a242f84c98a048C84b59e95C24"


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
        tx["gas"] = int(w3.eth.estimate_gas(tx) * 13 // 10) + 50_000
    return wait(w3, send_eoa_tx(w3, acct, tx), label)


def deploy(w3, acct, abi, bytecode, args, label: str):
    c = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = c.constructor(*args).build_transaction({"from": acct.address})
    rcpt = send(w3, acct, tx, label)
    addr = rcpt["contractAddress"]
    print(f"{label} -> {addr}")
    return addr


def pack_696x(w3):
    raw = json.loads((ROOT / "deployed.json").read_text())
    rows = []
    for row in raw.get("pack") or []:
        if str(row.get("id") or "").upper() == "WALLET":
            continue
        rows.append(row)
    rows.append(
        {
            "id": "PROMETHEUS",
            "symbol": "PROMETHEUS",
            "token": PROMETHEUS,
            "pool": PROMETHEUS_SPCX,
            "v4": True,
        }
    )
    tokens = [_cs(w3, r["token"]) for r in rows]
    pools = [pool_ref(r["pool"]) for r in rows]
    if len(tokens) < 2 or len(tokens) != len(pools):
        raise SystemExit("bad 696x pack")
    return tokens, pools, rows


def main() -> None:
    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("wallet is not the curator EOA")
    bal = w3.eth.get_balance(acct.address)
    print(f"eoa {acct.address} eth={bal / 1e18:.6f}")
    if bal < DEPOSIT_WEI + 2 * 10**16:
        raise SystemExit("need 0.13 ETH deposit plus gas headroom")

    print("compiling…")
    art = compile_factory()
    tokens, pools, rows = pack_696x(w3)
    print(f"pack {len(tokens)} names: " + " ".join(r["id"] for r in rows))

    oracle = deploy(w3, acct, art["oracleAbi"], art["oracleBytecode"], [], "oracle")
    swap = deploy(w3, acct, art["swapAbi"], art["swapBytecode"], [_cs(w3, oracle)], "swap")
    impl = deploy(
        w3,
        acct,
        art["indexAbi"],
        art["indexBytecode"],
        [_cs(w3, oracle), _cs(w3, swap)],
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
    vault_addr = None
    create_tx = fac.functions.create696x(
        tokens, pools, _cs(w3, CURATOR), IMAGE
    ).build_transaction({"from": acct.address})
    try:
        create_tx["gas"] = min(int(w3.eth.estimate_gas(create_tx) * 13 // 10) + 100_000, 12_000_000)
        send(w3, acct, create_tx, "create696x")
        vault_addr = fac.functions.bySlug("696x").call()
    except Exception as exc:  # noqa: BLE001
        print(f"create696x 14-pack failed ({exc}); minting 2 then addTokens")
        seed = fac.functions.create696x(
            tokens[:2], pools[:2], _cs(w3, CURATOR), IMAGE
        ).build_transaction({"from": acct.address})
        send(w3, acct, seed, "create696x-seed")
        vault_addr = fac.functions.bySlug("696x").call()
        vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])
        rest_t, rest_p = tokens[2:], pools[2:]
        step = 3
        for i in range(0, len(rest_t), step):
            add_tx = vault.functions.addTokens(
                rest_t[i : i + step], rest_p[i : i + step]
            ).build_transaction({"from": acct.address})
            send(w3, acct, add_tx, f"addTokens-{i}")
        n = int(vault.functions.nTokens().call())
        each = (10_000 - 2500) // n
        listed_tokens = [vault.functions.tokenAt(i).call() for i in range(n)]
        tgt = vault.functions.setTargets(listed_tokens, [each] * n).build_transaction(
            {"from": acct.address}
        )
        send(w3, acct, tgt, "setTargets")

    vault = w3.eth.contract(address=_cs(w3, vault_addr), abi=art["indexAbi"])
    n = int(vault.functions.nTokens().call())
    print(f"vault {vault_addr} names={n} image={vault.functions.imageURI().call()}")
    prom = _cs(w3, PROMETHEUS)
    listed = bool(vault.functions.listed(prom).call())
    quote = vault.functions.quoteOf(prom).call() if listed else "0x0"
    ready = bool(vault.functions.oracleReady(prom).call()) if listed else False
    print(f"prometheus listed={listed} quote={quote} oracleReady={ready}")
    if not listed or not ready:
        raise SystemExit("PROMETHEUS bind failed")
    spcx = "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa"
    if quote.lower() != spcx.lower():
        raise SystemExit(f"PROMETHEUS quote {quote} != SPCX")

    preview = vault.functions.previewDeposit(DEPOSIT_WEI).call()
    shares = int(preview[0])
    floor = min_shares_floor(shares, 300)
    print(f"deposit 0.13 ETH previewShares={shares / 1e18:.6f} minShares={floor / 1e18:.6f}")
    dep = vault.functions.deposit(floor).build_transaction(
        {"from": acct.address, "value": DEPOSIT_WEI, "gas": 8_000_000}
    )
    send(w3, acct, dep, "deposit")
    held = int(vault.functions.balanceOf(acct.address).call())
    assets = int(vault.functions.totalAssets().call())
    print(f"eoa shares={held / 1e18:.6f} vaultAssets={assets / 1e18:.6f} ETH")
    bags = []
    for i in range(n):
        token = vault.functions.tokenAt(i).call()
        erc = w3.eth.contract(
            address=token,
            abi=[{"inputs": [{"name": "", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"}],
        )
        bal_t = int(erc.functions.balanceOf(vault.address).call())
        if bal_t > 0:
            bags.append(token)
    print(f"held sleeves {len(bags)}/{n}")

    out = {
        "chainId": 4663,
        "oracle": oracle,
        "swapLogic": swap,
        "factory": factory,
        "implementation": impl,
        "vault696x": vault_addr,
        "owner": CURATOR,
        "weth": WETH,
        "swapRouter": ROUTER,
        "v4Manager": V4_MANAGER,
        "v4StateView": V4_STATE,
        "v4Posm": V4_POSM,
        "imageURI": IMAGE,
        "depositWei": str(DEPOSIT_WEI),
        "shares": str(held),
        "totalAssetsWei": str(assets),
        "prometheusQuote": quote,
        "prometheusReady": ready,
        "deprecatedFactory": "0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9",
        "deprecatedVault": OLD_VAULT,
        "pack": rows,
    }
    (ROOT / "out" / "relaunch.json").write_text(json.dumps(out, indent=2))
    print("wrote out/relaunch.json")


if __name__ == "__main__":
    main()
