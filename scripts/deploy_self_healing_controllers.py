"""Deploy the reviewed V2 self-healing controllers through a private RPC relay."""

import argparse
import json
import os
import subprocess
from pathlib import Path

from v2_relay import local_rpc


DEPLOYER = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"
FINGERPRINT = "0x01a716ad159729482bb0156c0190c6781573b5b39893c7154e7a04325de98140"
MAX_FEE_PER_GAS_WEI = "60000000"


def _hex_int(value) -> int:
    return int(value, 0) if isinstance(value, str) else int(value)


def _constructor_input(project: Path, vault: str, curator: str) -> str:
    artifact_path = project / "out/HoodxSelfHealingControllerV2.sol/HoodxSelfHealingControllerV2.json"
    artifact = json.loads(artifact_path.read_text())
    bytecode = artifact["bytecode"]["object"]
    if not bytecode.startswith("0x") or artifact["bytecode"].get("linkReferences"):
        raise SystemExit("Unexpected controller creation artifact. Nothing was broadcast.")
    encode_address = lambda address: address.lower().removeprefix("0x").rjust(64, "0")
    return (bytecode + encode_address(vault) + encode_address(curator)).lower()


def _validate_resume_record(project: Path, record_path: Path, manifest: dict, cast: str) -> None:
    record = json.loads(record_path.read_text())
    entries = record.get("transactions")
    if not isinstance(entries, list) or len(entries) != 2:
        raise SystemExit("Foundry resume record is not the reviewed two-transaction deployment. Nothing was broadcast.")
    expected = []
    for offset, symbol in enumerate(("696X", "FAANGX")):
        vault = manifest["vaults"][symbol]
        init_code = _constructor_input(project, vault, manifest["curator"])
        actual_init_hash = subprocess.check_output([cast, "keccak", init_code], cwd=project, text=True).strip()
        if actual_init_hash.lower() != manifest["initCodeHashes"][symbol].lower():
            raise SystemExit(f"{symbol} creation input does not match the reviewed manifest. Nothing was broadcast.")
        expected.append({
            "nonce": manifest["deployerNonceBefore"] + offset,
            "input": init_code,
        })
    for index, (entry, wanted) in enumerate(zip(entries, expected)):
        tx = entry.get("transaction", entry)
        sender = str(tx.get("from", "")).lower()
        recipient = tx.get("to")
        value = _hex_int(tx.get("value", 0))
        nonce = _hex_int(tx.get("nonce", -1))
        input_data = str(tx.get("input", tx.get("data", ""))).lower()
        tx_type = str(entry.get("transactionType", tx.get("transactionType", "CREATE"))).upper()
        if (
            sender != DEPLOYER.lower()
            or recipient not in (None, "", "0x", "0x0000000000000000000000000000000000000000")
            or value != 0
            or nonce != wanted["nonce"]
            or input_data != wanted["input"]
            or "CREATE" not in tx_type
        ):
            raise SystemExit(f"Foundry resume transaction {index + 1} does not match the reviewed deployment. Nothing was broadcast.")
    if record.get("chain") not in (None, 4663, "4663", "0x1237"):
        raise SystemExit("Foundry resume record chain mismatch. Nothing was broadcast.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--broadcast", action="store_true")
    args = parser.parse_args()

    endpoint = os.environ.get("ROBINHOOD_RPC_URL")
    if not endpoint:
        raise SystemExit("ROBINHOOD_RPC_URL is missing")

    env = os.environ.copy()
    env.pop("ROBINHOOD_RPC_URL", None)
    if args.broadcast:
        required = {
            "HOODX_LIVE_BROADCAST": "1",
            "HOODX_DEPLOY_STAGE": "self-healing-v2-controllers",
            "HOODX_REVIEWED_BUILD": FINGERPRINT,
        }
        for name, expected in required.items():
            if env.get(name) != expected:
                raise SystemExit(f"{name} must equal the reviewed value. Nothing was broadcast.")
        print(
            "Deploying two reviewed controllers only. No vault ownership or assets move in this step.\n"
            "Signing with encrypted account hoodx-deployer-v2. Enter the password only at Foundry's hidden prompt.",
            flush=True,
        )

    project = Path(__file__).resolve().parents[1]
    manifest = json.loads((project / "deployments/self-healing-v2-reviewed.json").read_text())
    if manifest["reviewedBuild"] != FINGERPRINT or manifest["deployerNonceBefore"] != 101:
        raise SystemExit("Reviewed deployment manifest mismatch. Nothing was broadcast.")
    forge = os.environ.get("HOODX_FORGE", "forge")
    cast = os.environ.get("HOODX_CAST", str(Path(forge).with_name("cast.exe")))
    state_path = project / "deployments/self-healing-v2-broadcast-state.json"
    with local_rpc(endpoint) as url:
        def cast_value(*args: str) -> str:
            return subprocess.check_output([cast, *args, "--rpc-url", url], cwd=project, text=True).strip()

        if _hex_int(cast_value("chain-id")) != manifest["chainId"]:
            raise SystemExit("RPC chain mismatch. Nothing was broadcast.")

        current_nonce = int(cast_value("nonce", DEPLOYER))
        deployed = []
        for symbol in ("696X", "FAANGX"):
            address = manifest["predictedControllers"][symbol]
            code = cast_value("code", address)
            present = code not in ("", "0x")
            if present:
                actual_hash = cast_value("codehash", address).lower()
                if actual_hash != manifest["runtimeCodeHashes"][symbol].lower():
                    raise SystemExit(f"{symbol} controller runtime mismatch. Nothing was broadcast.")
            deployed.append(present)

        if all(deployed):
            state_path.write_text(json.dumps({"status": "complete", "nonce": current_nonce}, indent=2) + "\n")
            print("Both reviewed controllers are already deployed and runtime-verified.", flush=True)
            return 0
        if deployed[1] and not deployed[0]:
            raise SystemExit("Unexpected deployment order. Nothing was broadcast.")
        expected_nonce = manifest["deployerNonceBefore"] + int(deployed[0])
        if current_nonce != expected_nonce:
            raise SystemExit("Deployer nonce changed outside the reviewed sequence. Nothing was broadcast.")

        live_record = project / "broadcast/DeploySelfHealingControllersV2.s.sol/4663/run-latest.json"
        resume = state_path.exists() or live_record.exists() or any(deployed)
        if resume and not live_record.exists():
            raise SystemExit("An earlier broadcast may exist but its Foundry record is missing. Manual receipt review is required.")
        if resume:
            _validate_resume_record(project, live_record, manifest, cast)
        if args.broadcast and not resume:
            state_path.write_text(json.dumps({
                "status": "started",
                "deployerNonceBefore": current_nonce,
                "reviewedBuild": FINGERPRINT,
            }, indent=2) + "\n")

        command = [
            forge,
            "script",
            "script/DeploySelfHealingControllersV2.s.sol:DeploySelfHealingControllersV2",
            "--rpc-url",
            url,
            "--sender",
            DEPLOYER,
            "--disable-external-identification",
            "--with-gas-price",
            MAX_FEE_PER_GAS_WEI,
            "--priority-gas-price",
            "1",
        ]
        if args.broadcast:
            command += ["--broadcast", "--slow", "--account", "hoodx-deployer-v2"]
            if resume:
                command += ["--resume"]
        else:
            command += ["--non-interactive"]
        result = subprocess.run(command, cwd=project, env=env)
        if result.returncode != 0 or not args.broadcast:
            return result.returncode

        for symbol in ("696X", "FAANGX"):
            address = manifest["predictedControllers"][symbol]
            actual_hash = cast_value("codehash", address).lower()
            if actual_hash != manifest["runtimeCodeHashes"][symbol].lower():
                raise SystemExit(f"{symbol} post-deployment runtime verification failed.")
        state_path.write_text(json.dumps({"status": "complete", "reviewedBuild": FINGERPRINT}, indent=2) + "\n")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
