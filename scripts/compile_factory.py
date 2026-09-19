#!/usr/bin/env python3
"""Compile HoodxFactory + HoodxIndex with solc 0.8.24. Prints bytecode size."""

from __future__ import annotations

import json
from pathlib import Path

from solcx import compile_standard, install_solc, set_solc_version

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
def compile_factory() -> dict:
    install_solc("0.8.24")
    set_solc_version("0.8.24")
    sources = {
        "contracts/UniTwap.sol": (ROOT / "contracts" / "UniTwap.sol").read_text(),
        "contracts/HoodxStorage.sol": (ROOT / "contracts" / "HoodxStorage.sol").read_text(),
        "contracts/HoodxSwap.sol": (ROOT / "contracts" / "HoodxSwap.sol").read_text(),
        "contracts/HoodxIndex.sol": (ROOT / "contracts" / "HoodxIndex.sol").read_text(),
        "contracts/HoodxFactory.sol": (ROOT / "contracts" / "HoodxFactory.sol").read_text(),
    }
    result = compile_standard(
        {
            "language": "Solidity",
            "sources": {name: {"content": src} for name, src in sources.items()},
            "settings": {
                "optimizer": {"enabled": True, "runs": 1},
                "viaIR": True,
                "metadata": {"bytecodeHash": "ipfs"},
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode", "evm.deployedBytecode"]}},
                "evmVersion": "cancun",
            },
        },
        solc_version="0.8.24",
        allow_paths=str(ROOT / "contracts"),
    )
    OUT.mkdir(exist_ok=True)
    (OUT / "compile.json").write_text(json.dumps(result))
    contracts = result["contracts"]
    factory = contracts["contracts/HoodxFactory.sol"]["HoodxFactory"]
    index = contracts["contracts/HoodxIndex.sol"]["HoodxIndex"]
    twap = contracts["contracts/UniTwap.sol"]["UniTwap"]
    factory_bin = factory["evm"]["bytecode"]["object"]
    index_bin = index["evm"]["bytecode"]["object"]
    index_runtime = index["evm"]["deployedBytecode"]["object"]
    twap_bin = twap["evm"]["bytecode"]["object"]
    payload = {
        "factoryAbi": factory["abi"],
        "factoryBytecode": "0x" + factory_bin if not factory_bin.startswith("0x") else factory_bin,
        "indexAbi": index["abi"],
        "indexBytecode": "0x" + index_bin if not str(index_bin).startswith("0x") else index_bin,
        "indexRuntime": "0x" + index_runtime if not str(index_runtime).startswith("0x") else index_runtime,
        "indexRuntimeBytes": len(index_runtime.replace("0x", "")) // 2,
        "factoryBytes": len(factory_bin.replace("0x", "")) // 2,
        "twapBytecode": "0x" + twap_bin if not str(twap_bin).startswith("0x") else twap_bin,
        "twapAbi": twap["abi"],
        "indexLinkRefs": (index["evm"]["bytecode"] or {}).get("linkReferences") or {},
        "indexRuntimeLinkRefs": (index["evm"]["deployedBytecode"] or {}).get("linkReferences") or {},
        "factoryLinkRefs": (factory["evm"]["bytecode"] or {}).get("linkReferences") or {},
    }
    print(f"HoodxIndex runtime {payload['indexRuntimeBytes']} bytes (limit 24576)")
    print(f"HoodxFactory create {payload['factoryBytes']} bytes")
    print(f"linkRefs index={payload['indexLinkRefs']} factory={payload['factoryLinkRefs']}")
    oracle = contracts["contracts/UniTwap.sol"].get("UniTwapOracle")
    if oracle:
        ob = oracle["evm"]["bytecode"]["object"]
        payload["oracleBytecode"] = "0x" + ob if not str(ob).startswith("0x") else ob
        payload["oracleAbi"] = oracle["abi"]
        payload["oracleBytes"] = len(str(ob).replace("0x", "")) // 2
        print(f"UniTwapOracle create {payload['oracleBytes']} bytes")
    swap = contracts["contracts/HoodxSwap.sol"].get("HoodxSwap")
    if swap:
        sb = swap["evm"]["bytecode"]["object"]
        sr = swap["evm"]["deployedBytecode"]["object"]
        payload["swapBytecode"] = "0x" + sb if not str(sb).startswith("0x") else sb
        payload["swapAbi"] = swap["abi"]
        payload["swapRuntimeBytes"] = len(str(sr).replace("0x", "")) // 2
        print(f"HoodxSwap runtime {payload['swapRuntimeBytes']} bytes (limit 24576)")
        if payload["swapRuntimeBytes"] > 24576:
            raise SystemExit("HoodxSwap exceeds EIP-170 size")
    if payload["indexRuntimeBytes"] > 24576:
        raise SystemExit("HoodxIndex exceeds EIP-170 size")
    (OUT / "hoodx.json").write_text(json.dumps(payload))
    return payload


if __name__ == "__main__":
    compile_factory()
