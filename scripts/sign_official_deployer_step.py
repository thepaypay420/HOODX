import getpass
import json
import pathlib
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from eth_account import Account


EXPECTED = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"
KEYSTORE = pathlib.Path.home() / ".foundry" / "keystores" / "hoodx-deployer-v2"
BASE = "http://127.0.0.1:8795"
ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC_HELPER = ROOT / "scripts" / "official_deployer_rpc.mjs"


def local_json(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=60) as response:
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


prepared = local_json("/prepare?i=1")
if prepared.get("done"):
    print("Step 2 is already verified.")
    raise SystemExit(0)
if prepared.get("signer", "").lower() != EXPECTED.lower():
    raise RuntimeError("The prepared transaction does not require the expected deployer")

print("HOODX official vault launch — deployer step 2")
print("Action: Nominate the bounded route administrator")
print("Value: 0 ETH")
print(f"Maximum gas reserve: {prepared['cap']} ETH")
print("The password is entered locally and is never displayed or saved.")

keystore = json.loads(KEYSTORE.read_text())
private_key = None
for attempt in range(3):
    try:
        private_key = Account.decrypt(keystore, getpass.getpass("Keystore password: "))
        break
    except ValueError:
        print("Password did not unlock the expected keystore.")
if private_key is None:
    raise RuntimeError("Keystore was not unlocked")

account = Account.from_key(private_key)
if account.address.lower() != EXPECTED.lower():
    raise RuntimeError("Keystore address does not match the required deployer")

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
private_key = None
raw_transaction = "0x" + signed.raw_transaction.hex()
transaction_hash = node("send", stdin=raw_transaction)
raw_transaction = ""
print(f"Submitted: {transaction_hash}")
print("Waiting for confirmation…")

receipt_path = "/receipt?" + urllib.parse.urlencode({"i": 1, "hash": transaction_hash})
for _ in range(180):
    try:
        verified = local_json(receipt_path)
        if verified.get("confirmed"):
            print(f"Confirmed. Gas paid: {verified['feeEth']} ETH")
            print("Step 3 is ready in Brave with the official curator wallet.")
            raise SystemExit(0)
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", errors="replace").lower()
        if "not found" not in message and "pending" not in message:
            raise RuntimeError(message) from error
    time.sleep(2)

raise RuntimeError(f"Receipt is still pending. Do not resubmit: {transaction_hash}")
