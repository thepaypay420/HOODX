# Official vault launch security review

Scope: the 47-route catalog, bounded route administrator, atomic factory, ten official vault definitions, first-entry weighting and full ETH exit path.

## Security properties checked

1. **Exact route admission.** Each route ID commits to the token address, live runtime code hash, encoded buy route, encoded sell route and dated evidence hash. A changed token runtime invalidates the route.
2. **Bounded administration.** The route administrator holds no user assets and exposes no transfer or swap function. It can administer only the fixed V3 policy, in batches of at most 20, under `Ownable2Step` control.
3. **Creation integrity.** The factory accepts only the policy configuration currently registered for each token. Vault and atomic controller are created together; the controller becomes vault owner during initialization, avoiding a later ownership gap.
4. **Official identity.** Factory owner, treasury, curator, creator and creator fee recipient all resolve to `0x134D468B0bcaeA6DF127916f951F7938c06A37C6` in the exact rehearsal.
5. **Initial allocation.** The first ETH entry computes token budgets from the stored smart market-cap targets. Tests reject weights below 7.5%, above 25%, or totals other than 100% including cash.
6. **Atomic curator action.** Rebalance execution checks route floors, nonce, deadline, basket hash and final reserve constraints. A failed leg reverts the complete action.
7. **Investor exit.** A full ETH exit was exercised for every proposed vault. Direct proportional redemption remains the price-independent recovery path.
8. **No launch custody.** The ten vaults are created with zero supply and no seed funds. Creation itself cannot move investor capital.

## Trust and operating boundaries

- The official curator can change targets, pause deposits, add a policy-approved constituent, replace an asset with another admitted configuration, and execute atomic rebalances. These are the disclosed curator powers of the product.
- The curator cannot select an arbitrary unreviewed route through the factory or policy. Adding a new route remains a separate reviewed admission.
- Policy ownership is centralized under the official curator-controlled route administrator. Compromise of that wallet can approve future routes. Existing vaults keep their pinned configuration IDs until the curator explicitly replaces them.
- DEX liquidity and market-cap inputs can change after launch. Route floors and atomic reversion limit execution loss; they do not guarantee future liquidity or performance.

## Evidence

- Catalog and bounds test: passed.
- 47-route fork round trips at two sizes: passed.
- Ten exact smart-weight bootstrap/full-withdraw lifecycles: passed.
- Live-infrastructure ownership, admission, creation and CHAINX canary rehearsal: passed.
- Route-administrator owner and non-owner tests: passed.
- Frontend unit suite and production build must pass again after live addresses are recorded.

Production admission and vault creation remain separate wallet-signed actions. A failed or rejected signature cannot partially create a vault.

