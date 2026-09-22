# Full-watchlist successor canary

Status: preparation only. No live successor addresses are approved. Existing V2 vaults must not be called by this procedure.

## Before signing

1. Complete economic-model/security review and browser-wallet validation. Resolve findings before deployment. Passing a fork is execution evidence, not an independent audit.
2. Record the reviewed commit, seven build-template hashes, exact constructor arguments, chain 4663, deployer, role recipients, and per-stage spending caps. Verify deployed immutable-patched bytecode against those inputs after deployment.
3. Review all 20 token addresses, proxy implementations/admin powers, transfer behavior, routes and dependencies. Record evidence hashes. Do not reuse the simulation-only evidence label from PrepareProportionalV3.
4. Refresh the full-watchlist fork lifecycle at the current block. Require every token to have a positive bootstrap holding and successful protected sale. Preserve existing output floors.
5. Refresh pending/latest deployer nonces, balance, current fee estimate and gas simulation for every proposed transaction. Resolve pending receipts before retrying. Obtain explicit successor canary-only broadcast authorization with the concrete transaction plan and spending limits.

The proposed 0.05 ETH balance target is provisional: 0.02 ETH initial capital, up to 0.02 ETH repeat entry, 0.01 ETH reserve. It is neither a spending authorization nor a complete gas estimate. The saved infrastructure rehearsal excludes subsequent admission and trading transactions.

## Infrastructure and admission

Deploy the seven separately reviewed infrastructure contracts. Verify each receipt, code, constructor dependencies and owner before continuing. Record factory treasury and implementation identity. No investor vault exists yet.

Propose the two reviewed hooks with real evidence hashes. Read their on-chain readyAt values and retain the full 172,800-second delay. After maturity, verify unchanged code and dependencies, activate, and verify receipts and approval state. Never simulate time advancement against a live RPC.

Approve the 20 reviewed buy/sell configurations, verify every emitted ID and read back each configuration. Rehearse again with the actual live infrastructure addresses. Any route, hook, implementation or tax change invalidates prior relevant evidence.

## Canary lifecycle

1. Create a uniquely named canary clone in the successor factory. Verify clone bytecode, accounting mode, owner/curator, treasury, fees, all 20 constituents, configuration IDs and target sum. Keep the public release manifest inactive.
2. Simulate and bootstrap with 0.02 ETH, using positive protected output minima for all 20 assets. Verify receipt, actual received balances, shares, reserved fee claims and all router/executor residues.
3. From a second controlled test participant, quote and simulate a deposit capped at 0.02 ETH. Verify exact shares, every incumbent backing inequality, actual ETH cost, refund and any reserved claims. Fund that participant only through a separately reviewed transfer if needed.
4. Quote and execute a partial ETH withdrawal. Verify per-asset amounts, minimum outputs, aggregate ETH received, shares burned and retained backing.
5. Pause with the actual curator; verify deposit rejection, permitted recovery behavior and configuration nonce invalidation. Recover the second participant's remaining position in kind; verify delivered assets and resolve any reserved claims before calling their recovery complete.
6. Restore the intended pause state, quote and execute the original holder's final ETH withdrawal. Verify receipt and all actual balance deltas. Do not assume an estimate proves recovery.
7. Verify zero share supply and zero free balances for all constituents and WETH; distinguish reserved fee/failed-transfer claims from free assets. Resolve participant claims and verify no unexpected assets remain in execution contracts. Record any rounding dust explicitly.

At each step save transaction hash, block, status, gas paid, signer, decoded operation and before/after balances. A reverted or unknown transaction stops the sequence until its receipt and state are reconciled; never blindly resubmit.

## Stop and report

Report all canary transaction hashes, participant recovery including any in-kind tokens, trading/tax/gas costs, reserved claims, final vault balances and remaining deployer ETH. In-kind recovery is not the same as recovering ETH capital; any subsequent sale needs its own bounded quote and authorization.

Do not create production vaults, activate the frontend release manifest, move existing V2 assets, or claim the watchlist is live until the canary evidence is reviewed and production release is explicitly approved.
