#!/usr/bin/env python3
"""Deploy hook-safe contracts, strand Aria on 696X if bytecode allows, withdraw shares.

If the live clone predates strandToken, deploys a fresh factory + 696x vault using v2 logic.
Uses the other-bot launch wallet. Never prints keys or the RPC URL.
"""

from __future__ import annotations

import argparse
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
import launch_v2  # noqa: E402

LIVE_VAULT = "0x6350f9e8e630785ABF09fD1127366998Ad821E33"
LIVE_ORACLE = "0x815A0D4909460B29c70868e24831f575cA86F3aD"
LIVE_IMPL = "0x21b0ae9ecb112d828c6a66b82fdd413b99e44f19"
LIVE_FACTORY = "0x3860176e3cEd09519C377FFc9eDC8379aC4DDf71"
ARIA = "0xA74a94c15B95f8d5F3abDd2Db00F6c7384037B55"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2"
V4_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
V4_STATE = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
V4_POSM = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"
IMAGE = "https://www.xhoodindex.com/curators/696_eth.jpg"
HOOKED = {
    "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
}
ZERO_ADDR = "0x0000000000000000000000000000000000000000"


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


def sim_call(w3, tx, label: str) -> bool:
    try:
        w3.eth.call({"from": tx["from"], "to": tx["to"], "data": tx["data"]})
        print(f"{label}: sim ok")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"{label}: sim fail — {exc}")
        return False


def pool_hooks(w3, pool: str) -> str | None:
    if len(pool.replace("0x", "")) != 64:
        return None
    pool25 = bytes.fromhex(pool.replace("0x", "")[:50])
    posm = w3.eth.contract(
        address=_cs(w3, V4_POSM),
        abi=[
            {
                "inputs": [{"name": "poolId", "type": "bytes25"}],
                "name": "poolKeys",
                "outputs": [
                    {"type": "address", "name": "currency0"},
                    {"type": "address", "name": "currency1"},
                    {"type": "uint24", "name": "fee"},
                    {"type": "int24", "name": "tickSpacing"},
                    {"type": "address", "name": "hooks"},
                ],
                "stateMutability": "view",
                "type": "function",
            }
        ],
    )
    try:
        rows = posm.functions.poolKeys(pool25).call()
        return str(rows[4]).lower()
    except Exception:
        return None


def pack_rows(w3):
    raw = json.loads((ROOT / "deployed.json").read_text())
    rows = []
    for row in raw.get("pack") or []:
        if str(row.get("id") or "").upper() in {"WALLET", "ARIA"}:
            continue
        hooks = str(row.get("hooks") or "").lower()
        if hooks and hooks != ZERO_ADDR:
            print(f"skip hooked v4 {row.get('id')} hooks={hooks}")
            continue
        if row.get("v4"):
            on_chain = pool_hooks(w3, str(row.get("pool") or ""))
            if on_chain and on_chain != ZERO_ADDR:
                print(f"skip hooked v4 {row.get('id')} hooks={on_chain}")
                continue
        rows.append(row)
    tokens = [_cs(w3, r["token"]) for r in rows]
    pools = [pool_ref(r["pool"]) for r in rows]
    return tokens, pools, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="send on-chain txs")
    ap.add_argument("--skip-withdraw", action="store_true")
    ap.add_argument("--skip-migrate", action="store_true", help="do not deploy fresh factory/vault")
    args = ap.parse_args()

    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("wallet is not the curator EOA")

    art = compile_factory()
    index_abi = art["indexAbi"]
    vault = w3.eth.contract(address=_cs(w3, LIVE_VAULT), abi=index_abi)

    shares = int(vault.functions.balanceOf(acct.address).call())
    assets = int(vault.functions.totalAssets().call())
    print(f"live vault {LIVE_VAULT} assets={assets / 1e18:.6f} ETH curatorShares={shares / 1e18:.6f}")

    strand_sel = w3.keccak(text="strandToken(address)")[:4].hex()
    impl_code = w3.eth.get_code(_cs(w3, LIVE_IMPL)).hex()
    has_strand = strand_sel in impl_code
    print(f"live impl strandToken={has_strand}")

    if not args.execute:
        print("dry-run only — pass --execute to deploy + rescue")
        return

    print("deploying hook-safe swap + index impl…")
    swap = deploy(w3, acct, art["swapAbi"], art["swapBytecode"], [_cs(w3, LIVE_ORACLE)], "swap-v2")
    impl = deploy(
        w3,
        acct,
        index_abi,
        art["indexBytecode"],
        [_cs(w3, LIVE_ORACLE), _cs(w3, swap)],
        "implementation-v2",
    )

    out = {
        "chainId": 4663,
        "brickedVault696x": LIVE_VAULT,
        "brickedImpl": LIVE_IMPL,
        "oracle": LIVE_ORACLE,
        "swapLogic": swap,
        "implementation": impl,
        "owner": CURATOR,
    }

    rescued = False
    strand_tx = vault.functions.strandToken(_cs(w3, ARIA)).build_transaction(
        {"from": acct.address, "gas": 800_000}
    )
    if has_strand and sim_call(w3, strand_tx, "strand Aria"):
        send(w3, acct, strand_tx, "strand-aria")
        rescued = True
    else:
        print("live clone lacks strandToken — cannot patch bytecode in place")

    if not args.skip_withdraw and shares > 0:
        wd = vault.functions.withdraw(shares, 0).build_transaction({"from": acct.address, "gas": 12_000_000})
        if sim_call(w3, wd, "withdraw all"):
            rcpt = send(w3, acct, wd, "withdraw-all")
            out["withdrawTx"] = tx_hash_hex(rcpt.transactionHash)
            out["ethAfter"] = str(w3.eth.get_balance(acct.address))
            rescued = True
        else:
            print("withdraw still blocked on live clone")

    if not rescued and not args.skip_migrate:
        print("deploying fresh factory + hook-safe 696x vault…")
        tokens, pools, rows = pack_rows(w3)
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
            "factory-v2",
        )
        fac = w3.eth.contract(address=_cs(w3, factory), abi=art["factoryAbi"])
        create_tx = fac.functions.create696x(tokens, pools, _cs(w3, CURATOR), IMAGE).build_transaction(
            {"from": acct.address, "gas": 12_000_000}
        )
        send(w3, acct, create_tx, "create696x-v2")
        new_vault = fac.functions.bySlug("696x").call()
        out.update(
            {
                "factory": factory,
                "vault696x": new_vault,
                "pack": rows,
                "deprecatedFactory": LIVE_FACTORY,
                "deprecatedVault696x": LIVE_VAULT,
            }
        )
        dep = json.loads((ROOT / "deployed.json").read_text())
        dep.update(
            {
                "factory": factory,
                "implementation": impl,
                "swapLogic": swap,
                "vault696x": new_vault,
                "deprecatedFactory": LIVE_FACTORY,
                "deprecatedVault696x": LIVE_VAULT,
            }
        )
        (ROOT / "deployed.json").write_text(json.dumps(dep, indent=2))
        print(f"new vault {new_vault} — point UI at this address; bricked vault {LIVE_VAULT}")

    (ROOT / "out" / "rescue_696x.json").write_text(json.dumps(out, indent=2))
    print("wrote out/rescue_696x.json")


if __name__ == "__main__":
    main()
