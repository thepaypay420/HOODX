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
