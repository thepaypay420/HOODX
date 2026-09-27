import getpass
import json
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from eth_account import Account


EXPECTED = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"
KEYSTORE = pathlib.Path.home() / ".foundry" / "keystores" / "hoodx-deployer-v2"
BASE = "http://127.0.0.1:8796"
ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC_HELPER = ROOT / "scripts" / "official_deployer_rpc.mjs"
FINAL_ONLY = len(sys.argv) > 1 and sys.argv[1] == "final"
STEPS = (4,) if FINAL_ONLY else (0, 1)


def local_json(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=140) as response:
        return json.loads(response.read())


def node(*args: str, stdin: str | None = None) -> str:
    executable = shutil.which("node")
    if not executable:
        raise RuntimeError("Node.js was not found")
    result = subprocess.run(
        [executable, "--use-system-ca", str(RPC_HELPER), *args],
        cwd=ROOT,
        input=stdin,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout.strip()


print("HOODX 696X successor — infrastructure deployer")
if FINAL_ONLY:
    print("One reviewed, gas-only transaction creates the empty 696xcanary vault.")
else:
    print("Two reviewed, gas-only transactions activate the matured PONS and QUOTRON hooks.")
print("Value: 0 ETH. No deposit, swap, approval, migration, or existing 696X call.")
print("The password is entered locally and is never displayed or saved.\n")

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

try:
    for index in STEPS:
        prepared = local_json(f"/prepare?i={index}")
        if prepared.get("done"):
            print(f"Step {index + 1} is already verified.")
            continue
        if prepared.get("signer", "").lower() != EXPECTED.lower():
            raise RuntimeError(f"Step {index + 1} does not require the expected deployer")

        print(f"\nStep {index + 1}: {prepared['label']}")
        print(f"Maximum gas reserve: {prepared['cap']} ETH")
        raw = prepared["tx"]
        transaction = {
            "chainId": 4663,
            "type": 2,
            "nonce": int(node("nonce", EXPECTED), 16),
            "to": raw["to"],
            "data": raw["data"],
            "value": int(raw.get("value", "0x0"), 16),
            "gas": int(raw["gas"], 16),
            "maxFeePerGas": int(raw["maxFeePerGas"], 16),
            "maxPriorityFeePerGas": int(raw["maxPriorityFeePerGas"], 16),
        }
        signed = Account.sign_transaction(transaction, private_key)
        raw_transaction = "0x" + signed.raw_transaction.hex()
        transaction_hash = node("send", stdin=raw_transaction)
        raw_transaction = ""
        print(f"Submitted: {transaction_hash}")
        print("Waiting for confirmation and exact state verification…")

        receipt_path = "/receipt?" + urllib.parse.urlencode({"i": index, "hash": transaction_hash})
        for _ in range(180):
            try:
                verified = local_json(receipt_path)
                if verified.get("confirmed"):
                    print(f"Confirmed. Gas paid: {verified['feeEth']} ETH")
                    break
            except urllib.error.HTTPError as error:
                message = error.read().decode("utf-8", errors="replace").lower()
                if not any(fragment in message for fragment in ("not found", "not be found", "pending")):
                    raise RuntimeError(message) from error
            time.sleep(2)
        else:
            raise RuntimeError(f"Receipt is still pending. Do not resubmit: {transaction_hash}")
finally:
    private_key = None

if FINAL_ONLY:
    print("\nThe final deployer step is verified. The empty 696xcanary vault has been created.")
else:
    print("\nBoth hook activations are verified. Return to Brave, refresh the signer page, connect Rabby, and continue with steps 3–4.")
