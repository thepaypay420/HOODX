import getpass
import json
import os
import pathlib
import shutil
import subprocess
import time

from eth_account import Account


ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"
CANARY = "0x64C9cBBa19B6f6A6D9646b0694F668BeA2501436"
KEYSTORE = pathlib.Path.home() / ".foundry" / "keystores" / "hoodx-deployer-v2"
RPC_FILE = pathlib.Path.home() / "Desktop" / "RH RPC.txt"
RPC_HELPER = ROOT / "scripts" / "official_deployer_rpc.mjs"
PREPARE = ROOT / "scripts" / "prepare_proportional_canary_bootstrap.mjs"
VERIFY = ROOT / "scripts" / "verify_proportional_canary.mjs"
REPORT = ROOT / "deployments" / "proportional-canary-bootstrap-verification.json"
CAPITAL = 20_000_000_000_000_000
MAX_GAS_FEE = 1_500_000_000_000_000


def node(script: pathlib.Path, *args: str, stdin: str | None = None, env: dict | None = None) -> str:
    executable = shutil.which("node")
    if not executable:
        raise RuntimeError("Node.js was not found")
    result = subprocess.run(
        [executable, "--use-system-ca", str(script), *args],
        cwd=ROOT,
        input=stdin,
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )
    return result.stdout.strip()


def rpc(mode: str, argument: str | None = None, stdin: str | None = None) -> str:
    args = [mode] + ([argument] if argument else [])
    return node(RPC_HELPER, *args, stdin=stdin)


print("HOODX 696X successor — 0.02 ETH canary seed")
print("One bounded deployer transaction bootstraps only the empty 21-asset canary.")
print("The live 696X vault is not called or changed.")
print("Every route is re-quoted and the full transaction is simulated after this password is entered.")
print("The password is local and is never displayed or saved.\n")

keystore = json.loads(KEYSTORE.read_text())
private_key = None
for _ in range(3):
    try:
        private_key = Account.decrypt(keystore, getpass.getpass("Keystore password: "))
        break
    except ValueError:
        print("Password did not unlock the expected keystore.")
if private_key is None:
    raise RuntimeError("The deployer keystore was not unlocked")

account = Account.from_key(private_key)
if account.address.lower() != EXPECTED.lower():
    private_key = None
    raise RuntimeError("Keystore address does not match the required deployer")

environment = os.environ.copy()
environment["ROBINHOOD_RPC_URL"] = RPC_FILE.read_text().strip()
environment["HOODX_CANARY_EXPECT"] = "empty"

try:
    print("\nVerifying the empty canary and all 21 admitted routes…")
    node(VERIFY, env=environment)
    print("Re-quoting every asset and simulating the exact bootstrap…")
    prepared = json.loads(node(PREPARE, env=environment))
    tx = prepared["tx"]
    if prepared["chainId"] != 4663 or prepared["assetCount"] != 21:
        raise RuntimeError("Prepared transaction has the wrong chain or asset count")
    if int(prepared["capitalWei"]) != CAPITAL or tx["to"].lower() != CANARY.lower():
        raise RuntimeError("Prepared transaction has the wrong value or target")
    if int(prepared["maxGasFeeWei"]) > MAX_GAS_FEE:
        raise RuntimeError("Prepared gas reserve exceeds the reviewed cap")

    print(f"Verified assets: {prepared['assetCount']}")
    print("Capital: 0.020000 ETH")
    print(f"Maximum gas reserve: {int(prepared['maxGasFeeWei']) / 10**18:.9f} ETH")
    print("Signing and submitting immediately inside the five-minute quote window…")
    transaction = {
        "chainId": 4663,
        "type": 2,
        "nonce": int(rpc("nonce", EXPECTED), 16),
        "to": tx["to"],
        "data": tx["data"],
        "value": int(tx["value"], 16),
        "gas": int(tx["gas"], 16),
        "maxFeePerGas": int(tx["maxFeePerGas"], 16),
        "maxPriorityFeePerGas": int(tx["maxPriorityFeePerGas"], 16),
    }
    signed = Account.sign_transaction(transaction, private_key)
    raw_transaction = "0x" + signed.raw_transaction.hex()
    transaction_hash = rpc("send", stdin=raw_transaction)
    raw_transaction = ""
    print(f"Submitted: {transaction_hash}")
    print("Waiting for confirmation. Do not resubmit or close this window.")

    receipt = None
    for _ in range(300):
        candidate = json.loads(rpc("receipt", transaction_hash))
        if candidate:
            receipt = candidate
            break
        time.sleep(2)
    if receipt is None:
        raise RuntimeError(f"Receipt is still pending. Do not resubmit: {transaction_hash}")
    if receipt.get("status") != "0x1":
        raise RuntimeError(f"Bootstrap reverted. Transaction: {transaction_hash}")
    if receipt.get("from", "").lower() != EXPECTED.lower() or receipt.get("to", "").lower() != CANARY.lower():
        raise RuntimeError("Confirmed receipt has an unexpected signer or target")

    receipt_block = int(receipt["blockNumber"], 16)
    print("Confirmed. Waiting for 12 blocks before the final state proof…")
    for _ in range(360):
        latest = int(rpc("block"), 16)
        if latest - receipt_block + 1 >= 12:
            break
        time.sleep(2)
    else:
        raise RuntimeError(f"Transaction confirmed but is not final enough yet: {transaction_hash}")

    environment["HOODX_CANARY_EXPECT"] = "bootstrapped"
    environment["HOODX_MIN_CONFIRMATIONS"] = "12"
    verified = node(VERIFY, transaction_hash, env=environment)
    temporary = REPORT.with_suffix(".tmp")
    temporary.write_text(verified + "\n")
    temporary.replace(REPORT)
    print("\nVerified: the 21-asset canary is seeded, all asset sleeves are positive, and the deployer holds every genesis share.")
finally:
    private_key = None

