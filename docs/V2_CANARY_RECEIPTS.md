# Canary receipt verification procedure

This procedure is a release gate, not evidence that a live canary has passed. No live receipt exists at checkpoint aa5700b. Never set the production receipt flag from a successful simulation or emergency recovery.

## Before funding and signing

1. Record the reviewed Git commit, clean contract/script diff, compiler settings, pinned routing manifest and `v2BuildFingerprint()` output from the unsigned deployment simulation. Preserve the compiled artifacts used for both stacks.
2. Verify the encrypted account by signing and recovering an offline, nonce-bearing message. Record only the public address and successful recovery. Do not store the password or export a key.
3. Refresh chain ID 4663, deployer balance/nonce, fee quote, legacy balances and route/oracle availability. Recalculate funding if the build or fee budget changes.
4. Keep the production addresses absent from frontend configuration. The live runner requires the independent live switch and named encrypted account.

## Deployment evidence

For every transaction in the actual canary deployment artifact, fetch the transaction and receipt from the configured chain. Require a mined receipt with status 1, matching transaction hash and canonical block hash; sender must be the deployer. Record block, nonce, created address, gas used and effective gas price. Recheck canonical block hashes after the chain's applicable finality criterion; a mined receipt alone is not finality evidence.

Independently read code at every created address. Match the deployed runtime against the reviewed build, accounting explicitly for Solidity immutable references and clone implementation addresses. Verify constructor inputs against the pinned manifest and source-verification output. Verify the router runtime hash and all canonical integration addresses again.

Resolve both official vaults from the actual canary factory's `bySlug` reads. Verify factory and policy owners, vault owners/creators/fee recipients/treasury, constituent identities/order, route hashes, references, depth limits, weights, fees, minimums and metadata against the reviewed configuration. Verify no deployer authority or pending ownership transfer. Record balances before the cycles, including vaults, executor, router and route quote assets. Pre-existing external router balances are a baseline, not canary-owned dust.

## Six smoke transactions, in order

Require these six successful, canonical receipts from the deployer, addressed to the resolved canary vaults:

1. 696X deposit: transaction value exactly 0.08 ETH; decoded deposit minimum/deadline match the reviewed simulation; one matching Deposit event credits the deployer.
2. 696X normal partial withdrawal: zero transaction value; shares equal half the minted shares, rounded down; matching Withdraw event and ETH output at least 0.036 ETH.
3. 696X normal final withdrawal: burns all remaining deployer shares; matching Withdraw event and ETH output at least 0.036 ETH.
4. FAANGX deposit: transaction value exactly 0.02 ETH; matching Deposit event credits the deployer.
5. FAANGX normal partial withdrawal: half the minted shares, rounded down; matching Withdraw event and ETH output at least 0.009 ETH.
6. FAANGX normal final withdrawal: all remaining shares; matching Withdraw event and ETH output at least 0.009 ETH.

Decode calldata and event data using the reviewed ABI. Check increasing nonces and execution order, transaction sender/recipient/value, deposit fees, minted shares, withdrawal shares and actual ETH returned. Reconcile deployer ETH changes with gas costs and any separately identified funding transfers. Check constituent purchases using execution traces or transaction-boundary state diffs, including AMZN and NFLX; a latest-block balance after the final exit cannot prove an earlier purchase. Reject BuyDeferred, emergency redemption or recovery as a passing normal cycle. Retain the original RPC evidence with private endpoint information excluded.

## Final state and production gate

At a recorded canonical block after both cycles, require zero deployer shares, zero total supply, zero total assets, zero native/WETH/constituent/route-quote balances in both vaults and zero reserved or claimable amounts for all cycle participants. Check executor and router balances against their recorded baselines and reconcile any unrelated external activity rather than assuming the entire router belongs to HOODX. Reconcile fee-recipient transfers separately.

Save a public report containing actual addresses, all deployment and smoke hashes, canonical block hashes, final-state reads, gas costs, build fingerprint and source/config verification results. Any missing or contradictory evidence leaves the report pending. If a withdrawal fails, preserve the failed receipt, recover through the separate recovery script as necessary, account for every remaining asset/claim, and stop production.

Only after all checks pass may the operator set `HOODX_CANARY_RECEIPTS_VERIFIED=true`, `HOODX_CANARY_BUILD` and `HOODX_CANARY_FACTORY` from this report. Those environment variables are attestations; the on-chain empty-state check does not itself prove successful historical cycles. Production must use fresh deployments from the same reviewed artifacts. Never reuse canary addresses as production.
