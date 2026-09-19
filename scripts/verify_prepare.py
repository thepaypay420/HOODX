#!/usr/bin/env python3
"""Compile HOODX contracts, compare on-chain runtime bytecode, export verify artifacts."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from eth_abi import encode
from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "verify-out"
RPC = "https://rpc.mainnet.chain.robinhood.com"
EXPLORER = "https://robinhoodchain.blockscout.com"

ORACLE = "0x815A0D4909460B29c70868e24831f575cA86F3aD"
SWAP = "0x2505a3185136cE990077a71c4929a115d9AEDf75"
IMPL = "0x7A5A47022E993401c5C6CFce0208c10fB032025E"
FACTORY = "0x56809a2738A23650aF939F73588E72C67CafC19b"
VAULT = "0xAC45f6FffB17645057aa783b72b2Ce78BD7A1a3A"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
V4M = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
V4S = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
V4P = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"

COMPILE_SETTINGS = {
    "language": "Solidity",
    "settings": {
        "optimizer": {"enabled": True, "runs": 1},
        "viaIR": True,
        "evmVersion": "cancun",
        "metadata": {"bytecodeHash": "ipfs"},
        "outputSelection": {"*": {"*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"]}},
    },
}


def strip_meta(hex_code: str) -> str:
    """Drop trailing CBOR metadata (ipfs or bzzr1); compare runtime code only."""
    h = hex_code.lower().replace("0x", "")
    solc = h.rfind("64736f6c6343")
    if solc < 0:
        return h
    start = h.rfind("a165", 0, solc)
    return h[:start] if start >= 0 else h[:solc]


def patch_immutables(deployed_hex: str, imm_refs: dict, values: dict[int, str]) -> str:
    h = deployed_hex.lower().replace("0x", "")
    for imm_id, slots in imm_refs.items():
        addr = values[int(imm_id)].lower().replace("0x", "").rjust(64, "0")
        for slot in slots:
            s = slot["start"] * 2
            e = s + slot["length"] * 2
            h = h[:s] + addr + h[e:]
    return h


def compile_all() -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    from compile_factory import compile_factory  # noqa: WPS433

    # Recompile with ipfs metadata hash to match deploy artifacts.
    from solcx import compile_standard, install_solc, set_solc_version

    install_solc("0.8.24")
    set_solc_version("0.8.24")
    sources = {
        f"contracts/{name}": (ROOT / "contracts" / name).read_text()
        for name in ["UniTwap.sol", "HoodxStorage.sol", "HoodxSwap.sol", "HoodxIndex.sol", "HoodxFactory.sol"]
    }
    payload = {**COMPILE_SETTINGS, "sources": {k: {"content": v} for k, v in sources.items()}}
    result = compile_standard(payload, solc_version="0.8.24", allow_paths=str(ROOT / "contracts"))
    (ROOT / "out" / "compile.json").write_text(json.dumps(result))
    compile_factory()
    return result


def find_creation_tx(w3: Web3, addr: str) -> tuple[str, int]:
    addr_l = addr.lower()
    latest = w3.eth.block_number
    lo, hi = 0, latest
    while lo < hi:
        mid = (lo + hi) // 2
        code = w3.eth.get_code(addr, mid)
        if code in (b"", b"\x00"):
            lo = mid + 1
        else:
            hi = mid
    block = lo
    for txh in w3.eth.get_block(block, full_transactions=True)["transactions"]:
        rcpt = w3.eth.get_transaction_receipt(txh["hash"])
        created = rcpt.get("contractAddress")
        if created and created.lower() == addr_l:
            return txh["hash"].hex(), block
    raise RuntimeError(f"creation tx not found for {addr} in block {block}")


def standard_json_input() -> dict:
    sources = {
        f"contracts/{name}": {"content": (ROOT / "contracts" / name).read_text()}
        for name in ["UniTwap.sol", "HoodxStorage.sol", "HoodxSwap.sol", "HoodxIndex.sol", "HoodxFactory.sol"]
    }
    return {**COMPILE_SETTINGS, "sources": sources}


def main() -> int:
    w3 = Web3(Web3.HTTPProvider(RPC))
    comp = compile_all()
    OUT.mkdir(parents=True, exist_ok=True)

    ctor = {
        ORACLE: ("", []),
        SWAP: ("address", [ORACLE]),
        IMPL: ("address,address", [ORACLE, SWAP]),
        FACTORY: (
            "address,address,address,address,address,address,address",
            [WETH, ROUTER, CURATOR, V4M, V4S, V4P, IMPL],
        ),
    }

    immutables = {
        SWAP: {5611: ORACLE},
        IMPL: {682: ORACLE, 684: SWAP},
        FACTORY: {10: IMPL, 12: WETH, 14: ROUTER, 16: V4M, 18: V4S, 20: V4P},
    }

    contracts = [
        ("UniTwapOracle", "contracts/UniTwap.sol", ORACLE, None),
        ("HoodxSwap", "contracts/HoodxSwap.sol", SWAP, immutables[SWAP]),
        ("HoodxIndex", "contracts/HoodxIndex.sol", IMPL, immutables[IMPL]),
        ("HoodxFactory", "contracts/HoodxFactory.sol", FACTORY, immutables[FACTORY]),
    ]

    report: dict = {
        "network": {"chainId": 4663, "rpc": RPC, "explorer": EXPLORER},
        "compiler": {
            "solc": "0.8.24",
            "optimizer": True,
            "runs": 1,
            "viaIR": True,
            "evmVersion": "cancun",
            "bytecodeHash": "ipfs",
        },
        "bytecode": [],
        "contracts": [],
    }

    stdjson = standard_json_input()
    (OUT / "standard-input.json").write_text(json.dumps(stdjson, indent=2))

    all_match = True
    for name, path, addr, imm in contracts:
        obj = comp["contracts"][path][name]
        local = obj["evm"]["deployedBytecode"]["object"]
        if imm:
            local = patch_immutables(local, obj["evm"]["deployedBytecode"]["immutableReferences"], imm)
        chain = w3.eth.get_code(addr).hex()
        match = strip_meta(local) == strip_meta(chain)
        all_match &= match
        sig, args = ctor[addr]
        ctor_hex = encode([t.strip() for t in sig.split(",") if t.strip()], args).hex() if sig else ""
        try:
            txh, block = find_creation_tx(w3, addr)
        except Exception as exc:  # noqa: BLE001
            txh, block = "", 0
            print(f"warn: {addr} creation tx: {exc}")
        entry = {
            "name": name,
            "path": f"{path}:{name}",
            "address": addr,
            "runtimeMatch": match,
            "runtimeBytes": len(chain) // 2 - 1,
            "creationTx": txh,
            "creationBlock": block,
            "constructorArgsHex": ctor_hex,
            "verifyUrl": f"{EXPLORER}/address/{addr}/contract-verification",
            "codeUrl": f"{EXPLORER}/address/{addr}#code",
        }
        report["bytecode"].append({"name": name, "address": addr, "match": match})
        report["contracts"].append(entry)
        per = {
            "contractName": name,
            "fullyQualifiedName": f"{path}:{name}",
            "address": addr,
            "compiler": report["compiler"],
            "constructorArgsHex": ctor_hex,
            "standardJsonInput": "standard-input.json",
        }
        (OUT / f"{addr.lower()}.json").write_text(json.dumps(per, indent=2))
        print(f"{name:14} {addr}  match={match}  tx={txh[:18]}…" if txh else f"{name:14} {addr}  match={match}")

    # $696X clone (EIP-1167)
    code = w3.eth.get_code(VAULT).hex().lower().replace("0x", "")
    impl_in = IMPL.lower().replace("0x", "")
    clone_ok = impl_in in code and len(code) // 2 == 45
    try:
        vault_tx, vault_block = find_creation_tx(w3, VAULT)
    except Exception as exc:  # noqa: BLE001
        vault_tx, vault_block = "", 0
        print(f"warn: vault creation tx: {exc}")
    report["vault696x"] = {
        "address": VAULT,
        "kind": "EIP-1167 minimal proxy",
        "implementation": IMPL,
        "factory": FACTORY,
        "runtimeBytes": len(code) // 2,
        "pointsAtImpl": clone_ok,
        "creationTx": vault_tx,
        "creationBlock": vault_block,
        "note": "Verify HoodxIndex implementation on Blockscout; the vault is a clone.",
        "codeUrl": f"{EXPLORER}/address/{VAULT}#code",
    }
    print(f"$696X vault    {VAULT}  clone→impl={clone_ok}")

    (OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nbytecode match: {'PASS' if all_match else 'FAIL'}")
    return 0 if all_match else 1


if __name__ == "__main__":
    raise SystemExit(main())
