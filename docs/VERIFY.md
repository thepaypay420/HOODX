# Contract verification (Robinhood Chain 4663)

**Verified ≠ audited.** Publishing source on Blockscout only proves the on-chain bytecode matches this repo’s compile settings. It does not mean the contracts are safe to use.

Use **only** [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) — not hoodscan, robinscan, or other lookalikes.

## Canonical addresses

| Role | Address |
|------|---------|
| TWAP oracle | `0x815A0D4909460B29c70868e24831f575cA86F3aD` |
| HoodxSwap | `0x2505a3185136cE990077a71c4929a115d9AEDf75` |
| HoodxIndex implementation | `0x7A5A47022E993401c5C6CFce0208c10fB032025E` |
| HoodxFactory | `0x56809a2738A23650aF939F73588E72C67CafC19b` |
| **$696X vault (clone)** | `0xAC45f6FffB17645057aa783b72b2Ce78BD7A1a3A` |
| WETH (reference) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

The **$696X vault is an EIP-1167 minimal proxy** pointing at the HoodxIndex implementation above. Verify the **implementation** on Blockscout; the clone bytecode is the standard 45-byte proxy (`0x363d3d373d3d3d363d73…5af43d82803e903d91602b57fd5bf3`).

## Build settings (must match deploy)

Deployed with `scripts/compile_factory.py` / `scripts/harden_relaunch.py` (Python `py-solc-x`, not Foundry deploy).

| Setting | Value |
|---------|--------|
| solc | **0.8.24** |
| optimizer | **enabled** |
| optimizer runs | **1** |
| viaIR | **true** |
| evmVersion | **cancun** |
| bytecodeHash (metadata) | **ipfs** |
| library links | **none** |

`foundry.toml` mirrors these settings for `forge verify-contract`.

## Step 1 — Rebuild locally

```bash
cd /path/to/HOODX
python3 scripts/compile_factory.py          # writes out/compile.json, out/hoodx.json
python3 scripts/verify_prepare.py         # bytecode diff + docs/verify-out/*
```

## Step 2 — Bytecode match (done in CI / locally)

Runtime bytecode is compared **after stripping CBOR metadata** (ipfs hash suffix differs; opcodes must match).

| Contract | Address | Runtime match |
|----------|---------|---------------|
| UniTwapOracle | `0x815A…F3aD` | **yes** |
| HoodxSwap | `0x2505…Df75` | **yes** |
| HoodxIndex | `0x7A5A…025E` | **yes** |
| HoodxFactory | `0x5680…C19b` | **yes** |
| $696X vault | `0xAC45…1a3A` | **clone → `0x7A5A…025E`** |

Manual check:

```bash
cast code 0x815A0D4909460B29c70868e24831f575cA86F3aD --rpc-url https://rpc.mainnet.chain.robinhood.com
python3 scripts/verify_prepare.py
```

Immutables patched before compare:

- **HoodxSwap** `twapOracle` → oracle address
- **HoodxIndex** `twapOracle`, `swapLogic` → oracle, swap
- **HoodxFactory** `implementation`, `weth`, `swapRouter`, `v4Manager`, `v4StateView`, `v4Posm`

## Step 3 — Constructor args (ABI-encoded, no `0x` prefix)

Confirmed from deploy scripts (`harden_relaunch.py` / `deploy_relaunch.py`):

### UniTwapOracle — none

### HoodxSwap — `constructor(address twapOracle_)`

```
000000000000000000000000815a0d4909460b29c70868e24831f575ca86f3ad
```

### HoodxIndex — `constructor(address twapOracle_, address swapLogic_)`

```
000000000000000000000000815a0d4909460b29c70868e24831f575ca86f3ad0000000000000000000000002505a3185136ce990077a71c4929a115d9aedf75
```

### HoodxFactory — `constructor(address weth_, address router_, address treasury_, address v4Manager_, address v4StateView_, address v4Posm_, address implementation_)`

```
0000000000000000000000000bd7d308f8e1639fab988df18a8011f41eacad73
000000000000000000000000caf681a66d020601342297493863e78c959e5cb2
000000000000000000000000134d468b0bcaea6df127916f951f7938c06a37c6
0000000000000000000000008366a39cc670b4001a1121b8f6a443a643e40951
000000000000000000000000f3334192d15450cdd385c8b70e03f9a6bd9e673b
00000000000000000000000058daec3116aae6d93017baaea7749052e8a04fa7
0000000000000000000000007a5a47022e993401c5c6cfce0208c10fb032025e
```

(concatenated single line in `docs/verify-out/report.json`.)

### $696X vault

