"""Local-fork token behaviour checks for every token H3 has selected (read-only).

Starts a local anvil fork of Robinhood Chain (the private RPC URL is passed to
anvil from the local file and never printed), impersonates the Uniswap V4
PoolManager (which holds pool balances) ON THE FORK ONLY, and for each token:
  1. PoolManager -> fresh address A: transfer 0.1% of the manager's balance,
     and check A received exactly that (buy-side / transfer tax);
  2. A -> fresh address B: transfer everything, and check B received it all
     (sell-side tax, blacklist, max-tx or revert traps);
  3. B -> PoolManager (the transfer a SELL into a V4 pool performs), check it all arrives;
  4. record gas used by each transfer (gas-heavy tokens).
Nothing is sent to the real chain. The fork is discarded at the end.
"""

from __future__ import annotations

import gzip
import json
import os
import socket
import subprocess
import time
from pathlib import Path

from web3 import Web3

import feex_next_day_check as fx

ROOT = Path(__file__).parent
ANVIL = Path.home() / ".foundry" / "bin" / "anvil.exe"
OUT = ROOT / "huntx_fork_token_checks.json"
MANAGER = Web3.to_checksum_address("0x8366a39cc670b4001a1121b8f6a443a643e40951")
PORT = 8547
ERC20 = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "a", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "transfer", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "to", "type": "address"}, {"name": "v", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "symbol", "type": "function", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "string"}]},
]


def h3_tokens():
    toks = set()
    for f in ("huntx_edge_oos_ledger.json.gz", "huntx_edge_slice_ledger.json.gz"):
        p = ROOT / f
        if p.exists():
            for r in json.load(gzip.open(p, "rt"))["outcomes"].get("H3", []):
                toks.add(r["token"])
    day0 = json.loads((ROOT / "huntx_edge_prospective_2026-09-30.json").read_text())["frozen"]["selected"]
    toks |= {c["token"] for c in day0 if c["flags"].get("H3") is not None}
    for f in (ROOT / "huntx_forward").glob("decisions_*.json"):
        toks |= {x["token"] for x in json.loads(f.read_text())["payload"]["H3"]}
    return sorted(t for t in toks if t != "0x" + "0" * 40)


def wait_port(port, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(1)
    raise RuntimeError("anvil did not start")


def main():
    tokens = h3_tokens()
    print("tokens to check", len(tokens), flush=True)
    proc = subprocess.Popen([str(ANVIL), "--fork-url", fx.ENDPOINT, "--port", str(PORT),
                             "--compute-units-per-second", "500", "--no-mining", "--silent"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = []
    try:
        wait_port(PORT)
        w3 = Web3(Web3.HTTPProvider(f"http://127.0.0.1:{PORT}", request_kwargs={"timeout": 120}))
        w3.provider.make_request("anvil_setAutomine", [True])
        w3.provider.make_request("anvil_impersonateAccount", [MANAGER])
        w3.provider.make_request("anvil_setBalance", [MANAGER, hex(10**20)])
        A = Web3.to_checksum_address("0x" + "a1" * 20)
        B = Web3.to_checksum_address("0x" + "b2" * 20)
        w3.provider.make_request("anvil_impersonateAccount", [A])
        w3.provider.make_request("anvil_setBalance", [A, hex(10**20)])
        block = w3.eth.block_number
        for t in tokens:
            r = {"token": t}
            try:
                c = w3.eth.contract(address=Web3.to_checksum_address(t), abi=ERC20)
                try:
                    r["symbol"] = c.functions.symbol().call()
                except Exception:
                    r["symbol"] = None
                bal = c.functions.balanceOf(MANAGER).call()
                amt = bal // 1000
                if amt == 0:
                    r["status"] = "manager holds none"
                    results.append(r)
                    continue
                a0, b0 = c.functions.balanceOf(A).call(), c.functions.balanceOf(B).call()
                tx = c.functions.transfer(A, amt).transact({"from": MANAGER, "gas": 3_000_000})
                rc = w3.eth.wait_for_transaction_receipt(tx)
                got_a = c.functions.balanceOf(A).call() - a0
                r["tx1_status"], r["tx1_gas"] = rc.status, rc.gasUsed
                r["receive_ratio_1"] = got_a / amt if amt else None
                if rc.status and got_a > 0:
                    tx = c.functions.transfer(B, got_a).transact({"from": A, "gas": 3_000_000})
                    rc2 = w3.eth.wait_for_transaction_receipt(tx)
                    got_b = c.functions.balanceOf(B).call() - b0
                    r["tx2_status"], r["tx2_gas"] = rc2.status, rc2.gasUsed
                    r["receive_ratio_2"] = got_b / got_a
                    # hop 3: holder -> PoolManager, i.e. what settling a SELL into a V4 pool does
                    if rc2.status and got_b > 0:
                        w3.provider.make_request("anvil_impersonateAccount", [B])
                        w3.provider.make_request("anvil_setBalance", [B, hex(10**20)])
                        m0 = c.functions.balanceOf(MANAGER).call()
                        tx = c.functions.transfer(MANAGER, got_b).transact({"from": B, "gas": 3_000_000})
                        rc3 = w3.eth.wait_for_transaction_receipt(tx)
                        r["tx3_status"], r["tx3_gas"] = rc3.status, rc3.gasUsed
                        r["receive_ratio_3"] = (c.functions.balanceOf(MANAGER).call() - m0) / got_b
                ok = (r.get("tx1_status") == 1 and r.get("tx2_status") == 1 and r.get("tx3_status") == 1
                      and all(abs((r.get(f"receive_ratio_{k}") or 0) - 1) < 1e-9 for k in (1, 2, 3)))
                r["status"] = "CLEAN" if ok else "FLAGGED"
                if max(r.get("tx1_gas", 0), r.get("tx2_gas", 0), r.get("tx3_gas", 0)) > 150_000:
                    r["status"] += "+GAS_HEAVY"
            except Exception as e:                       # revert or non-standard token
                r["status"] = "FLAGGED: " + type(e).__name__ + ": " + str(e)[:140]
            results.append(r)
            print(r["token"][:10], r.get("symbol"), r["status"], flush=True)
    finally:
        proc.terminate()
        proc.wait(timeout=30)
    OUT.write_text(json.dumps({"method": __doc__.strip(), "fork_block": block, "results": results}, indent=1))
    summary = {}
    for r in results:
        k = r["status"].split(":")[0]
        summary[k] = summary.get(k, 0) + 1
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
