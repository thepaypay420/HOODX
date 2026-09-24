# Atomic rebalance controller release

Each vault receives its own controller. Deployment does not move assets or grant authority.

## Review gates

1. Record the controller build fingerprint printed by the simulation.
2. Run all unit, fuzz, invariant, frontend, and current-state fork checks.
3. Independently review the controller source and the exact compiled bytecode.
4. Simulate deployment with the intended vault, curator, and controller version.
5. Recompute gas and verify the deployer balance immediately before broadcast.

Live deployment requires all of these exact switches:

- `HOODX_LIVE_BROADCAST=1`
- `HOODX_DEPLOY_STAGE=atomic-rebalance-controller`
- `HOODX_REVIEWED_BUILD=<the printed fingerprint>`
- `HOODX_CONTROLLER_VAULT=<reviewed vault>`
- `HOODX_CONTROLLER_CURATOR=<current curator>`
- `HOODX_CONTROLLER_VERSION=2` or `3`

## Activation

The curator reviews the deployed controller identity, then signs two transactions:

1. `vault.transferOwnership(controller)`
2. `controller.activate()`

The first transaction only nominates the controller. The second accepts ownership after checking
that the caller is the pinned curator and that the vault still names that controller as pending
owner. Assets never leave the vault.

## Recovery

The controller curator can call `releaseVault(nextOwner)`. The nominated address then accepts the
vault's standard two-step ownership transfer. A pending release can be cancelled before acceptance.

## V2 limitation

V2 purchases still execute the vault's complete post-buy valuation and cash-reserve checks. If any
configured V2 oracle is unavailable, the whole atomic transaction reverts. Sales remain available.
The controller deliberately does not bypass this safety rule.

V3 proportional vaults do not depend on an independent price oracle for share accounting. Their
controller additionally pins the starting plan nonce and advances the vault nonce through every
target and trade operation.

Immediately before every V3 trade, the controller executes the exact route inside an
always-reverting quote subcall against the vault's current balances. It requires the curator's
minimum output to be at least 97% of that fresh quote, rounded upward. This applies to atomic
rebalances, single forwarded trades, and emergency unwinds.

This execution floor controls route slippage but does not turn the route into an independent
fair-value oracle. Protocol route approval and liquidity review remain required, especially for
long-tail assets whose pool price could be manipulated before the rebalance transaction.

## New successor vaults

`HoodxAtomicFactoryV3` is the only supported creation path after successor activation. One user
transaction clones the reviewed proportional implementation, deploys that vault's immutable
controller, initializes the controller as vault owner, and pins the human curator in the controller.
There is no later ownership-activation step for a newly created vault.

The factory accepts only the current route ID registered for each token. Its initial deployment
registers the reviewed 20-token watchlist in the constructor. Adding or replacing a protocol route
remains a separate owner-reviewed safety action; once registered, any creator can include that asset
in the same one-transaction vault launch.

Existing V2 and previously created V3 vaults cannot be retroactively created this way. They retain
the separately deployed controller and two-step ownership activation described above.

## Final pre-broadcast validation

- Solidity: 222 passed, 0 failed; unit, fuzz, and invariant suites included.
- Frontend: 68 tests passed; optimized production build passed.
- Current Robinhood fork: 20 routes registered, factory deployed, and a 20-asset vault plus its
  controller created in one user transaction.
- Measured 20-asset creation gas: 8,612,284.
- Runtime sizes: vault 24,366 bytes; controller 12,709 bytes; factory 18,187 bytes.
- Reviewed build fingerprint: `0x0154d86071a250bfd0b245cd088bb417b930999c550964317c811a86545bb6e9`.

The fork result is a rehearsal only. No transaction in this validation changed live chain state.
