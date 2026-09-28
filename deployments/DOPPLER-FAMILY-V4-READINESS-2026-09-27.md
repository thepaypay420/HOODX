# Doppler route-family readiness

The corrected active QUOTIENT token is `0x2531F3ca1b31086b7FC130eCDa6D3253DAF83ba3`. Its strongest verified market is the WETH pool `0xc6c2cd8e0f1e9373e0e2c60da3b6619753f7ff05599d59a66a358cbbaecc5ccf`. The legacy address `0x013940c3daa5e2Bb12df1Ea94AfE47Ce84c0db4f` remains rejected.

`HoodxFeeModelV4` supports the verified Doppler route family without adding a per-token cooldown. It pins and rechecks the exact outer Doppler initializer address and code hash, the exact nested Rehype module address and code hash, the canonical PoolManager, the WETH numeraire, the asset identity, the complete pool key, and a live pool status. The nested Rehype fee must be at most 10%. The model reserves the outer initializer's full 10% LP-fee authority even when the current pool fee is lower. Any bytecode replacement, hook replacement, pool-key mismatch, unsupported lifecycle state, or unsafe fee fails closed.

The existing registry requires one proposal and its existing two-day review delay for the Doppler initializer. This is a one-time hook-family review. Once activated, a curator may approve a new asset route using the same exact reviewed outer and nested hook stack immediately. A new or changed hook implementation still requires review.

The replacement deployment reuses the live registry, executor, routing dispatcher, policy, and route administrator. Only a new immutable fee model, vault implementation, and factory are required. Existing vaults and the retired canary are not changed.

## Validation

- Six unit tests pass for immediate same-family admission, unsafe opening fees, substituted hooks, changed bytecode, incorrect pool identity/status, and fixed-fee regression behavior.
- Two current-state Robinhood fork tests pass: active QUOTIENT is accepted and legacy QUOTIENT is rejected.
- The complete 21-asset first-deposit and full-withdrawal lifecycle passes at a fresh fork block with the active QUOTIENT route included.
- A three-contract replacement deployment succeeds in simulation and is estimated at approximately `0.0004054 ETH` at the sampled fee cap.
- No production transaction was broadcast while preparing this change.

## GRIEFING READINESS

- A curator cannot use the reviewed-family path to select arbitrary hook bytecode: both hook addresses and runtime hashes are pinned and checked every time.
- A token cannot impersonate another reviewed pool: the token, WETH numeraire, full pool key, outer state, and nested state must agree.
- A hook authority changing the nested hook causes quotes and executions to fail closed. A graduated or exited pool is rejected.
- Fee changes cannot race a quote into an unbounded charge: the full outer 10% authority is reserved, while the nested schedule is immutable after initialization and only decays. Nested fees above 10% are rejected.
- Failed route checks and failed swaps revert atomically. Direct in-kind withdrawal remains independent of this swap route.
- UNVERIFIED: future Doppler deployments using a different outer or nested runtime require a new source review and the registry cooldown before admission.
