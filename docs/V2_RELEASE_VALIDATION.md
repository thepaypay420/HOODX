# Release validation after aa5700b

Release-validation mode only. No architecture redesign, live transaction or frontend activation is authorized by this report. The existing live-broadcast switch and successful live-canary gates remain required.

## Completed checks

- Checkpoint local suite: 94 passed, zero failed; includes fuzz and invariant runs.
- Official baskets at final formatted-build fork block 67627755: both deposits and both normal partial/final withdrawals passed. The emergency fallback was not used.
- Recorded stable block 67591644: both normal cycles passed again.
- Formatting check exposed three files requiring formatter changes. These are brace/line-wrapping changes only; final compilation, 94 local tests, both fork cycles and unsigned simulation all passed. HoodxIndexV2 runtime is 19,272 bytes, below the 24,576-byte limit.
- Secret scan: 184 candidate files in the initial scan, zero suspicious files at this run.
- Production runner without the independent live switch exits before RPC or wallet access, as required.
- Receipt verification requirements are documented in V2_CANARY_RECEIPTS.md. The receipt flag is an operator attestation, not an automatic historical-proof check.

The frontend, Python and static-analysis results remain those recorded at aa5700b because their implementations have not changed. Static-analysis findings and external-token/oracle risks remain documented in V2_SECURITY.md; this report does not claim an independent clean audit.

## Funding envelope

Read-only chain check: chain 4663, deployer balance zero, nonce zero. No funding has been received at that observation. The final unsigned deployment simulation at block 67627073 estimated 49,361,162 gas for one stack and 0.006292955870417162 ETH at 0.127488001 gwei maximum fee.

Conservative smoke measurements take the larger of each operation across the two tested blocks:

- 696X deposit / partial / final: 4,696,643 / 3,903,565 / 3,768,300 gas.
- FAANGX deposit / partial / final: 3,928,324 / 3,394,908 / 3,311,113 gas.
- Six calls total: 23,002,853 gas. Add six transaction base costs, then 30% execution headroom: 30,067,509 gas. These are test-call measurements, not exact transaction estimates; calldata/cold-access differences must be checked by the live smoke simulation.
- Two stack estimates: 98,722,324 gas. Forge's deployment estimate already includes its multiplier; do not apply that multiplier again.
- Sweep allowance: 21,000 gas, conditional on the destination remaining an ordinary account and a successful transfer estimate.
- Combined planning allowance: 128,810,833 gas.
- At a planning fee ceiling of 0.26 gwei: 0.033490816580000000 ETH for gas.
- Sequential peak canary capital: 0.08 ETH. Recover 696X before starting FAANGX; do not fund simultaneous cycles. The withdrawal minimums allow up to 10% loss per cycle, so capital is not promised to return in full.
- Rounded whole-sequence funding envelope: **0.115 ETH**, comprising 0.08 ETH capital, 0.03349081658 ETH gas and 0.00150918342 ETH additional headroom.

This envelope is conditional on the next pre-signing simulation remaining within the allowance, fee quotes staying at or below 0.26 gwei, and the actual smoke simulations fitting the gas allowance. It is not permission to broadcast or a guarantee against fee changes. Recompute before funding/signing if any condition changes; stop before sending an underfunded sequence. A failed canary stops production, leaving its reserved production-gas allowance available for recovery. Return the remainder through the confirmed sweep flow only after all required checks.

## Remaining gates

1. Final simulation passed. Reviewed build fingerprint: 0xe7388911d0a7cb3c1fef4b8555d060a05782b7ada1dd18e5494ba3857bbc9138. Recheck before signing if any build input changes.
2. Complete offline keystore signing and recovery in the hidden-password terminal. The public address is 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19. A pending prompt is not a verified signature.
3. Confirm funding and independently enabled live switch, refresh market/legacy-state checks, then execute disposable canaries only when requested.
4. Verify actual deployment and six smoke receipts, source/configuration, finality and balances before production. There are no actual canary receipts yet.

No production Factory, 696X or FAANGX V2 deployment has occurred. The frontend remains gated off.
