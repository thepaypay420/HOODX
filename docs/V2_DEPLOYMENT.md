# V2 deployment runbook

Status: unsigned simulation only. The branch is not ready for production.

## Roles and signing

Expected curator, creator recipient and treasury: 0x134D468B0bcaeA6DF127916f951F7938c06A37C6.
Disposable deployer: 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19.
Named encrypted Foundry account: hoodx-deployer-v2.
Keystore on this Windows host: C:\Users\lukey\.foundry\keystores\hoodx-deployer-v2.

The curator private key is never needed. The seeded policy and official factory assign long-term roles during construction, with no temporary deployer administrator. A supplied CURATOR_EOA must equal the expected curator.

Keep ROBINHOOD_RPC_URL only in a process environment. Do not place it in browser configuration, repository files or command output. run_v2_simulation.py relays through an ephemeral loopback address so Foundry's saved transaction artifacts do not contain the paid endpoint.

## Reproducible preparation

Use the pinned submodules recursively, Foundry 1.8.3, Solidity 0.8.24 and Node 24. Run local tests, pinned and latest forks, static analysis, frontend tests/build and secret scanning. Review V2_SECURITY.md; do not treat a passed emergency-exit test as a normal-canary result.

DeployV2.s.sol produces the candidate stack with the expected canonical router code hash and exact constituent identities, route hashes and fixed oracle retention thresholds. Live execution requires both the independent live switch and a matching HOODX_REVIEWED_BUILD fingerprint. Production additionally requires HOODX_CANARY_RECEIPTS_VERIFIED, a matching HOODX_CANARY_BUILD and checked-empty HOODX_CANARY_FACTORY. These receipt flags may be set only after actual chain receipts are verified. Its simulation-derived addresses are not production addresses.

CanaryV2.s.sol strictly requires all targeted buys and normal partial/final ETH withdrawals. RecoverCanaryV2.s.sol separately performs direct asset recovery after a failure; it never marks a canary successful.

## Draft funding evidence

The historical estimate below is superseded by the itemized release funding envelope in V2_RELEASE_VALIDATION.md. Use V2_CANARY_RECEIPTS.md for the required actual-receipt checks; an empty canary alone is not proof that its normal cycles passed.

One complete stack simulation at block 67596687:
- Estimated gas including Forge estimation multiplier: 49,200,088.
- Estimated maximum fee: 0.130900001 gwei.
- Estimated stack deployment cost: 0.006440291568400088 ETH.
- Two separate stacks (canary then production): approximately 0.012880583136800176 ETH at that same gas quote, before smoke transactions.
- Canary peak capital: 0.08 ETH if 696X completes and recovers before the 0.02 ETH FAANGX cycle.
- Canary capital is subject to fees, slippage and gas; it is not fully refundable principal.

This is NOT the final requested funding amount. Re-simulate final bytecode and the complete smoke sequence, measure smoke gas, read the current fee and deployer balance, and itemize safety headroom before asking for funds. The last checked deployer balance was zero. Do not overfund it or assume either gas price or balance is unchanged.

## Required live sequence

1. Complete exact manifest pinning and the remaining code/UI/release checks.
2. Recheck legacy vault emptiness and expected roles on chain.
3. Produce the exact funding statement and wait for sufficient confirmed balance.
4. Require HOODX_LIVE_BROADCAST=1. Every live Forge invocation must use --account hoodx-deployer-v2. The human enters the keystore password only into the hidden terminal prompt.
5. Deploy the disposable canary using the final compiled bytecode.
6. Execute and verify both real normal canary cycles, including AMZN and NFLX. Check receipts, fees, deltas, no deployer live shares, no vault/quote/router-attributable dust.
7. If any canary fails, stop production and recover/account for remaining tokens and claims. Never relabel a failed canary as production.
8. Deploy a fresh production stack from the same approved compiled artifacts. Both official vaults must remain economically empty.
9. Verify implementation/source and all roles, references, weights, metadata, empty balances and absent deployer authority.
10. Only then activate frontend manifests/ABIs, create the preview, and complete release verification.
11. Sweep the deployer's remaining ETH to the fixed curator destination after all required transactions and checks, accounting for the sweep fee. Do not sweep user/vault/reserved assets.

See V2_FUNDING_FLOW.md for the user's confirmed recovery and sweep flow. No main-branch merge is authorized by this runbook.


Use scripts/run_v2_release.py from a human terminal for signing. It accepts only the fixed named account, protects the paid endpoint through a local relay, and stops before RPC/wallet access if --broadcast is requested without the independent live switch.
