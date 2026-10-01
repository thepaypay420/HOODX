"""Bounded read-only check of FEEX PONS pools after the prior study window.

Only three known pool addresses are queried over one complete 18-hour window.
No wallet, contract write, production transaction, or broad chain scan occurs.
"""

from __future__ import annotations

import json
import atexit
import os
import ssl
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from eth_abi import decode
from web3 import Web3

from launch_hunter_pons_v3_study import simulate_static

ROOT = Path(__file__).resolve().parents[1]
# Cloud runs (GitHub Actions) pass the private RPC as a secret env var; local runs read the Desktop file.
ENDPOINT = os.environ.get("ROBINHOOD_RPC_URL", "").strip() or \
    (Path.home() / "Desktop" / "RH RPC.txt").read_text(encoding="utf-8").strip()
OFFICIAL_ENDPOINT = "https://rpc.mainnet.chain.robinhood.com"


def tls_ca_bundle() -> str | bool:
    """Use the OS roots on Windows, including trusted enterprise proxies."""
    configured = os.environ.get("HOODX_RESEARCH_CA_BUNDLE")
    if configured:
        return configured
    if not hasattr(ssl, "enum_certificates"):
        return True
    roots = [ssl.DER_cert_to_PEM_cert(cert) for cert, encoding, _ in ssl.enum_certificates("ROOT")
             if encoding == "x509_asn"]
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as handle:
        handle.write("".join(roots))
        bundle = handle.name
    atexit.register(os.unlink, bundle)
    return bundle


TLS_VERIFY = tls_ca_bundle()
POOLS = {
    "DELTA": "0xd64fbda67e1015df43fa5e49f02ca844729e5f94",
    "PONGO": "0xdec8f541ff159d2b4abd3c3b041cd739bd7c486f",
    "GIWA": "0x28f26fb95ef30218e0090d0776a5cdf65ba44e73",
}
TOPIC = "0x" + Web3.keccak(text="Swap(address,address,int256,int256,uint160,uint128,int24)").hex()
START = datetime(2026, 9, 29, 0, 0, tzinfo=timezone.utc)
END = datetime(2026, 9, 29, 18, 0, tzinfo=timezone.utc)


def rpc(method: str, params: list, *, timeout: int = 25):
    for attempt in range(3):
        try:
            response = requests.post(ENDPOINT, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                                     timeout=timeout, verify=TLS_VERIFY)
            response.raise_for_status()
            payload = response.json()
            if "error" in payload or "result" not in payload:
                raise ValueError("archive RPC returned an error or no result")
            return payload["result"]
        except (requests.RequestException, ValueError):
            if attempt == 2:
                raise RuntimeError(f"bounded read failed for {method}") from None
            time.sleep(1 + attempt)


def official_block_hash(block_number: int) -> str:
    try:
        response = requests.post(
            OFFICIAL_ENDPOINT,
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": [hex(block_number), False]},
            timeout=15,
            verify=TLS_VERIFY,
        )
        response.raise_for_status()
        block = response.json()["result"]
        return block["hash"].lower()
    except (requests.RequestException, KeyError, TypeError, ValueError):
        raise RuntimeError("official RPC block cross-check failed") from None


def block_at(timestamp: int, latest: int) -> int:
    low, high = max(1, latest - 2_000_000), latest
    while low < high:
        mid = (low + high) // 2
        block = rpc("eth_getBlockByNumber", [hex(mid), False])
        if int(block["timestamp"], 16) < timestamp:
            low = mid + 1
        else:
            high = mid
    return low


def fetch(bounds: tuple[int, int]) -> list:
    lo, hi = bounds
    return rpc("eth_getLogs", [{"address": list(POOLS.values()), "fromBlock": hex(lo),
                                 "toBlock": hex(hi), "topics": [TOPIC]}], timeout=40)


def main() -> None:
    if int(rpc("eth_chainId", []), 16) != 4663:
        raise RuntimeError("wrong chain")
    latest_header = rpc("eth_getBlockByNumber", ["latest", False])
    latest = int(latest_header["number"], 16)
    if int(latest_header["timestamp"], 16) < int(END.timestamp()):
        raise RuntimeError("window is not complete")
    first = block_at(int(START.timestamp()), latest)
    last = block_at(int(END.timestamp()), latest) - 1
    private_first = rpc("eth_getBlockByNumber", [hex(first), False])["hash"].lower()
    private_last = rpc("eth_getBlockByNumber", [hex(last), False])["hash"].lower()
    if private_first != official_block_hash(first) or private_last != official_block_hash(last):
        raise RuntimeError("archive and official block hashes disagree")
    ranges = [(lo, min(last, lo + 8_999)) for lo in range(first, last + 1, 9_000)]
    if len(ranges) > 120:
        raise RuntimeError("request budget exceeded")
    logs = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(fetch, bounds) for bounds in ranges]
        for future in as_completed(futures):
            logs.extend(future.result())
    paths = {pool: [] for pool in POOLS.values()}
    for log in sorted(logs, key=lambda row: (int(row["blockNumber"], 16), int(row["logIndex"], 16))):
        pool = log["address"].lower()
        if pool not in paths:
            continue
        amount0, amount1, sqrt_price, liquidity, _ = decode(
            ["int256", "int256", "uint160", "uint128", "int24"], bytes.fromhex(log["data"][2:])
        )
        paths[pool].append({"amount0": amount0, "amount1": amount1,
                            "sqrt_price_x96": sqrt_price, "liquidity": liquidity})
    summary = {
        "window_utc": [START.isoformat(), END.isoformat()], "block_range": [first, last],
        "ranges_queried": len(ranges), "logs": len(logs), "complete": True,
        "transport_tls_verified": True, "boundary_block_hashes_match_official_rpc": True,
        "method": "simulated new 0.0222 WETH static 10% band per pool, 5/6 LP fee share, 1% round-trip allowance, two 0.000025 WETH actions; first swap defines entry price",
        "limitations": ["18 hours only, not an annualized yield", "hypothetical LP fill, not a fork quote or realized fee collection", "not a blind pool selection test"],
        "pools": {},
    }
    for label, pool in POOLS.items():
        swaps = paths[pool]
        summary["pools"][label] = {"address": pool, "swaps": len(swaps),
                                     **simulate_static(swaps, True, .10, .0222, .000025)}
    destination = ROOT / "research" / "launch_hunter_pons_v3_results" / "feex_next_day_check.json"
    destination.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"block_range": summary["block_range"], "ranges_queried": len(ranges), "logs": len(logs),
                      "pools": {k: {"swaps": v["swaps"], "net_return_pct": v.get("net_return_pct"),
                                     "gross_fee_return_pct": v.get("gross_fee_return_pct"),
                                     "inventory_return_pct": v.get("inventory_return_pct")}
                                for k, v in summary["pools"].items()}}, indent=2))


if __name__ == "__main__":
    main()
