# Identity checks for the deployed disposable canary

The reviewed deployment fingerprint is 0xe7388911d0a7cb3c1fef4b8555d060a05782b7ada1dd18e5494ba3857bbc9138. All 19 actual creation transactions matched the preserved reviewed simulation inputs, including constructor arguments. All executable runtime bytes were checked; where a later local recompilation changed only the IPFS metadata hash, the exact deployed runtime including its metadata was also proven to be embedded in the preserved reviewed creation input. No executable mismatch was accepted.

The first stepwise deposit attempt stopped before signing with `build mismatch`: rebuilding creation bytecode inside the step script used different compiler metadata than the earlier deployment script. This was a script identity-check defect, not a deployed vault defect or a trading-protection failure. No deposit was broadcast by that attempt.

CanaryStepV2 now validates the reviewed build identifier and calls VerifiedCanaryV2 for the exact already-deployed factory and all 19 deployed runtime hashes. Those identities are recorded in deployments/robinhood-4663-canary-codehashes.json with their actual deployment transaction hashes. The identity checks run during unsigned simulations as well as live execution. The live switch, named signer, expected share state, vault binding and role checks remain. The runner also rejects FAANGX and production in the current 696X-only session.

Regression tests on the current fork accepted the real reviewed stack, rejected another factory, and rejected a modified executor runtime. Three tests passed. These are script-only changes: no deployed contract, route, slippage floor, liquidity minimum or purchase threshold was changed.

This identity library deliberately applies only to this disposable canary. It must not be repurposed to authorize production or a different canary deployment. A future stack requires independent creation-receipt and runtime verification before its identities can be recorded.