No implementation verify on the clone — it is an EIP-1167 proxy created by `HoodxFactory.create696x`. Copy the **Contract creation** tx from the [vault page](https://robinhoodchain.blockscout.com/address/0xAC45f6FffB17645057aa783b72b2Ce78BD7A1a3A) on Blockscout.

## Step 4 — Publish on Blockscout

**Order:** oracle → swap → implementation → factory. Skip clone (document only).

Artifacts: `docs/verify-out/standard-input.json` (shared Standard JSON) and per-address JSON stubs.

### CLI (when API is not Cloudflare-blocked)

```bash
export PATH="$HOME/.config/.foundry/bin:$PATH"
RPC=https://rpc.mainnet.chain.robinhood.com
API=https://robinhoodchain.blockscout.com/api/

# 1) UniTwapOracle
forge verify-contract 0x815A0D4909460B29c70868e24831f575cA86F3aD \
  contracts/UniTwap.sol:UniTwapOracle \
  --chain-id 4663 --rpc-url $RPC \
  --verifier blockscout --verifier-url $API

# 2) HoodxSwap
forge verify-contract 0x2505a3185136cE990077a71c4929a115d9AEDf75 \
  contracts/HoodxSwap.sol:HoodxSwap \
  --chain-id 4663 --rpc-url $RPC \
  --verifier blockscout --verifier-url $API \
  --constructor-args 000000000000000000000000815a0d4909460b29c70868e24831f575ca86f3ad

# 3) HoodxIndex implementation
forge verify-contract 0x7A5A47022E993401c5C6CFce0208c10fB032025E \
  contracts/HoodxIndex.sol:HoodxIndex \
  --chain-id 4663 --rpc-url $RPC \
  --verifier blockscout --verifier-url $API \
  --constructor-args 000000000000000000000000815a0d4909460b29c70868e24831f575ca86f3ad0000000000000000000000002505a3185136ce990077a71c4929a115d9aedf75

# 4) HoodxFactory
forge verify-contract 0x56809a2738A23650aF939F73588E72C67CafC19b \
  contracts/HoodxFactory.sol:HoodxFactory \
  --chain-id 4663 --rpc-url $RPC \
  --verifier blockscout --verifier-url $API \
  --constructor-args $(python3 -c "import json;print(json.load(open('docs/verify-out/report.json'))['contracts'][3]['constructorArgsHex'])")
```

**Note:** `forge verify-contract` from CI/agents may hit **Cloudflare 403** or **429** on `robinhoodchain.blockscout.com/api/`. Use the browser flow below (or `scripts/verify_blockscout_browser.py` on `DISPLAY=:0`).

### Browser (Standard JSON) — recommended

For each implementation contract:

1. Open `https://robinhoodchain.blockscout.com/address/<ADDR>/contract-verification`
2. Method: **Solidity (Standard JSON input)**
3. Compiler: **0.8.24**
4. Optimization: **Yes**, runs **1**, **viaIR: Yes**, EVM **cancun**
5. Upload `docs/verify-out/standard-input.json`
6. Contract name: e.g. `contracts/UniTwap.sol:UniTwapOracle`
7. Constructor arguments: hex from table above (if any)
8. Submit — wait for green check on the **Contract** tab (`#code`)

### Sourcify (chain 4663 supported)

Sourcify lists Robinhood Chain (4663). After Blockscout verify, optionally mirror at [sourcify.dev](https://sourcify.dev) using the same Standard JSON + metadata. Check status on the Sourcify UI for chain **4663**.

## How to check (users)

1. **Explorer:** only [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)
2. **Addresses:** only from this README or [xhoodindex.com/i/696x](https://www.xhoodindex.com/i/696x)
3. **Vault:** `$696X` is a **clone** — confirm proxy points to `0x7A5A…025E` and read source on the implementation page
4. **On-chain reads:** `owner()`, `creator()`, `creatorRecipient()`, `paused()` on the vault; skim a real `withdraw` tx
5. **Not an audit** — verified source does not remove basket, curator, or oracle risk

## Command log (this run)

```text
python3 scripts/compile_factory.py
python3 scripts/verify_prepare.py
# bytecode match: PASS (all 4 implementations)
# Blockscout: verified 2026-09-19 via browser (Standard JSON input)
# forge verify-contract → Cloudflare 403 / 429 from agents
```

Creation transaction hashes are in `docs/verify-out/report.json` (from Blockscout address API).

## Status

- [x] Blockscout verified (oracle, swap, implementation, factory)
- [ ] Sourcify mirror (optional)
- [x] Creation tx hashes in `docs/verify-out/report.json`
