#!/usr/bin/env bash
# Prepare artifacts and print forge verify-contract commands for Robinhood Chain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PYTHON="${PYTHON:-python3}"
export PATH="${HOME}/.config/.foundry/bin:${PATH}"

echo "== compile + bytecode match =="
"$PYTHON" scripts/compile_factory.py
"$PYTHON" scripts/verify_prepare.py

RPC="${RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
API="${BLOCKSCOUT_API_URL:-https://robinhoodchain.blockscout.com/api/}"

cat <<EOF

== Blockscout verify (run locally if API not CF-blocked) ==
See docs/VERIFY.md for browser steps if these fail.

forge verify-contract 0x815A0D4909460B29c70868e24831f575cA86F3aD contracts/UniTwap.sol:UniTwapOracle \\
  --chain-id 4663 --rpc-url $RPC --verifier blockscout --verifier-url $API

forge verify-contract 0x2505a3185136cE990077a71c4929a115d9AEDf75 contracts/HoodxSwap.sol:HoodxSwap \\
  --chain-id 4663 --rpc-url $RPC --verifier blockscout --verifier-url $API \\
  --constructor-args 000000000000000000000000815a0d4909460b29c70868e24831f575ca86f3ad

forge verify-contract 0x7A5A47022E993401c5C6CFce0208c10fB032025E contracts/HoodxIndex.sol:HoodxIndex \\
  --chain-id 4663 --rpc-url $RPC --verifier blockscout --verifier-url $API \\
  --constructor-args 000000000000000000000000815a0d4909460b29c70868e24831f575ca86f3ad0000000000000000000000002505a3185136ce990077a71c4929a115d9aedf75

forge verify-contract 0x56809a2738A23650aF939F73588E72C67CafC19b contracts/HoodxFactory.sol:HoodxFactory \\
  --chain-id 4663 --rpc-url $RPC --verifier blockscout --verifier-url $API \\
  --constructor-args \$(python3 -c "import json;print(json.load(open('docs/verify-out/report.json'))['contracts'][3]['constructorArgsHex'])")

EOF
